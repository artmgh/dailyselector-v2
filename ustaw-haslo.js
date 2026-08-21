#!/usr/bin/env node
// Ustawia hasło wejścia do aplikacji w render.yaml (wersja na serwerze)
// i w .env (wersja lokalna). Hasło podaje się na pytanie, więc nie zostaje
// ani w komendzie, ani w historii powłoki.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const KATALOG = __dirname;
const PLIK_RENDER = path.join(KATALOG, "render.yaml");
const PLIK_ENV = path.join(KATALOG, ".env");

function zapytajOHaslo() {
  process.stdout.write("Nowe hasło (nie wyświetli się): ");
  try {
    execSync("stty -echo", { stdio: "inherit" });
  } catch {
    /* brak stty — trudno, hasło będzie widoczne */
  }
  let bufor = "";
  const fd = fs.openSync("/dev/stdin", "rs");
  const bajt = Buffer.alloc(1);
  while (fs.readSync(fd, bajt, 0, 1, null) > 0) {
    const znak = bajt.toString("utf8");
    if (znak === "\n" || znak === "\r") break;
    bufor += znak;
  }
  fs.closeSync(fd);
  try {
    execSync("stty echo", { stdio: "inherit" });
  } catch {}
  process.stdout.write("\n");
  return bufor.trim();
}

// Render interpoluje zmienne środowiskowe, więc pojedynczy $ znika albo zostaje
// potraktowany jako nazwa zmiennej. Podwojenie $$ sprawia, że Render zredukuje je
// z powrotem do jednego $ — dzięki temu na serwerze ląduje dokładnie to hasło.
// (W .env zostawiamy $ pojedyncze — Node --env-file czyta wartości dosłownie.)
function naYaml(haslo) {
  const zEscapem = haslo.replace(/\$/g, "$$$$"); // każde $ → $$
  const podejrzane = /[:#{}\[\],&*?|>%@`"'$]|^\s|\s$|^[-!]/.test(haslo);
  return podejrzane ? `'${zEscapem.replace(/'/g, "''")}'` : zEscapem;
}

const haslo = zapytajOHaslo();

if (!haslo) {
  console.error("Puste hasło — nic nie zmieniam.");
  process.exit(1);
}
if (haslo.length < 6) {
  console.error("Hasło krótsze niż 6 znaków — nic nie zmieniam.");
  process.exit(1);
}

/* ---------- render.yaml ---------- */

let render = fs.readFileSync(PLIK_RENDER, "utf8");
const przed = render;

// podmieniamy linię pod "- key: APP_PASSWORD", niezależnie od tego,
// czy stoi tam teraz "sync: false", czy jakaś wartość
render = render.replace(
  /(-\s*key:\s*APP_PASSWORD\s*\n)([ \t]*)(?:value:.*|sync:.*)/,
  (_, naglowek, wciecie) => `${naglowek}${wciecie}value: ${naYaml(haslo)}`
);

if (render === przed) {
  console.error("Nie znalazłem wpisu APP_PASSWORD w render.yaml — nic nie zmieniam.");
  process.exit(1);
}
fs.writeFileSync(PLIK_RENDER, render);

/* ---------- .env ---------- */

let env = fs.existsSync(PLIK_ENV) ? fs.readFileSync(PLIK_ENV, "utf8") : "";
if (/^APP_PASSWORD=.*$/m.test(env)) {
  env = env.replace(/^APP_PASSWORD=.*$/m, `APP_PASSWORD=${haslo}`);
} else {
  env += `${env.endsWith("\n") || env === "" ? "" : "\n"}APP_PASSWORD=${haslo}\n`;
}
fs.writeFileSync(PLIK_ENV, env);

/* ---------- podsumowanie ---------- */

const gwiazdki = "*".repeat(Math.min(haslo.length, 24));
console.log("");
console.log(`Zapisane w render.yaml i .env: ${gwiazdki} (${haslo.length} znaków)`);
console.log("");
console.log("Sprawdzenie linii w render.yaml:");
const linia = render.split("\n").find((l) => l.includes("value:") && l.includes(haslo));
console.log("  " + (linia ? linia.replace(haslo, gwiazdki) : "(nie odnaleziono)"));
console.log("");
console.log("Teraz napisz Claude'owi: gotowe");
