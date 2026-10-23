# HomeApprox – ÖV-Verbindungen über mehrere Haltestellen

Stand: 23.10.2026. Dieses Dokument beschreibt den aktuellen Zustand; die
Entstehungsgeschichte steht in der Git-History dieser Datei.

Dateien: `index.html` (App, eine Datei), `tests/` (`npm test`, Node ≥ 20,
keine Abhängigkeiten), `package.json`. Deploy: GitHub Pages, Branch `master`.

---

## Problem

Zuhause liegen mehrere Haltestellen in Gehdistanz (2–15 Min.). SBB-App und
API zeigen pro Abfrage nur die Pareto-besten Verbindungen (Ankunft, Umstiege);
die Abwägung «länger laufen, dafür anderer Zug» und «Bus oder zu Fuss zum
selben Zug» bleibt unsichtbar. HomeApprox fragt pro Haltestelle und zeigt
alle Varianten mit eigener Gehzeit.

## Datenquelle

`https://transport.opendata.ch/v1` – seit 5.10.2026 eigener Planer (MOTIS)
auf dem nationalen GTFS, Echtzeit via `prognosis`. Parameter `/connections`:
`from, to, via[] (≤2), date, time, isArrivalTime, transportations[], limit,
page, sharedMobility`. Kein Parameter gegen Fusswege; Fusswege via OSM bis
20 Min. CORS offen, kein Key. Feldformen (verifiziert): `prognosis.departure`
ISO-String, `walk.duration` Sekunden, `journey.name` = Trip-ID, `platform`
auch an `passList`-Halten.

## Modell

```
Place = { name, custom, home?, stops: [{ name, walkMin, secondary? }] }
  station("Bern")  →  ein Stop, Gehzeit 0, custom: false
  Zuhause          →  7 Stops, custom: true, home: true (Standard-«Von»)

Suche = Paare (from, to) aus «Von» × «Nach» (ein Von, ein oder mehrere Nach)

Pro Stop-Paar (sf → st):
  Basis   /connections ab t (Ab: t = Zeit + Gehzeit sf; An: t = Zeit − Gehzeit st)
          API-Fussweg am eigenen Ende → Trip verworfen (andere Haltestelle erreicht)
  Tafel   am eigenen Ende Bus/Tram-Zeiten im Fenster [min(Basis) − 20', max(Basis) + 20']
          Von-Seite: Abfahrten → /connections Ab zu jeder Zeit, nur Trips, deren
                     erster Abschnitt diese Fahrt ist
          Nach-Seite: Ankünfte → /connections An zu jeder Zeit, nur Trips, deren
                     letzter Abschnitt diese Fahrt ist
          max. 6 Nachfragen pro Stop, limit 3
```

Warum die Tafel: der Planer versteckt einen Bus ab Haltestelle, sobald ein
Fussweg denselben Zug erreicht (gleiche Ankunft, weniger Umstiege). Fragt man
exakt zur Busabfahrt, schafft der Fussweg den Zug nicht mehr, und der Bus
erscheint – inkl. Umsteigefussweg und Gleisen von der API.

Journey: `walkStartMin/walkEndMin`, `start/end` (Haustür zu Haustür),
`transitStart/transitEnd`, `legs` (RIDE / WALK ≥ 5' / CHANGE < 5'),
`transfers`, `fromPlace/toPlace`, `fromStop/toStop`, `hasExtraWalk`,
`query` (was an die API ging, inkl. `board` bei Nachfragen).

Pruning pro eigenem Ende: Duplikate (gleiche Fahrten, gleiche Zeiten);
`secondary`-Stops nur, wenn ihr Fahrzeug nicht schon über einen anderen Stop
vorkommt; gleiches Fahrzeug an zwei Stops → nur der mit spätestem Losgehen
(Von) bzw. frühester Ankunft (Nach), Gleichstand bleibt.

Fenster: immer ≥ 30 Min. (`MIN_WINDOW_MIN`, Paging bis `MAX_PAGES` = 4);
«Ab» holt zusätzlich 5 Min. zurück (`RECENT_PAST_MIN`, Karte gestrichelt,
Tag «vor N Min.»). «Frühere/Spätere» erweitern um 30 Min. und mischen.
Sichtbar: alles im Fenster, danach bis `MAX_RESULTS` = 15.

## Schichten

```
UI ──► Planner (Paare, Tafel-Nachfragen, Pruning, Fenster, Alternativen, Namen)
   │        └──► TransportApi (connections, locations, boardTimes; Live-Zeiten)
   ├──► Places   (eigene Orte)              ──► localStorage homeapprox.places
   └──► Stations (Zuletzt 5, Favoriten)     ──► localStorage homeapprox.stations
```

## Orte

- Speicher leer oder ohne `home`-Ort → Zuhause wird eingefügt (Seed aus
  `HOME_STOPS`). Danach gewöhnlich: editier-, lösch-, umbenennbar.
- Zuhause: Furtbach 2', Ifang 6', Glatt (Tram) 13', Glatt (Bus) 14' (neben),
  Dietlikon 15', Wallisellen 15', Säntisstrasse 8' (neben).
- Editor hinter ⚙ (Kopfzeile rechts): Liste `★ Name ✎` + Stops darunter,
  Formular mit Titel und Spaltenkopf «Haltestelle | Min. | Neben», Löschen im
  Formular. ★ = Standard-Von. Suchteil ist dabei ausgegraut.
- Austausch: `{ "homeapprox": 1, "places": [...] }` als Datei
  (`homeapprox-orte.json`, Export/Import, Import mischt nach Name) oder Link
  `…#places=<URL-encoded JSON>` (Fragment, erreicht keinen Server; beim Öffnen
  importiert, Karte auf, Fragment entfernt).
- `Places.resolve(name)` → eigener Ort oder `station(name)`; gilt für Von und Nach.

## Formular

`Von` (Standard: home-Ort) ⇅ `Nach` (ein Ort im Feld, «+» parkt ihn als Chip
für weitere), Ab/An, 📅 (nur Icon, wenn heute; sonst «📅 Fr 24.10.»), Zeit, 🚆.
Vorschläge ab 3 Zeichen (`/locations`, max. 6); leeres Feld: Orte (⌂),
Favoriten (★), Zuletzt. Bekannter Ort im Feld → ⌂ im Feld. «Neue Suche ab …»
in den Details füllt Von = Umsteigeort, Nach = Zielort.

## Resultatkarte

```
09:11 – 10:08                               [4 Min. früher] [57 Min.]
 Zuhause  Ifang        Aubrücke       Schwamendingerplatz
 ····●────[ 787 ]───▒▒▒───[ 62 ]────────····
```

- Zeiten Haustür zu Haustür, Dauer-Pille farbig (grün → dunkelrot über die
  Dauern vor den Filtern).
- Balken auf gemeinsamer Zeitachse: grün gepunktet = eigene Fusswege und
  Fussweg ≥ 5', grau dünn = Warten/Umsteigen (< 5'), blau = Fahrt mit Linie
  (Tram `T12`, Zug `S8`, Bus `787`), Blasen = Haltestellen (Start, Umstiege,
  Ende, Fussweg-Enden; grün = eigener Ort). Blasen rutschen seitlich, dann
  zweite Zeile, dann Abkürzung (`shortName` → `stopAbbr`, max. 6 Zeichen).
- Start-Zoom: Durchschnittsdauer füllt 80 % der Karte; Pinch/Ctrl+Rad zoomt
  1–12×, Ein-Finger-Wischen/Shift+Rad scrollt alle Balken synchron;
  vertikales Scrollen verankert die oberste Karte links.
- Klick: Tabelle der Abschnitte (Zeit, Einstieg mit Gleis-Schild, Linie,
  Richtung antippbar, Ausstieg mit Gleis-Schild, Zeit; Verspätung «+9» rot),
  pro Umstieg «Ab X: [Alternativen] [Neue Suche]», Zeile «Abfrage: …».
- Alternativen: Verbindungen ab Umsteigeort zum Ziel, ab Ankunft − 20' (max. 3
  vor meiner Ankunft, blass) bis geplante + 3 danach; ± = Abfahrt gegenüber
  meiner Ankunft («−4», «geplant +4», «+11»); aufklappbar.

## Filterkarte

```
⏱  [31 Min.] – [52 Min.] (max. 69 Min.)      ✂  ↺
⇄  0 – 2× umsteigen                          ✂
🚶 Mit zusätzlichem Fussweg (3/8)            [x]
🚌 Linien ▸   /   [S8] [S19] [T12] [62] ▾     ↺
```

- ✂ / Klick auf Maximum: Obergrenze auf den grössten Wert ≤ Maximum − 5' (Dauer)
  bzw. nächsttieferen Wert (Umstiege). Klick auf Minimum: Grenze so, dass
  ≥ 10 % der Verbindungen bleiben. «(max. …)» und ↺ heben auf.
- Klammerwerte zeigen, was der jeweilige Filter allein ausblendet (alle anderen
  angewandt). Farbskala bleibt ungefiltert.
- Linien: Chips aller gefahrenen Linien, mehrere = ODER, eingeklappt mit Anzahl.
- Neue Suche setzt alle Filter zurück; Frühere/Spätere behalten sie.

## Konstanten (Auswahl)

`CONNECTIONS_PER_STOP` 6 · `MAX_PAGES` 4 · `MIN_WINDOW_MIN` 30 · `RECENT_PAST_MIN` 5 ·
`MORE_STEP_MIN` 30 · `MAX_RESULTS` 15 · `TRANSFER_WALK_MAX_MIN` 5 ·
`BOARD_LIMIT` 40 · `BOARD_MODES` bus, tram · `BOARD_MAX_REQUERIES` 6 ·
`REQUERY_LIMIT` 3 · `BOARD_SLACK_MIN` 20 · `ALT_BEFORE_MIN` 20 · `ALT_LIMIT` 6 ·
`STOP_ABBR_MAX` 6 · `PIN_ROWS` 2 · `ZOOM_MAX` 12 · `BAR_FILL` 0.8 ·
`DURATION_CUT_STEP_MIN` 5 · `KEEP_SHARE` 0.1.

## Tests

`tests/load-app.mjs` lädt das `<script>` aus `index.html` in eine Node-VM mit
DOM-Stub und gemocktem `fetch` (Fixtures `ride`, `walk`, `conn`, `boardEntry`;
Tafeln via `board:<Station>` / `arrboard:<Station>`). 67 Tests: Linienlabels,
Fussweg/Umsteigen, Abkürzungen, Zeitverschiebung, saubere Enden, Fenster und
Paging, Toggle, Tafel-Nachfragen, Pruning, Alternativen, Vorschläge,
Zuletzt/Favoriten, Farbskala, Anderer Ort, Neue Suche, Frühere/Spätere,
eigene Orte, Speicher, Austausch. Darstellung ist nicht getestet.

## Arbeitsweise

- Nach jeder Änderung: `npm test`, dieses Dokument nachführen.
- Git-Schreibbefehle nur vom User ausführen (Sandbox hinterlässt
  `.git/*.lock`); Claude liefert die Commit-Message.

## Offene Punkte

- Umsteigezeit am Hub kommt von der API (vorher 4–5' je Zubringer): im Alltag prüfen.
- Fenster-Slack 20' für Tafel-Nachfragen ist geraten.
- `stopAbbr`/`shortName` kürzen zweiwortige Orte falsch («Bad Ragaz» → «Ragaz»).
- Optional: Koordinate pro Ort für eine «API-Sicht» (Planer fächert selbst auf).
