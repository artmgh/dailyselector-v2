// ---------- elementy ----------
const rotor = document.getElementById("wheelRotor");
const wheelSvg = document.getElementById("wheel");
const wheelHolder = document.querySelector(".wheel-holder");
const pointer = document.getElementById("pointer");
const countdownEl = document.getElementById("countdown");
const confettiCanvas = document.getElementById("confetti");
const soundBtn = document.getElementById("soundBtn");
const drawBtn = document.getElementById("drawBtn");
const poolInfo = document.getElementById("poolInfo");
const currentName = document.getElementById("currentName");
const currentMeta = document.getElementById("currentMeta");
const waitingChips = document.getElementById("waitingChips");
const peopleList = document.getElementById("peopleList");
const historyList = document.getElementById("historyList");
const undoBtn = document.getElementById("undoBtn");
const undoTopBtn = document.getElementById("undoTopBtn");
const clearPenaltiesBtn = document.getElementById("clearPenaltiesBtn");
const addForm = document.getElementById("addForm");
const newNameInput = document.getElementById("newName");
const exportBtn = document.getElementById("exportBtn");
const importInput = document.getElementById("importInput");
const resetBtn = document.getElementById("resetBtn");
const toastEl = document.getElementById("toast");

// pastele w duchu makiety — ciemny tekst czytelny na każdym z nich
const COLORS = [
  "#a8dcec", "#f3ad91", "#cfe89a", "#c3cdf2", "#f7d08a",
  "#eeb8dc", "#9fd8c4", "#d7c7f0", "#f4b3b3", "#bfd8e8",
];

let rotation = 0;      // skumulowany obrót koła w stopniach
let wheelPool = [];    // osoby aktualnie narysowane na kole
let spinning = false;
let editingId = null;      // id osoby otwartej w edytorze
const PENALTY_WEIGHT = 5;  // tyle razy ukarany pojawia się na kole (i w puli losowania)
let counting = false;      // trwa odliczanie (można je przerwać)
let abortRequested = false;

// ---------- pomocnicze ----------
async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Coś poszło nie tak.");
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- dźwięk (generowany w locie, bez plików) ----------
let audioCtx = null;
let soundOn = localStorage.getItem("ds-sound") !== "off";

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function tone({ freq = 600, dur = 0.08, type = "triangle", vol = 0.05, delay = 0 }) {
  if (!soundOn) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

const tickSound = () => tone({ freq: 1500, dur: 0.03, type: "square", vol: 0.03 });
// ton rośnie z każdą sekundą odliczania (10 kroków)
const countSound = (i) => tone({ freq: 340 + i * 55, dur: 0.2, vol: 0.07 });

function fanfare() {
  [523, 659, 784, 1047].forEach((f, i) =>
    tone({ freq: f, dur: 0.45, vol: 0.075, delay: i * 0.1 })
  );
}

function updateSoundBtn() {
  soundBtn.textContent = soundOn ? "🔊" : "🔇";
  soundBtn.classList.toggle("muted", !soundOn);
}

soundBtn.addEventListener("click", () => {
  soundOn = !soundOn;
  localStorage.setItem("ds-sound", soundOn ? "on" : "off");
  updateSoundBtn();
  if (soundOn) tone({ freq: 880, dur: 0.12 });
});
updateSoundBtn();

// ---------- odliczanie: 5 sekund, po sekundzie na cyfrę ----------
const COUNTDOWN_FROM = 5;

// zwraca false, jeśli ktoś nacisnął Stop
async function runCountdown() {
  document.body.classList.add("is-counting");
  for (let i = COUNTDOWN_FROM; i >= 1; i--) {
    if (abortRequested) break;
    countdownEl.textContent = i;
    countdownEl.classList.toggle("final", i <= 3); // ostatnie 3 s na czerwono
    countdownEl.classList.remove("tick");
    void countdownEl.offsetWidth; // restart animacji
    countdownEl.classList.add("tick");
    countSound(COUNTDOWN_FROM - i);

    // krótkie odcinki, żeby Stop działał od razu, a nie dopiero po pełnej sekundzie
    for (let t = 0; t < 10 && !abortRequested; t++) await sleep(100);
  }
  countdownEl.classList.remove("tick", "final");
  countdownEl.textContent = "";
  document.body.classList.remove("is-counting");
  return !abortRequested;
}

// ---------- stukanie wskaźnika o mijane segmenty ----------
function currentAngle() {
  const m = getComputedStyle(rotor).transform;
  const v = m && m.match(/matrix\(([^)]+)\)/);
  if (!v) return 0;
  const [a, b] = v[1].split(",").map(parseFloat);
  return (Math.atan2(b, a) * 180) / Math.PI;
}

function startTicking(segCount) {
  const seg = 360 / segCount;
  let last = -1;
  let running = true;

  const loop = () => {
    if (!running) return;
    const theta = ((currentAngle() % 360) + 360) % 360;
    const idx = Math.floor(((360 - theta) % 360) / seg);
    if (idx !== last) {
      last = idx;
      tickSound();
      pointer.classList.remove("flick");
      void pointer.offsetWidth;
      pointer.classList.add("flick");
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return () => { running = false; };
}

// ---------- konfetti ----------
function confettiBurst() {
  const canvas = confettiCanvas;
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  canvas.classList.add("active");

  const rect = wheelHolder.getBoundingClientRect();
  const ox = rect.left + rect.width / 2;
  const oy = rect.top + rect.height / 2;

  const parts = Array.from({ length: 120 }, (_, i) => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 10;
    return {
      x: ox, y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 5,
      w: 5 + Math.random() * 7,
      h: 7 + Math.random() * 9,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.42,
      color: COLORS[i % COLORS.length],
    };
  });

  const start = performance.now();
  const DURATION = 2600;

  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    const alpha = Math.max(0, 1 - t / DURATION);
    parts.forEach((p) => {
      p.vy += 0.3;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (t < DURATION) requestAnimationFrame(frame);
    else {
      ctx.clearRect(0, 0, w, h);
      canvas.classList.remove("active");
    }
  }
  requestAnimationFrame(frame);
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

function colorFor(i) {
  return COLORS[i % COLORS.length];
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("pl-PL", {
    day: "numeric", month: "long", year: "numeric",
  });
}

function shortLabel(text) {
  return text.length > 13 ? text.slice(0, 12) + "…" : text;
}

// Na kole pokazujemy samo imię. Jeśli imię się powtarza (np. dwóch Robertów),
// dokleja się pierwsza litera nazwiska — a gdyby i to nie wystarczyło,
// nazwisko wydłuża się aż nazwy będą rozróżnialne.
function buildLabels(people) {
  const czesci = (n) => n.trim().split(/\s+/);
  const labels = new Map();
  const grupy = new Map();

  people.forEach((p) => {
    const imie = czesci(p.name)[0];
    if (!grupy.has(imie)) grupy.set(imie, []);
    grupy.get(imie).push(p);
  });

  grupy.forEach((grupa, imie) => {
    if (grupa.length === 1) {
      labels.set(grupa[0].id, imie);
      return;
    }
    for (let dlugosc = 1; dlugosc <= 20; dlugosc++) {
      const proby = grupa.map((p) => {
        const nazwisko = czesci(p.name).slice(1).join(" ");
        return nazwisko ? `${imie} ${nazwisko.slice(0, dlugosc)}` : imie;
      });
      const rozroznialne = new Set(proby).size === grupa.length;
      if (rozroznialne || dlugosc === 20) {
        grupa.forEach((p, i) => labels.set(p.id, proby[i]));
        break;
      }
    }
  });

  return labels;
}

// ---------- nieruchoma obręcz z żarówkami (rysowana raz) ----------
function buildWheelFrame() {
  const frame = document.getElementById("wheelFrame");
  if (!frame || frame.childElementCount) return;
  const NS = "http://www.w3.org/2000/svg";
  const cx = 200, cy = 200;

  const rim = document.createElementNS(NS, "circle");
  rim.setAttribute("cx", cx);
  rim.setAttribute("cy", cy);
  rim.setAttribute("r", 181);
  rim.setAttribute("class", "rim");
  frame.appendChild(rim);

  const BULBS = 20;
  for (let i = 0; i < BULBS; i++) {
    const a = ((i * 360) / BULBS - 90) * (Math.PI / 180);
    const bulb = document.createElementNS(NS, "circle");
    bulb.setAttribute("cx", cx + 181 * Math.cos(a));
    bulb.setAttribute("cy", cy + 181 * Math.sin(a));
    bulb.setAttribute("r", 5.5);
    bulb.setAttribute("class", "bulb");
    bulb.style.animationDelay = `${(i % 4) * 0.25}s`;
    frame.appendChild(bulb);
  }
}

// ---------- rysowanie koła ----------
function buildWheel(pool) {
  wheelPool = pool;
  rotor.innerHTML = "";

  if (pool.length === 0) {
    wheelSvg.style.display = "none";
    if (!wheelHolder.querySelector(".wheel-empty")) {
      const div = document.createElement("div");
      div.className = "wheel-empty";
      div.textContent = "Dodaj ludzi w zakładce Zarządzanie, żeby zakręcić kołem.";
      wheelHolder.appendChild(div);
    }
    return;
  }

  const existingEmpty = wheelHolder.querySelector(".wheel-empty");
  if (existingEmpty) existingEmpty.remove();
  wheelSvg.style.display = "block";
  buildWheelFrame();

  const cx = 200, cy = 200, r = 168;
  const seg = 360 / pool.length;

  pool.forEach((person, i) => {
    // kąty liczone od góry, zgodnie z ruchem wskazówek zegara
    const start = i * seg - 90;
    const end = (i + 1) * seg - 90;
    const rad = (deg) => (deg * Math.PI) / 180;

    const x1 = cx + r * Math.cos(rad(start));
    const y1 = cy + r * Math.sin(rad(start));
    const x2 = cx + r * Math.cos(rad(end));
    const y2 = cy + r * Math.sin(rad(end));
    const largeArc = seg > 180 ? 1 : 0;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      pool.length === 1
        ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
        : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`
    );
    path.setAttribute("fill", person.color);
    path.setAttribute("stroke", "#ffffff");
    path.setAttribute("stroke-width", "3");
    path.dataset.index = i;
    path.dataset.personId = person.id;
    path.classList.add("seg");
    if (person.penalty) path.classList.add("seg-penalty");
    rotor.appendChild(path);

    const mid = start + seg / 2;
    const labelR = pool.length <= 2 ? 88 : 108;
    const tx = cx + labelR * Math.cos(rad(mid));
    const ty = cy + labelR * Math.sin(rad(mid));

    // tekst czytany wzdłuż promienia; po lewej stronie koła obracamy o 180°,
    // żeby imiona nie stały na głowie
    const midNorm = ((mid % 360) + 360) % 360;
    let textAngle = mid;
    if (midNorm > 90 && midNorm < 270) textAngle = mid + 180;

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", tx);
    text.setAttribute("y", ty);
    text.setAttribute("class", "seg-label" + (person.penalty ? " seg-label-penalty" : ""));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("transform", `rotate(${textAngle} ${tx} ${ty})`);
    text.setAttribute("pointer-events", "none");
    text.textContent = shortLabel(person.label || person.name.trim().split(/\s+/)[0]);
    rotor.appendChild(text);
  });
}

// ukarany pojawia się na kole PENALTY_WEIGHT razy — te wystąpienia rozrzucamy
// równomiernie po tarczy, żeby nie tworzyły jednego bloku
function expandPool(people, colorById) {
  const items = people.map((p) => ({ p, ile: p.penalty ? PENALTY_WEIGHT : 1 }));
  const N = items.reduce((s, it) => s + it.ile, 0);
  const slots = new Array(N).fill(null);

  // najpierw osoby z największą liczbą wystąpień: ich segmenty celują
  // w równo rozstawione pozycje na pierścieniu, reszta dopełnia wolne miejsca
  items.sort((a, b) => b.ile - a.ile);
  let offset = 0;

  for (const it of items) {
    for (let k = 0; k < it.ile; k++) {
      const target = Math.round((k * N) / it.ile + offset) % N;
      for (let d = 0; d < N; d++) {
        const kandydaci = [(target + d) % N, ((target - d) % N + N) % N];
        const wolne = kandydaci.find((i) => slots[i] === null);
        if (wolne !== undefined) { slots[wolne] = it.p; break; }
      }
    }
    offset += 0.7; // żeby kolejne osoby nie celowały dokładnie w te same miejsca
  }

  return slots.map((p) => ({ ...p, color: colorById.get(p.id) }));
}

// obraca koło tak, by środek segmentu zwycięzcy trafił pod wskaźnik
function spinTo(index) {
  return new Promise((resolve) => {
    const seg = 360 / wheelPool.length;
    const mid = index * seg + seg / 2;           // pozycja środka segmentu (od góry)
    const currentMod = ((rotation % 360) + 360) % 360;
    const delta = (360 - mid - currentMod + 360 * 2) % 360;
    const spins = 5; // 5 obrotów na 10 s = 0,5 obrotu/s, wolniej niż wcześniej

    rotation += spins * 360 + delta;
    rotor.classList.add("spinning");
    rotor.style.transform = `rotate(${rotation}deg)`;

    const done = () => {
      rotor.removeEventListener("transitionend", done);
      resolve();
    };
    rotor.addEventListener("transitionend", done);
    setTimeout(resolve, 10400); // zabezpieczenie, gdyby transitionend nie doszedł
  });
}

// ---------- render ----------
function render(state) {
  const active = state.people.filter((p) => p.active);
  const waiting = active.filter((p) => p.waiting);

  // bieżący tydzień
  if (state.current) {
    currentName.textContent = state.current.name;
    currentName.classList.remove("empty");
    currentMeta.textContent = `wylosowany(a) ${formatDate(state.current.date)} · runda ${state.current.round}`;
  } else {
    currentName.textContent = "jeszcze nikt nie wylosowany";
    currentName.classList.add("empty");
    currentMeta.textContent = "";
  }

  // pula na kole: czekający, a jeśli runda się domknęła — cała ekipa (nowa runda)
  const colorById = new Map(state.people.map((p, i) => [p.id, colorFor(i)]));
  const bazowa = waiting.length > 0 ? waiting : active;
  // etykiety liczone z całej ekipy, żeby nie zmieniały się w trakcie rundy,
  // gdy imiennik zejdzie z koła
  const labels = buildLabels(state.people);
  const zEtykietami = bazowa.map((p) => ({ ...p, label: labels.get(p.id) }));
  buildWheel(expandPool(zEtykietami, colorById));

  drawBtn.disabled = active.length === 0 || spinning;

  // przycisk odświeżenia budzi się tylko wtedy, gdy faktycznie jest co zdejmować
  const ukarani = state.people.filter((p) => p.penalty).length;
  clearPenaltiesBtn.disabled = ukarani === 0;
  clearPenaltiesBtn.classList.toggle("armed", ukarani > 0);
  clearPenaltiesBtn.dataset.tip = ukarani
    ? `Zdejmuje kary (${ukarani}) — koło wraca do stanu sprzed karania`
    : "Brak kar do zdjęcia";

  if (active.length === 0) {
    poolInfo.textContent = "";
  } else if (waiting.length === 0) {
    poolInfo.textContent = `Runda ${state.round} domknięta — kolejne losowanie otwiera rundę ${state.round + 1}.`;
  } else {
    poolInfo.textContent = `Runda ${state.round} · na kole ${waiting.length} z ${active.length} osób`;
  }

  // chipy czekających
  waitingChips.innerHTML = "";
  if (state.people.length === 0) {
    waitingChips.innerHTML = `<span class="empty-msg">Brak osób na liście.</span>`;
  }
  state.people.forEach((p) => {
    const span = document.createElement("span");
    span.className = "chip" + (!p.active ? " off" : p.waiting ? "" : " done");
    span.textContent = p.name + (!p.active ? " (urlop)" : "");
    waitingChips.appendChild(span);
  });

  // lista w zarządzaniu
  peopleList.innerHTML = "";
  if (state.people.length === 0) {
    peopleList.innerHTML = `<div class="empty-msg">Nikogo tu jeszcze nie ma — dodaj pierwszą osobę.</div>`;
  }
  state.people.forEach((p, i) => {
    if (p.id === editingId) {
      peopleList.appendChild(buildEditor(p, i));
      return;
    }
    const row = document.createElement("div");
    row.className = "person-row" + (p.active ? "" : " inactive");

    let status;
    if (!p.active) status = `<span class="status off">urlop</span>`;
    else if (p.penalty) status = `<span class="status penalty">kara ${PENALTY_WEIGHT}×</span>`;
    else if (p.waiting) status = `<span class="status wait">czeka</span>`;
    else status = `<span class="status done">był(a)</span>`;

    const first = escapeHtml(p.name.split(/\s+/)[0]);
    const statusTip = !p.active
      ? `${first} ma urlop — nie trafia na koło, ale zachowuje swoje miejsce w kolejce`
      : p.waiting
        ? `${first} czeka na swoją kolejkę i jest na kole`
        : `${first} prowadził(a) już w tej rundzie — wróci na koło po jej domknięciu`;
    const toggleTip = p.active
      ? `Wyłącz, gdy ${first} idzie na urlop — zniknie z koła, ale nie straci kolejki`
      : `Włącz z powrotem, gdy ${first} wraca — od razu wraca na koło`;

    row.innerHTML = `
      <div class="avatar" style="background:${colorFor(i)}" data-tip="${statusTip}">${initials(p.name)}</div>
      <span class="person-name">${escapeHtml(p.name)}</span>
      ${status}
      <span class="count" data-tip="Ile razy ta osoba prowadziła daily od początku">${p.timesPicked || 0}×</span>
      <label class="switch" data-tip="${toggleTip}">
        <input type="checkbox" class="active-toggle" data-id="${p.id}" ${p.active ? "checked" : ""}>
        <span class="slider"></span>
      </label>
      <button class="edit-btn" data-id="${p.id}"
              data-tip="Popraw imię, licznik, datę i status rundy">✎</button>
      <button class="remove-btn tip-end" data-id="${p.id}"
              data-tip="Usuwa z ekipy na stałe — wpisy w historii zostają">✕</button>
    `;
    peopleList.appendChild(row);
  });

  // historia
  historyList.innerHTML = "";
  undoBtn.disabled = state.history.length === 0;
  // pod ruletką pokazujemy cofanie dopiero, gdy jest co cofać
  undoTopBtn.classList.toggle("visible", state.history.length > 0);
  if (state.history.length === 0) {
    historyList.innerHTML = `<li class="empty-msg">Jeszcze nic tu nie ma.</li>`;
  }
  state.history.forEach((h) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escapeHtml(h.name)}</span><span class="history-date">${formatDate(h.date)} · runda ${h.round}</span>`;
    historyList.appendChild(li);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- dymki ----------
// Jeden pływający dymek doczepiony do <body>. Dymki rysowane pseudoelementem
// obcinały się o kontenery z przewijaniem (lista osób) i o krawędź okna;
// element w position:fixed wychodzi poza wszystkie takie konteksty,
// a pozycję docinamy do widocznego obszaru.
const tipbox = document.createElement("div");
tipbox.className = "tipbox";
document.body.appendChild(tipbox);

function pokazDymek(el) {
  const tekst = el.dataset.tip;
  if (!tekst) return;

  tipbox.textContent = tekst;
  tipbox.classList.add("show");

  const r = el.getBoundingClientRect();
  const t = tipbox.getBoundingClientRect();
  const margines = 8;

  // domyślnie nad elementem; gdy brakuje miejsca — pod spodem
  let gora = r.top - t.height - 10;
  if (gora < margines) gora = r.bottom + 10;
  gora = Math.max(margines, Math.min(gora, window.innerHeight - t.height - margines));

  let lewa = r.left + r.width / 2 - t.width / 2;
  lewa = Math.max(margines, Math.min(lewa, window.innerWidth - t.width - margines));

  tipbox.style.top = `${gora}px`;
  tipbox.style.left = `${lewa}px`;
}

function ukryjDymek() {
  tipbox.classList.remove("show");
}

document.addEventListener("pointerover", (e) => {
  const el = e.target.closest && e.target.closest("[data-tip]");
  if (el) pokazDymek(el);
  else ukryjDymek();
}, true);

document.addEventListener("pointerdown", ukryjDymek, true);
document.addEventListener("focusin", (e) => {
  const el = e.target.closest && e.target.closest("[data-tip]");
  if (el) pokazDymek(el);
}, true);
document.addEventListener("focusout", ukryjDymek, true);
window.addEventListener("scroll", ukryjDymek, true);
window.addEventListener("resize", ukryjDymek);

// klik w segment nakłada albo zdejmuje karę za spóźnienie
rotor.addEventListener("click", async (e) => {
  const path = e.target.closest(".seg");
  if (!path || spinning || counting) return;
  try {
    const { penalty, name, state } = await api(`/api/people/${path.dataset.personId}/penalty`, {
      method: "POST",
    });
    render(state);
    toast(
      penalty
        ? `⏰ ${name} ma karę — ${PENALTY_WEIGHT}× na kole przy najbliższym losowaniu.`
        : `Kara zdjęta: ${name}.`
    );
  } catch (err) {
    toast(err.message);
  }
});

async function refresh() {
  const state = await api("/api/state");
  render(state);
  return state;
}

// ---------- edytor osoby ----------
function buildEditor(p, i) {
  const box = document.createElement("div");
  box.className = "person-edit";
  box.innerHTML = `
    <div class="edit-head">
      <div class="avatar" style="background:${colorFor(i)}">${initials(p.name)}</div>
      <strong>Edycja: ${escapeHtml(p.name)}</strong>
    </div>

    <label class="field">
      <span>Imię i nazwisko</span>
      <input type="text" id="ed-name" value="${escapeHtml(p.name)}">
    </label>

    <div class="field-row">
      <label class="field">
        <span data-tip="Ile razy ta osoba prowadziła daily od początku">Ile razy prowadził(a)</span>
        <input type="number" id="ed-times" min="0" step="1" value="${p.timesPicked || 0}">
      </label>

      <label class="field">
        <span data-tip="Puste pole = nigdy nie prowadził(a)">Ostatnio prowadził(a)</span>
        <div class="date-wrap">
          <input type="date" id="ed-date" value="${p.lastPicked || ""}">
          <button type="button" id="ed-date-clear" class="clear-date"
                  data-tip="Czyści datę całkowicie">✕</button>
        </div>
      </label>
    </div>

    <div class="field-row">
      <label class="field">
        <span data-tip="Ustaw „czeka”, jeśli losowanie poszło przez pomyłkę i osoba ma wrócić do puli">Status w tej rundzie</span>
        <select id="ed-waiting">
          <option value="true"${p.waiting ? " selected" : ""}>czeka na kolejkę (jest na kole)</option>
          <option value="false"${!p.waiting ? " selected" : ""}>już prowadził(a) w tej rundzie</option>
        </select>
      </label>

      <label class="field">
        <span data-tip="Wyłączona osoba nie trafia na koło, ale zachowuje miejsce w kolejce">Dostępność</span>
        <select id="ed-active">
          <option value="true"${p.active ? " selected" : ""}>w grze</option>
          <option value="false"${!p.active ? " selected" : ""}>urlop / niedostępny</option>
        </select>
      </label>
    </div>

    <div class="edit-actions">
      <button class="save-btn" id="ed-save">Zapisz</button>
      <button class="cancel-btn" id="ed-cancel">Anuluj</button>
      <button class="zero-btn" id="ed-zero"
              data-tip="Zostawia imię i nazwisko, zeruje licznik, datę, karę i wraca na koło">Wyzeruj dane</button>
    </div>
  `;

  // kalendarz otwiera się po kliknięciu w dowolne miejsce pola,
  // nie tylko w małą ikonkę po prawej
  const dateInput = box.querySelector("#ed-date");
  const openCalendar = () => {
    if (typeof dateInput.showPicker === "function") {
      try {
        dateInput.showPicker();
      } catch {
        /* przeglądarka odmówiła (np. brak gestu użytkownika) — zostaje ikonka */
      }
    }
  };
  dateInput.addEventListener("click", openCalendar);
  dateInput.addEventListener("focus", openCalendar);

  box.querySelector("#ed-date-clear").addEventListener("click", () => {
    dateInput.value = "";
  });

  box.querySelector("#ed-zero").addEventListener("click", async () => {
    if (!confirm(`Wyzerować dane osoby ${p.name}?\n\nImię i nazwisko zostaje. Licznik, data i kara wracają do zera, osoba wraca na koło. Wpisy w historii zostają nietknięte.`)) return;
    try {
      const { name, state } = await api(`/api/people/${p.id}/reset`, { method: "POST" });
      editingId = null;
      render(state);
      toast(`Wyzerowano dane: ${name}.`);
    } catch (err) {
      toast(err.message);
    }
  });

  box.querySelector("#ed-cancel").addEventListener("click", () => {
    editingId = null;
    refresh();
  });

  box.querySelector("#ed-save").addEventListener("click", async () => {
    const payload = {
      name: box.querySelector("#ed-name").value,
      timesPicked: Number(box.querySelector("#ed-times").value),
      lastPicked: box.querySelector("#ed-date").value || null,
      waiting: box.querySelector("#ed-waiting").value === "true",
      active: box.querySelector("#ed-active").value === "true",
    };
    try {
      const state = await api(`/api/people/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      editingId = null;
      render(state);
      toast("Zapisano zmiany.");
    } catch (err) {
      toast(err.message);
    }
  });

  return box;
}

// ---------- akcje ----------
drawBtn.addEventListener("click", async () => {
  // w trakcie odliczania przycisk działa jak Stop
  if (counting) {
    abortRequested = true;
    return;
  }
  if (spinning) return;

  spinning = true;
  abortRequested = false;
  counting = true;
  drawBtn.textContent = "⏹ Stop";
  drawBtn.classList.add("stop-mode");
  document.body.classList.add("is-spinning");
  ensureAudio(); // odblokowanie audio musi paść w geście użytkownika

  let stopTicking = () => {};

  try {
    // odliczanie NAJPIERW, dopiero potem zapytanie do serwera —
    // dzięki temu Stop nie zostawia po sobie zapisanego losowania
    const wystartowalo = await runCountdown();
    counting = false;
    drawBtn.classList.remove("stop-mode");

    if (!wystartowalo) {
      document.body.classList.remove("is-spinning");
      toast("Zatrzymane — nic nie wylosowano.");
      return;
    }

    drawBtn.disabled = true;
    drawBtn.textContent = "Kręci się…";

    // serwer decyduje o wyniku (uczciwa rotacja), koło tylko go pokazuje
    const { picked, state } = await api("/api/draw", { method: "POST" });

    // ukarany ma na kole kilka segmentów — wybieramy losowo jeden z nich,
    // żeby animacja nie zatrzymywała się zawsze na tym samym
    const jego = wheelPool
      .map((p, i) => (p.id === picked.id ? i : -1))
      .filter((i) => i !== -1);
    const index = jego.length ? jego[Math.floor(Math.random() * jego.length)] : -1;
    if (index === -1) {
      // pula na kole rozjechała się ze stanem serwera — pokaż wynik bez animacji
      document.body.classList.remove("is-spinning");
      render(state);
      toast(`Wylosowano: ${picked.name}`);
      return;
    }

    stopTicking = startTicking(wheelPool.length);
    await spinTo(index);
    stopTicking();

    // finał
    const seg = rotor.querySelector(`path[data-index="${index}"]`);
    if (seg) seg.classList.add("winner-seg");

    document.body.classList.remove("is-spinning");
    currentName.textContent = picked.name;
    currentName.classList.remove("empty", "reveal");
    void currentName.offsetWidth;
    currentName.classList.add("reveal");

    fanfare();
    confettiBurst();
    toast(`🎉 ${picked.name} prowadzi daily!`);

    await sleep(1800); // chwila na obejrzenie pulsującego segmentu
    render(state);
  } catch (err) {
    toast(err.message);
  } finally {
    stopTicking();
    document.body.classList.remove("is-spinning", "is-counting");
    countdownEl.classList.remove("tick", "final");
    countdownEl.textContent = "";
    spinning = false;
    counting = false;
    abortRequested = false;
    drawBtn.classList.remove("stop-mode");
    drawBtn.disabled = false;
    drawBtn.textContent = "Zakręć kołem";
  }
});

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = newNameInput.value.trim();
  if (!name) return;
  try {
    const state = await api("/api/people", { method: "POST", body: JSON.stringify({ name }) });
    newNameInput.value = "";
    render(state);
    toast(`Dodano: ${name}`);
  } catch (err) {
    toast(err.message);
  }
});

peopleList.addEventListener("change", async (e) => {
  if (!e.target.classList.contains("active-toggle")) return;
  try {
    const state = await api(`/api/people/${e.target.dataset.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: e.target.checked }),
    });
    render(state);
  } catch (err) {
    toast(err.message);
  }
});

peopleList.addEventListener("click", async (e) => {
  if (e.target.classList.contains("edit-btn")) {
    editingId = e.target.dataset.id;
    refresh();
    return;
  }
  if (!e.target.classList.contains("remove-btn")) return;
  if (!confirm("Usunąć tę osobę z listy?")) return;
  try {
    const state = await api(`/api/people/${e.target.dataset.id}`, { method: "DELETE" });
    render(state);
  } catch (err) {
    toast(err.message);
  }
});

async function undoLastDraw() {
  if (spinning || counting) return; // nie cofamy w trakcie trwającego losowania
  try {
    const { undone, state } = await api("/api/undo", { method: "POST" });
    rotation = 0;
    rotor.classList.remove("spinning");
    rotor.style.transform = "rotate(0deg)";
    render(state);
    toast(`Cofnięto losowanie: ${undone.name} (${formatDate(undone.date)}).`);
  } catch (err) {
    toast(err.message);
  }
}

undoBtn.addEventListener("click", undoLastDraw);
undoTopBtn.addEventListener("click", undoLastDraw);

clearPenaltiesBtn.addEventListener("click", async () => {
  if (spinning || counting) return;
  try {
    const { zdjete, state } = await api("/api/penalties/clear", { method: "POST" });
    render(state);
    toast(
      zdjete.length
        ? `Koło wróciło do normy — zdjęto kary: ${zdjete.join(", ")}.`
        : "Nie ma żadnych kar do zdjęcia."
    );
  } catch (err) {
    toast(err.message);
  }
});

exportBtn.addEventListener("click", async () => {
  const state = await api("/api/state");
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `daily-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

importInput.addEventListener("change", async () => {
  const file = importInput.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const state = await api("/api/import", { method: "POST", body: JSON.stringify(parsed) });
    render(state);
    toast("Dane zaimportowane.");
  } catch (err) {
    toast("Nie udało się zaimportować: " + err.message);
  } finally {
    importInput.value = "";
  }
});

resetBtn.addEventListener("click", async () => {
  // dwa zamki: przypadkowy klik (albo automat klikający w tle) nie skasuje danych
  if (!confirm("To usunie wszystkie osoby, historię i bieżący tydzień. Na pewno?")) return;
  const answer = prompt('Ostatnia szansa. Wpisz KASUJ, żeby potwierdzić:');
  if (answer !== "KASUJ") {
    toast("Anulowane — nic nie skasowano.");
    return;
  }
  const state = await api("/api/reset", { method: "POST" });
  rotation = 0;
  rotor.classList.remove("spinning");
  rotor.style.transform = "rotate(0deg)";
  render(state);
  toast("Wyczyszczone.");
});

// zakładki
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("view-" + tab.dataset.view).classList.add("active");
  });
});

// ---------- wylogowanie (tylko gdy hasło jest włączone) ----------
const logoutBtn = document.getElementById("logoutBtn");

logoutBtn.addEventListener("click", async () => {
  if (!confirm("Wylogować się z tego urządzenia?")) return;
  try {
    await api("/api/logout", { method: "POST" });
    location.href = "/";
  } catch (err) {
    toast(err.message);
  }
});

api("/api/auth-check")
  .then((a) => { if (a.wymaganeHaslo) logoutBtn.hidden = false; })
  .catch(() => {});

// ---------- start ----------
api("/api/state").then(render).catch((err) => toast(err.message));
