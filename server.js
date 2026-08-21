const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { magazyn, poKolei, pustyStan } = require("./storage");

const PORT = process.env.PORT || 3000;
const HASLO = process.env.APP_PASSWORD || null;
const PENALTY_WEIGHT = 5;

const app = express();
app.use(express.json());

/* ---------- hasło ----------
   Włącza się tylko wtedy, gdy ustawiono APP_PASSWORD. Lokalnie zmiennej nie ma,
   więc appka działa bez logowania. Ciasteczko trzyma skrót hasła, nie samo hasło. */

const TOKEN = HASLO
  ? crypto.createHash("sha256").update(`${HASLO}::daily-selector`).digest("hex")
  : null;

function ciasteczka(req) {
  const surowe = req.headers.cookie || "";
  return Object.fromEntries(
    surowe
      .split(";")
      .map((c) => c.trim().split("="))
      .filter((p) => p.length === 2)
  );
}

function zalogowany(req) {
  return !HASLO || ciasteczka(req).ds_auth === TOKEN;
}

app.post("/api/login", (req, res) => {
  if (!HASLO) return res.json({ ok: true });
  const podane = String(req.body.password || "");
  const pasuje =
    podane.length === HASLO.length &&
    crypto.timingSafeEqual(Buffer.from(podane), Buffer.from(HASLO));
  if (!pasuje) return res.status(401).json({ error: "Nieprawidłowe hasło." });

  res.setHeader(
    "Set-Cookie",
    `ds_auth=${TOKEN}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 60}` +
      (process.env.NODE_ENV === "production" ? "; Secure" : "")
  );
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  // kasujemy ciasteczko ustawiając mu przeszłą datę ważności
  res.setHeader(
    "Set-Cookie",
    "ds_auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" +
      (process.env.NODE_ENV === "production" ? "; Secure" : "")
  );
  res.json({ ok: true });
});

app.get("/api/auth-check", (req, res) => {
  res.json({ wymaganeHaslo: !!HASLO, zalogowany: zalogowany(req) });
});

// bramka: bez hasła API milczy, a przeglądarka dostaje ekran logowania
app.use((req, res, next) => {
  if (zalogowany(req)) return next();
  if (req.path === "/login.html" || req.path === "/login.js") return next();
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Wymagane hasło." });
  }
  return res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.use(express.static(path.join(__dirname, "public")));

/* ---------- pomocnicze ---------- */

function stanPubliczny(stan) {
  return {
    ...stan,
    people: stan.people.map((p) => ({
      ...p,
      waiting: p.active && stan.remaining.includes(p.id),
    })),
  };
}

// każdy uchwyt zmieniający stan przechodzi tędy: odczyt, modyfikacja, zapis,
// wszystko po kolei, żeby równoległe kliknięcia się nie nadpisały
function zmien(handler) {
  return (req, res) =>
    poKolei(async () => {
      try {
        const stan = await magazyn.wczytaj();
        const wynik = await handler(stan, req, res);
        if (res.headersSent) return;
        await magazyn.zapisz(stan);
        res.json(wynik === undefined ? stanPubliczny(stan) : wynik);
      } catch (err) {
        console.error("Błąd:", err);
        if (!res.headersSent) res.status(500).json({ error: "Błąd serwera." });
      }
    });
}

const blad = (res, kod, tresc) => {
  res.status(kod).json({ error: tresc });
  return null;
};

/* ---------- API ---------- */

app.get("/api/state", async (req, res) => {
  try {
    res.json(stanPubliczny(await magazyn.wczytaj()));
  } catch (err) {
    console.error("Błąd:", err);
    res.status(500).json({ error: "Błąd serwera." });
  }
});

app.post(
  "/api/people",
  zmien((stan, req, res) => {
    const name = String(req.body.name || "").trim();
    if (!name) return blad(res, 400, "Podaj imię i nazwisko.");

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    stan.people.push({ id, name, active: true, lastPicked: null, timesPicked: 0, penalty: false });
    stan.remaining.push(id);
  })
);

app.patch(
  "/api/people/:id",
  zmien((stan, req, res) => {
    const person = stan.people.find((p) => p.id === req.params.id);
    if (!person) return blad(res, 404, "Nie znaleziono osoby.");
    const b = req.body;

    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) return blad(res, 400, "Imię nie może być puste.");
      person.name = name;
      // nazwa jest kopiowana do historii i bieżącego tygodnia — poprawiamy wszędzie,
      // żeby literówka nie została na zawsze w starych wpisach
      stan.history.forEach((h) => { if (h.personId === person.id) h.name = name; });
      if (stan.current && stan.current.personId === person.id) stan.current.name = name;
    }

    if (typeof b.active === "boolean") {
      person.active = b.active;
      if (!person.active) stan.remaining = stan.remaining.filter((id) => id !== person.id);
      else if (!stan.remaining.includes(person.id)) stan.remaining.push(person.id);
    }

    if (typeof b.waiting === "boolean") {
      if (b.waiting) {
        if (person.active && !stan.remaining.includes(person.id)) stan.remaining.push(person.id);
      } else {
        stan.remaining = stan.remaining.filter((id) => id !== person.id);
      }
    }

    if (b.timesPicked !== undefined) {
      const n = Number(b.timesPicked);
      if (!Number.isInteger(n) || n < 0) {
        return blad(res, 400, "Licznik musi być liczbą całkowitą ≥ 0.");
      }
      person.timesPicked = n;
    }

    if (b.lastPicked !== undefined) {
      if (b.lastPicked === null || b.lastPicked === "") person.lastPicked = null;
      else if (/^\d{4}-\d{2}-\d{2}$/.test(b.lastPicked)) person.lastPicked = b.lastPicked;
      else return blad(res, 400, "Data musi być w formacie RRRR-MM-DD.");
    }
  })
);

app.delete(
  "/api/people/:id",
  zmien((stan, req) => {
    stan.people = stan.people.filter((p) => p.id !== req.params.id);
    stan.remaining = stan.remaining.filter((id) => id !== req.params.id);
  })
);

// zerowanie wpisu: imię i nazwisko zostaje, reszta wraca do stanu początkowego
app.post(
  "/api/people/:id/reset",
  zmien((stan, req, res) => {
    const person = stan.people.find((p) => p.id === req.params.id);
    if (!person) return blad(res, 404, "Nie znaleziono osoby.");

    person.timesPicked = 0;
    person.lastPicked = null;
    person.penalty = false;
    person.active = true;
    if (!stan.remaining.includes(person.id)) stan.remaining.push(person.id);
    if (stan.current && stan.current.personId === person.id) stan.current = null;

    return { name: person.name, state: stanPubliczny(stan) };
  })
);

// kara za spóźnienie: ukarany trafia na koło PENALTY_WEIGHT razy
app.post(
  "/api/people/:id/penalty",
  zmien((stan, req, res) => {
    const person = stan.people.find((p) => p.id === req.params.id);
    if (!person) return blad(res, 404, "Nie znaleziono osoby.");
    person.penalty = !person.penalty;
    return { penalty: person.penalty, name: person.name, state: stanPubliczny(stan) };
  })
);

app.post(
  "/api/penalties/clear",
  zmien((stan) => {
    const zdjete = stan.people.filter((p) => p.penalty).map((p) => p.name);
    stan.people.forEach((p) => { p.penalty = false; });
    return { zdjete, state: stanPubliczny(stan) };
  })
);

app.post(
  "/api/draw",
  zmien((stan, req, res) => {
    const activeIds = stan.people.filter((p) => p.active).map((p) => p.id);
    if (activeIds.length === 0) return blad(res, 400, "Brak aktywnych osób na liście.");

    stan.remaining = stan.remaining.filter((id) => activeIds.includes(id));
    if (stan.remaining.length === 0) {
      stan.remaining = [...activeIds];
      stan.round += 1;
    }

    // ukarany trafia do puli kilka razy — algorytm zostaje ten sam,
    // po prostu jego id występuje częściej
    const weighted = [];
    stan.remaining.forEach((id) => {
      const p = stan.people.find((x) => x.id === id);
      const waga = p && p.penalty ? PENALTY_WEIGHT : 1;
      for (let i = 0; i < waga; i++) weighted.push(id);
    });

    const pickedId = weighted[Math.floor(Math.random() * weighted.length)];
    stan.remaining = stan.remaining.filter((id) => id !== pickedId);

    const person = stan.people.find((p) => p.id === pickedId);
    const today = new Date().toISOString().slice(0, 10);
    person.lastPicked = today;
    person.timesPicked = (person.timesPicked || 0) + 1;

    // kara obowiązuje na jedno losowanie — zapisujemy ją, żeby dało się cofnąć
    const penaltiesBefore = stan.people.filter((p) => p.penalty).map((p) => p.id);
    stan.people.forEach((p) => { p.penalty = false; });

    stan.history.unshift({
      date: today, personId: person.id, name: person.name,
      round: stan.round, penalties: penaltiesBefore,
    });
    stan.current = { personId: person.id, name: person.name, date: today, round: stan.round };

    return { picked: { id: person.id, name: person.name }, state: stanPubliczny(stan) };
  })
);

app.post(
  "/api/undo",
  zmien((stan, req, res) => {
    if (stan.history.length === 0) {
      return blad(res, 400, "Nie ma czego cofać — historia jest pusta.");
    }

    const entry = stan.history.shift();
    const person = stan.people.find((p) => p.id === entry.personId);

    if (person) {
      person.timesPicked = Math.max(0, (person.timesPicked || 0) - 1);
      const prev = stan.history.find((h) => h.personId === person.id);
      person.lastPicked = prev ? prev.date : null;
      if (person.active && !stan.remaining.includes(person.id)) stan.remaining.push(person.id);
    }

    if (Array.isArray(entry.penalties)) {
      stan.people.forEach((p) => { p.penalty = entry.penalties.includes(p.id); });
    }

    const stillInRound = stan.history.some((h) => h.round === entry.round);
    if (!stillInRound && stan.round > 1) stan.round -= 1;

    const top = stan.history[0];
    stan.current = top
      ? { personId: top.personId, name: top.name, date: top.date, round: top.round }
      : null;

    return { undone: { name: entry.name, date: entry.date }, state: stanPubliczny(stan) };
  })
);

app.post("/api/reset", (req, res) =>
  poKolei(async () => {
    try {
      await magazyn.snapshot("reset");
      const czysty = pustyStan();
      await magazyn.zapisz(czysty);
      res.json(stanPubliczny(czysty));
    } catch (err) {
      console.error("Błąd:", err);
      res.status(500).json({ error: "Błąd serwera." });
    }
  })
);

app.post("/api/import", (req, res) =>
  poKolei(async () => {
    try {
      const incoming = req.body;
      if (!incoming || !Array.isArray(incoming.people)) {
        return res.status(400).json({ error: "Nieprawidłowy plik." });
      }
      await magazyn.snapshot("import");
      const stan = {
        people: incoming.people,
        remaining: Array.isArray(incoming.remaining) ? incoming.remaining : [],
        round: incoming.round || 1,
        history: Array.isArray(incoming.history) ? incoming.history : [],
        current: incoming.current || null,
      };
      await magazyn.zapisz(stan);
      res.json(stanPubliczny(stan));
    } catch (err) {
      console.error("Błąd:", err);
      res.status(500).json({ error: "Błąd serwera." });
    }
  })
);

/* ---------- start ---------- */

// Pojedyncza czkawka bazy albo przeoczony await nie powinny kłaść całej appki —
// bez tego Node ubija proces przy nieobsłużonym odrzuceniu obietnicy,
// a hosting wpada w pętlę restartów.
process.on("unhandledRejection", (err) => {
  console.error("Nieobsłużone odrzucenie obietnicy:", err);
});

// Baza bywa niegotowa w pierwszych sekundach po wdrożeniu — próbujemy kilka razy,
// zamiast od razu kończyć proces.
async function uruchomSkladowanie(prob = 5) {
  for (let i = 1; i <= prob; i++) {
    try {
      await magazyn.init();
      return;
    } catch (err) {
      console.error(`Składowanie niegotowe (próba ${i}/${prob}):`, err.message);
      if (i === prob) throw err;
      await new Promise((r) => setTimeout(r, i * 2000));
    }
  }
}

uruchomSkladowanie()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Daily Selector działa na http://localhost:${PORT}`);
      console.log(`Składowanie: ${magazyn.nazwa}`);
      console.log(`Hasło: ${HASLO ? "włączone" : "wyłączone (brak APP_PASSWORD)"}`);
    });
  })
  .catch((err) => {
    console.error("Nie udało się uruchomić składowania:", err);
    process.exit(1);
  });
