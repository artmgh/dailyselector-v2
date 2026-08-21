# Kto prowadzi daily?

Losowanie osoby prowadzącej daily — koło fortuny z uczciwą rotacją: nikt nie wypada
drugi raz, dopóki cała ekipa nie zaliczy swojej kolejki.

## Uruchomienie

```bash
npm install
node server.js
```

Appka startuje na `http://localhost:3000`. Port można zmienić zmienną `PORT`.

## Jak to działa

**Losowanie** — koło kręci się 15 sekund: 5 s odliczania i 10 s obrotu. O wyniku
decyduje serwer, a koło zatrzymuje się dokładnie na wskazanej osobie, więc animacja
pokazuje prawdziwy wynik, a nie osobne losowanie.

**Rotacja** — wylosowany wypada z puli bieżącej rundy. Gdy pula się opróżni, rusza
kolejna runda z pełnym składem.

**Urlop** — wyłączona osoba nie trafia na koło, ale nie traci swojego miejsca
w kolejce; po powrocie wraca do puli bieżącej rundy.

**Kara za spóźnienie** — kliknięcie imienia na kole daje karę: ta osoba pojawia się
na kole pięć razy zamiast raz, czyli ma pięciokrotnie większą szansę. Kara działa na
jedno najbliższe losowanie i sama znika. Ponowny klik ją zdejmuje, a przycisk ↻ w rogu
karty zdejmuje wszystkie naraz.

**Cofanie** — przywraca stan sprzed ostatniego losowania: kasuje wpis z historii,
zmniejsza licznik, przywraca poprzednią datę, wrzuca osobę z powrotem na koło i cofa
bieżący tydzień. Jeśli cofane losowanie otwierało nową rundę, numer rundy też się cofa.

**Edycja** — każde pole osoby można poprawić ręcznie: imię, licznik, datę, status
w rundzie i dostępność. „Wyzeruj dane" zostawia imię i nazwisko, a resztę przywraca
do stanu początkowego. Zmiana imienia poprawia je również wstecz w historii.

## Dane

Wszystko siedzi w `data.json` obok `server.js` — zwykły plik, bez bazy danych.
Nie jest wersjonowany, bo zawiera skład zespołu. Przed każdą operacją niszczącą
(czyszczenie, import) serwer zapisuje kopię jako `data.snapshot-<data>-<powód>.json`.

W zakładce Zarządzanie są też ręczny eksport i import w formacie JSON.

## API

| Metoda | Ścieżka | Opis |
| --- | --- | --- |
| GET | `/api/state` | pełny stan |
| POST | `/api/people` | dodanie osoby |
| PATCH | `/api/people/:id` | edycja pól osoby |
| DELETE | `/api/people/:id` | usunięcie osoby |
| POST | `/api/people/:id/reset` | wyzerowanie danych osoby |
| POST | `/api/people/:id/penalty` | włączenie / zdjęcie kary |
| POST | `/api/penalties/clear` | zdjęcie wszystkich kar |
| POST | `/api/draw` | losowanie |
| POST | `/api/undo` | cofnięcie ostatniego losowania |
| POST | `/api/reset` | wyczyszczenie wszystkiego |
| POST | `/api/import` | wgranie kopii |

## Stos

Node.js z Express po stronie serwera, po stronie przeglądarki czysty HTML, CSS
i JavaScript — bez frameworków i bez zewnętrznych zasobów. Koło jest rysowane w SVG,
dźwięki generowane przez WebAudio, konfetti na canvasie.
