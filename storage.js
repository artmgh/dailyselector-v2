// Warstwa składowania stanu.
//
// Lokalnie (bez DATABASE_URL) stan leży w data.json obok serwera — tak jak dotąd.
// Na hostingu z ulotnym dyskiem trzeba bazy, więc gdy DATABASE_URL jest ustawione,
// ten sam obiekt stanu ląduje w Postgresie jako jeden wiersz JSONB.
//
// Kształt stanu jest identyczny w obu wariantach, więc reszta aplikacji
// nie musi wiedzieć, gdzie to siedzi.

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data.json");
const URL_BAZY = process.env.DATABASE_URL;
const MAX_SNAPSHOTOW = 20;

function pustyStan() {
  return { people: [], remaining: [], round: 1, history: [], current: null };
}

function uzupelnijBraki(stan) {
  if (!("current" in stan)) stan.current = null;
  stan.people.forEach((p) => {
    if (typeof p.penalty !== "boolean") p.penalty = false;
  });
  return stan;
}

/* ---------- wariant plikowy ---------- */

const plikowe = {
  nazwa: "plik data.json",

  async init() {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(pustyStan(), null, 2));
    }
  },

  async wczytaj() {
    if (!fs.existsSync(DATA_FILE)) return pustyStan();
    return uzupelnijBraki(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
  },

  async zapisz(stan) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(stan, null, 2));
  },

  async snapshot(powod) {
    if (!fs.existsSync(DATA_FILE)) return null;
    const stempel = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const plik = path.join(__dirname, `data.snapshot-${stempel}-${powod}.json`);
    fs.copyFileSync(DATA_FILE, plik);
    return path.basename(plik);
  },
};

/* ---------- wariant Postgres ---------- */

function postgresowe() {
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: URL_BAZY,
    // hostowane bazy (Neon, Supabase, Render) wymagają TLS,
    // a ich certyfikaty bywają pośrednie — stąd rejectUnauthorized
    ssl: URL_BAZY.includes("localhost") ? false : { rejectUnauthorized: false },
    max: 4,
  });

  // Bez tego nasłuchu nieobsłużone zdarzenie "error" na puli kładzie cały proces
  // — a hostowane bazy rutynowo zrywają bezczynne połączenia, więc appka
  // wpadałaby w pętlę restartów.
  pool.on("error", (err) => {
    console.error("Postgres — błąd bezczynnego połączenia (ignoruję):", err.message);
  });

  return {
    nazwa: "Postgres",

    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS app_state (
          id INT PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS app_snapshots (
          id SERIAL PRIMARY KEY,
          reason TEXT NOT NULL,
          data JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await pool.query(
        `INSERT INTO app_state (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`,
        [JSON.stringify(pustyStan())]
      );
    },

    async wczytaj() {
      const { rows } = await pool.query(`SELECT data FROM app_state WHERE id = 1`);
      if (!rows.length) return pustyStan();
      return uzupelnijBraki(rows[0].data);
    },

    async zapisz(stan) {
      await pool.query(
        `INSERT INTO app_state (id, data, updated_at) VALUES (1, $1, now())
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [JSON.stringify(stan)]
      );
    },

    async snapshot(powod) {
      const { rows } = await pool.query(`SELECT data FROM app_state WHERE id = 1`);
      if (!rows.length) return null;
      await pool.query(`INSERT INTO app_snapshots (reason, data) VALUES ($1, $2)`, [
        powod,
        JSON.stringify(rows[0].data),
      ]);
      // trzymamy tylko ostatnie kopie, żeby tabela nie puchła w nieskończoność
      await pool.query(
        `DELETE FROM app_snapshots WHERE id NOT IN (
           SELECT id FROM app_snapshots ORDER BY id DESC LIMIT $1
         )`,
        [MAX_SNAPSHOTOW]
      );
      return `snapshot w bazie (${powod})`;
    },
  };
}

const magazyn = URL_BAZY ? postgresowe() : plikowe;

/* ---------- serializacja zapisów ----------
   Każda zmiana to odczyt-modyfikacja-zapis. Przy dwóch osobach klikających
   równocześnie jedna zmiana mogłaby nadpisać drugą, więc ustawiamy operacje
   w kolejkę — na jednej instancji to w zupełności wystarcza. */

let kolejka = Promise.resolve();

function poKolei(zadanie) {
  const wynik = kolejka.then(zadanie, zadanie);
  kolejka = wynik.then(
    () => undefined,
    () => undefined
  );
  return wynik;
}

module.exports = { magazyn, poKolei, pustyStan };
