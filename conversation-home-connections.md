# Heimweg – ÖV-Verbindungen über mehrere Haltestellen

Artefakt: `home-connections.html` (separate Datei).

---

## User

ich nutze die SBB App um öv verbindungen zu suchen. Aber wo ich wohne gibt es mehrere Optionen als Zielbahnhof oder haltestelle. Ich möchte alle Optionen im Überblick sehen, vor allem, weil ich auch gern laufe. Es gibt Zielhaltestellen in 15min Fussentfernung, die für mich präferiert werden. Ich kann diese Art von Suche in der SBB App nicht durchführen - soweit ich weiss. Kannst du mir etwas empfehlen?

## Claude

**Adresse statt Haltestelle als Ziel**
SBB App und search.ch akzeptieren Adressen als Ziel und rechnen den Fussweg ab mehreren Haltestellen ein. Unsicher bin ich, wie weit der Fussweg gehen darf. Bei 15 Minuten wird vermutlich abgeschnitten, und Fusswege werden eher vermieden statt bevorzugt. Ausprobieren kostet nichts.

**Google Maps (ÖV-Modus, Ziel = Adresse)**
Kombiniert ÖV und längere Fusswege oft besser. Daten sind aber weniger zuverlässig als bei SBB, besonders bei Störungen.

**Eigenes Tool (am flexibelsten)**
Die offene API `transport.opendata.ch` liefert SBB-Fahrplandaten:

1. Pro Zielhaltestelle eine Abfrage an `/connections` senden.
2. Die feste Gehzeit zur Wohnung addieren (z. B. Haltestelle A: 15 Min., B: 5 Min.).
3. Alle Verbindungen nach Ankunft zu Hause sortieren.

Das wäre eine einfache HTML-Seite, z. B. auf GitHub Pages, ohne Backend.

Soll ich das Tool bauen? Dann bräuchte ich die Zielhaltestellen und die jeweilige Gehzeit.

---

## User

Klingt spannend - wir können einen Versuch machen.
Für den ersten Prototypen geht es nur um Verbindungen von zu Hause oder nach Hause.
Die nächste Haltestellen

* Furtbach, Wallisellen, +2 Min zu Fuss
* Ifang, Wallisellen, +6 Min zu Fuss
* Glatt, Wallisellen, +14 Min zu Fuss
* Dietlikon Bahnhof, +15 Min zu Fuss
* Wallisellen Bahnhof, +15 Min zu Fuss

## Claude

*(Erstellt `home-connections.html`.)*

`home-connections.html` ist fertig, aber ungetestet. Ich konnte die API von hier aus nicht erreichen.

**Funktion**
- Richtung wählen: nach Hause oder von zu Hause.
- Zeit wählen: Abfahrt oder Ankunft.
- Alle 5 Haltestellen werden parallel abgefragt, die Gehzeit wird eingerechnet.
- Sortierung: bei Abfahrt nach frühester Ankunft, bei Ankunft nach spätester Startzeit.
- Pro Verbindung zeigt ein Zeitbalken Fussweg (gepunktet) und ÖV-Fahrt.

**Nutzung**
Datei lokal im Browser öffnen oder auf GitHub Pages stellen. Die Vorschau in claude.ai blockiert vermutlich den API-Zugriff.

**Unsicher**
- Haltestellennamen in `HOME_STOPS`, besonders `Wallisellen, Glatt`. Die API löst Namen unscharf auf. Unter jeder Verbindung steht der tatsächlich verwendete Name, so siehst du falsche Treffer sofort.
- Feld `products` (Linienbezeichnungen): Format aus dem Gedächtnis, nicht verifiziert.

Liefert es plausible Resultate, wenn du es öffnest?

---

## User

Es funktioniert. Verbesserungen vor dem Deploy auf GitHub:

* Titel: HomeApprox
* Zeit immer 24h
* Ort-Feld: Suchhilfe ab 3 Zeichen
* Letzte 5 Orte sehen, einige als Favoriten speichern
* Sortierung nach Abfahrtszeit (in beiden Modi)
* Umsteigen auf einen Blick: Punkt im blauen Balken, separate Zeile mit Haltestelle und Zeit

## Claude

*(Aktualisiert `home-connections.html`.)*

- Zeitausgabe 24h. Das Zeit-Eingabefeld folgt der Browser-Locale, nicht steuerbar.
- Ort: ab 3 Zeichen `/locations` (debounced), max. 6 Treffer. Leeres Feld bei Fokus: Favoriten + Zuletzt. Stern pro Zeile = Favorit. localStorage.
- Sortierung: immer Abfahrt aufsteigend.
- Umsteigen aus `sections` (nur Fahrzeug-Abschnitte). Punkt im Balken, Zeile «Umsteigen: Ort Zeit».

Unsicher: `sections[].journey` null bei Fussabschnitten, `stations[].name` in `/locations`. Aus dem Gedächtnis, nicht verifiziert.

---

## User

Klick auf eine Verbindung soll alle Details zeigen. Einige Verbindungen ergeben keinen Sinn, ich will die Ausgabe verstehen.

## Claude

*(Aktualisiert `home-connections.html`.)*

Klick klappt Details auf:
- Pro Abschnitt: Linie → Richtung, Abfahrt Ort Gleis → Ankunft Ort. Fusswege mit Minuten.
- Zeile «Abfrage: von → nach, ab/an Zeit» = was tatsächlich an die API ging (inkl. Gehzeit-Verschiebung).

Ursachen für unsinnige Resultate, die du damit erkennst:
- Falsch aufgelöster Haltestellenname (steht in «Abfrage»).
- Umwege, weil die API pro Haltestelle plant und nicht weiss, dass die Haltestellen nebeneinander liegen.

---

## User

Die API liefert auch Verbindungen mit «Fussweg»-Abschnitten. Erkennen und:

* Fussweg nur am fernen Ende erlauben (Heim-Ende ist durch HOME_STOPS definiert).
* Fussweg gleich darstellen wie am Heim-Ende: grün gepunktet.
* Toggle: Verbindungen mit zusätzlichem Fussweg zeigen oder ausfiltern.

## Claude

*(Aktualisiert `home-connections.html`.)*

- Fussweg-Abschnitt am Heim-Ende (erster Abschnitt bei «Von zu Hause», letzter bei «Nach Hause») → Verbindung verworfen. Die API hat dann eine andere Haltestelle angefahren als gefragt.
- Balken zeichnet jeden Abschnitt: Fahrt blau, Fussweg grün gepunktet.
- Checkbox «Verbindungen mit zusätzlichem Fussweg zeigen» (Standard an). Aus = alle Verbindungen mit Fussweg-Abschnitt gefiltert, auch Umsteige-Fusswege.
- Meta-Zeile zeigt «+ Fussweg».

---

## User

Umsteigen hinterlässt Löcher im Balken, dritte Darstellung dafür. Fussweg < 5 Min. als Umsteigen behandeln (keine grüne Linie).

## Claude

*(Aktualisiert `home-connections.html`.)*

- Dünne graue Spur unter der ganzen ÖV-Strecke; sichtbar nur in Lücken (Wartezeit) und bei kurzen Umsteige-Fusswegen.
- Fussweg < 5 Min. (`TRANSFER_WALK_MAX_MIN`) = `LegKind.CHANGE`: grau, zählt nicht als «+ Fussweg», wird vom Toggle nicht gefiltert. Details: «Umsteigen zu Fuss 3 Min.».
- Heim-Ende: nur ein Fahrt-Abschnitt ist erlaubt, auch kurze Fusswege dort verwerfen die Verbindung.

---

## Design-Notizen

```
Home ──walk──► Stop A ──transit──► Place
     ──walk──► Stop B ──transit──►
     ──walk──► ...

UI ──► Planner (Gehzeit, Merge, Sortierung, Vorschläge) ──► TransportApi (HTTP)
UI ──► Stations (Zuletzt, Favoriten) ──► localStorage
```

Zeitverschiebung für die API-Abfrage:
- Von zu Hause + Abfahrt: Abfahrt ab Haltestelle = Zeit + Gehzeit.
- Nach Hause + Ankunft: Ankunft an Haltestelle = Zeit − Gehzeit.
- Sonst: Zeit unverändert.

Fussweg-Abschnitte der API:
```
fromHome: [walk?] ride … ride [walk]   ← erster Abschnitt darf kein walk sein
toHome:   [walk] ride … ride [walk?]   ← letzter Abschnitt darf kein walk sein
```

Balken (Ebenen von unten nach oben):
```
grün gepunktet  Heimweg (HOME_STOPS) und Fussweg ≥ 5 Min.
grau dünn       Warten / Umsteigen (Lücken, Fussweg < 5 Min.)
blau            Fahrt
Punkt           Umsteigeort
```

Umsteigen: Ankunft eines Fahrzeug-Abschnitts, dem ein weiterer folgt.
`S8 ──► Oerlikon ──► S19` = 1× Umsteigen in Oerlikon.

Erledigt:
- Haltestellennamen und `products` funktionieren (vom User bestätigt).

Offene Punkte:
- `sections`-Format und `/locations`-Antwort gegen API prüfen.
- Deploy auf GitHub Pages.

---

## User

Tram-Linien mit T präfixen. Liniennummer auf blauen Streifen. Im grauen Umsteige-Balken Haltestellenname (oder Abkürzung). Erste Zeile ohne Gehzeit und ohne Anzahl Umstiege. Zweite Zeile «Umsteigen» nur Haltestellen, ohne Uhrzeit. Toggle filtert die vorhandenen Ergebnisse statt neu zu suchen.

## Claude

*(Aktualisiert `index.html`.)*

- Linienname aus `journey.category` + `number` (API: Tram `T`/`15`, Bus `B`/`759`, `products` enthält nur `15`): Tram `T15`, Zug `S19`, Bus nur Nummer.
- Balken 18 px. Blau mit Linie, grauer Block über der Umsteige-Lücke mit Haltestelle (Einstieg nächste Fahrt). Text: voller Name → ohne Ortsteil («Zürich, Bahnhofplatz/HB» → «Bahnhofplatz/HB», «Zürich HB» → «HB») → eindeutige Abkürzung über alle angezeigten Ergebnisse («Oerl.»). Passt nichts, kein Text. Tooltip = voller Name.
- Lange Fusswege in der Lücke bleiben grün; Label im grössten freien Stück.
- Zeile 1: «Haltestelle · Linien · + Fussweg». Zeile 2: «Umsteigen: A, B».
- Toggle filtert das letzte Resultat lokal (`Planner.visible`), Limit 10 nach Filter.

---

## User

Umsteige-Name nicht im grauen Block, sondern als Sprechblase. Abkürzung: Start und Ende der Route im selben Ort → Ort weglassen, sonst erster Buchstabe des Orts + Abkürzung des Rests. Max. 5 Buchstaben.

## Claude

*(Aktualisiert `index.html`.)*

- Sprechblase über dem Balken, Spitze in der Mitte der Umsteige-Lücke, Tooltip = voller Name. Grauer Block bleibt, ohne Text.
- `Planner.stopAbbr`: Ort = vor Komma, sonst erstes Wort. Route-Start/-Ende = erster/letzter Abschnitt.
  - gleicher Ort: «Zürich HB» → «HB», «Zürich Oerlikon» → «Oerli»
  - anderer Ort: «Zürich HB» → «ZHB», «Wallisellen, Bahnhof» → «WBahn»
  - nur Ort: «Wallisellen» → «Walli»
- Keine Kollisionsprüfung, Blasen können sich bei nahen Umstiegen überlappen.

---

## User

Wort «Bahnhof» weglassen. «Zürich Oerlikon» → Orts-Initiale immer (Gleicher-Ort-Regel entfällt), max. 6 Buchstaben total. Tipp ins Ort-Feld nach einer Suche: Favoriten + Zuletzt zeigen, nicht Treffer zum aktuellen Text.

## Claude

*(Aktualisiert `index.html`.)*

- `stopAbbr`: Orts-Initiale + Rest, Wort «Bahnhof» entfernt, `STOP_ABBR_MAX = 6`. Zürich Oerlikon → ZOerli, Zürich HB → ZHB, Zürich, Bahnhofplatz/HB → ZBahnh, Wallisellen (, Bahnhof) → Wallis.
- Fokus im Ort-Feld: immer Favoriten + Zuletzt, Text markiert (Tippen ersetzt ihn). Tippen: Treffer wie bisher.

---

## User

Sprechblasen auch für Start und Ende. Vertikal scrollen = Verbindungen, horizontal = Balken. Pinch-Zoom vergrössert die Balken, damit mehr Platz für Details ist.

## Claude

*(Aktualisiert `index.html`.)*

- Blasen: Start (Spitze links), Umsteigen (Mitte), Ende (Spitze rechts). `fitPins()`: pro Balken voller Name, wenn sich keine Blasen überlappen, sonst Abkürzung.
- `.track` (overflow-x) um jeden Balken, Breite `100% × --zoom`. Alle Tracks scrollen synchron; Zoom und Position bleiben beim Toggle erhalten.
- `Timeline`: Pinch (2 Finger, `touch-action: pan-x pan-y` + preventDefault) bzw. Ctrl+Mausrad zoomt 1–8×, Punkt unter den Fingern bleibt fix. Linien-Labels und Blasen werden danach neu eingepasst.
- Ungetestet auf echtem Mobilgerät (nur Desktop-Chromium mit Ctrl+Wheel).

---

## User

Beim vertikalen Scrollen automatisch horizontal mitscrollen, damit die Balken der sichtbaren Verbindungen im Bild sind.

## Claude

*(Aktualisiert `index.html`.)*

- `Timeline.followViewport()`: bei Zoom > 1 und Seiten-Scroll wird die früheste Startzeit der sichtbaren Verbindungen an den linken Rand gesetzt (8 px Rand).

Frage: Warum keine Vorschläge ab Furtbach? Vermutete Ursachen (nicht verifiziert):
1. API routet «nach Furtbach» mit Fussweg am Ende (z. B. Bahnhof Wallisellen → zu Fuss) → von `homeEndIsClean` verworfen.
2. HAFAS liefert keine dominierten Verbindungen (später an, mehr Umstiege), daher fehlt die Bus-Variante.
3. Nur 4 Verbindungen pro Haltestelle (`CONNECTIONS_PER_STOP`).

---

## User

Warum keine Verbindungen ab Furtbach mit Bus 772 (SBB App zeigt sie)?

## Claude

API-Abfragen (transport.opendata.ch): Furtbach → Rigi Kulm, 21.10. 10:00 liefert nur Verbindungen mit Fussweg am Anfang (17 Min. zum Bahnhof Wallisellen bzw. 14 Min. nach Dietlikon, Dornenstrasse). Der 772 um 10:17 wird weggelassen: Fussweg ab 10:22 erreicht dieselbe Ankunft 12:34 mit späterer Abfahrt (dominiert). `via=Wallisellen, Bahnhof` hilft nicht. `homeEndIsClean` verwirft diese korrekt.

## User

Selbst kombinieren, beide Optionen zeigen (zu Fuss und mit 772). Auch Ifang (787 → Dietlikon und → Oerlikon) und Glatt.

## Claude

*(Aktualisiert `index.html`.)*

- `FEEDERS`: Zubringer-Linie ab Heim-Haltestelle bis Hub, dann API-Verbindung ab Hub.
  - Furtbach 772 → Wallisellen, Bahnhof → Hub Wallisellen
  - Ifang 787 → Dietlikon, Bahnhof Ost → Dietlikon; 787 → Zürich Oerlikon, Bahnhof Ost → Zürich Oerlikon
  - Glatt (Bus) 787 → Oerlikon Bahnhof Ost, 61 → Oerlikon Bahnhof; Glatt (Tram) T12 → Stettbach
- `/stationboard` (mit `passList`, verifiziert) liefert Zubringer-Fahrten; Umsteigezeit `changeMin` (4–5 Min., geschätzt, nicht vom Fahrplan geprüft).
- Abfolge: fromHome+ab: Board zuerst, Hub ab erster Ankunft + Umsteigen. Sonst Hub zuerst, Board danach (Fenster ab erster Hub-Abfahrt − 60 Min. bzw. erster Hub-Ankunft + Umsteigen). toHome+an: Hub-Ankunft ≈ Zeit − Gehzeit − 25 Min.
- Duplikate (gleiche Fahrten, gleiche Zeiten) entfernt; Details zeigen «+ Zubringer …». MAX_RESULTS 15.
- Pro Suche: 5 + 6 Verbindungs- und bis zu 4 Board-Abfragen (Board-Cache 60 s).

---

## User

Verbindungen als Karten. Oben Zusammenfassung schnellste/langsamste Dauer. Dauer farbig nach Skala (beste grün, schlechteste dunkelrot). In den Details pro Umsteigen Alternativen: früher (falls Zubringer verspätet) und später (falls verpasst), visuell klar.

## Claude

*(Aktualisiert `index.html`.)*

- Karten: `#results > li` mit Rand, Radius 12 px, Abstand.
- `#summary`: «Schnellste / Langsamste» als Pillen; Dauer-Pille pro Verbindung, Farbe `color-mix(--good → --bad)` linear über die angezeigten Dauern.
- Details: Button «Alternativen ab <Haltestelle>» pro Umsteigen. `Planner.alternatives`: `/connections` ab Umsteigeort zum letzten Bahnhof, ab Ankunft − 20 Min., 6 Stück. Mini-Zeitachsen; gestrichelt = geplante Ankunft am Umsteigeort; blass = fährt vorher (nur bei Verspätung); umrandet = geplant; rechts Ankunftsdifferenz am Ziel.
- Zubringer verworfen, wenn Wartezeit am Hub > 20 Min. (`FEEDER_MAX_WAIT_MIN`).
- Offen: Blasen können sich bei kurzen Abschnitten überdecken.

---

## User

Bei Reisen mit vielen Verbindungen kommen nur die nächsten 20 Minuten. Immer mindestens 30 Minuten zeigen.

## Claude

*(Aktualisiert `index.html`.)*

- `connectionsCovering`: pro Haltestelle/Hub nachfragen (ab letzter Abfahrt + 1 Min. bzw. erster Ankunft − 1 Min.), bis `MIN_WINDOW_MIN = 30` abgedeckt ist, max. `MAX_PAGES = 4` Abfragen. 6 statt 4 Verbindungen pro Abfrage.
- `visible`: alle Verbindungen im 30-Min.-Fenster werden gezeigt (ohne Limit), danach bis `MAX_RESULTS` aufgefüllt. Bei «An»: die spätesten vor dem Fenster.
- Kosten: bei dichtem Takt bis ~4× mehr Abfragen.

---

## User

Zusätzliche Haltestelle «Wallisellen, Säntisstrasse» (8 Min.), nur wenn nicht schon durch andere abgedeckt (z. B. gleicher erster Bus). Balken breiter.

## Claude

*(Aktualisiert `index.html`.)*

- HOME_STOPS + Säntisstrasse (`secondary: true`). `dropCoveredSecondary`: Verbindung verworfen, wenn ihr Fahrzeug am Heim-Ende (erstes bzw. letztes) in einer Verbindung der anderen Haltestellen vorkommt. Fahrzeug = Linie + API-Fahrtnummer (`journey.name`), sonst Linie + Abfahrtszeit.
- Säntisstrasse hat nur Bus 774 (30-Min.-Takt, Richtung Schulhaus Bürgli); kein Zubringer konfiguriert.
- Balken: Track reicht bis fast an den Kartenrand, Seitenrand der Seite 0.75 rem.

---

## User

Details als Tabelle (Zeit, Einstieg, Linie, Richtung gekürzt/antippbar, Ausstieg, Zeit), Fusswege als eigene Zeilen. Frage: Flughafen – warum T12 ab Wallisellen Bhf statt ab Glatt?

## Claude

*(Aktualisiert `index.html`.)*

- Details-Tabelle `legRows`/`legRow`: inkl. eigenem Heimweg («Zuhause»), Fussweg-Badge grün gestrichelt, Umsteige-Fussweg grau. Richtung via `stopAbbr`, Tippen zeigt vollen Namen. Gleis/Kante unter Einstieg.

Analyse Glatt/T12 (API, 21.10. 09:40):
- «Wallisellen, Glatt» wird als «Glatt (Bus)» aufgelöst. Die T12-Verbindung beginnt mit Fussweg 4 Min. zu «Glatt (Tram)» → von `homeEndIsClean` verworfen.
- T12 Glatt (Tram) 09:55 → Wallisellen, Bahnhof 09:56 (1 Min.). Mit 14 vs. 15 Min. Gehzeit identische Abgangszeit zu Hause; Glatt nur besser, wenn Gehzeit zu Glatt (Tram) kürzer ist.

---

## User

Richtige Glatt-Haltestelle verwenden, Trams bevorzugen. Gehzeit Glatt (Tram) 13 Min.

## Claude

*(Aktualisiert `index.html`.)*

- HOME_STOPS: «Wallisellen, Glatt (Tram)» 13 Min.; «Wallisellen, Glatt (Bus)» 14 Min. als `secondary` (nur wenn Fahrzeug nicht schon abgedeckt). Zubringer 787/61 an Glatt (Bus), T12 an Glatt (Tram).
- `dropDominatedBoarding`: gleiches Fahrzeug am Heim-Ende + gleiche Ankunft (von zu Hause) bzw. gleiche Abfahrt (nach Hause) → nur die Haltestelle mit spätestem Losgehen bzw. frühester Ankunft zu Hause bleibt. Gleichstand: beide.
  Beispiel: T12 ab Glatt (Tram) 09:55, los 09:42, schlägt T12 ab Wallisellen Bhf 09:56, los 09:41.

---

## User

Unsinn: T12 nach Stettbach und dort dieselbe T12 zurück Richtung Flughafen.

## Claude

*(Aktualisiert `index.html`.)*

- `backtracks()`: Zubringer-Kombination verworfen, wenn die Hub-Verbindung die Zubringer-Linie erneut fährt oder (laut `passList`) an der Zubringer-Haltestelle vorbeifährt.
- Legs speichern `stops` aus `journey.passList` bzw. Stationboard-`passList`.

---

## User

Unit-Tests für alle besprochenen Fälle.

## Claude

*(Neu: `tests/load-app.mjs`, `tests/homeapprox.test.mjs`, `package.json`.)*

- `npm test` bzw. `node --test tests/homeapprox.test.mjs` (Node ≥ 20, keine Abhängigkeiten).
- `load-app.mjs` lädt das `<script>` aus `index.html` in eine Node-VM mit DOM-Stub und gemocktem `fetch`; Fixtures im API-Format (`ride`, `walk`, `conn`, `boardEntry`).
- 48 Tests: Linienlabels, Fussweg/Umsteigen, Umsteigeort, Abkürzungen, Zeitverschiebung, Fussweg am Heim-Ende, Sortierung/Fenster, Fehler pro Haltestelle, 30-Min.-Paging, Fussweg-Toggle, Zubringer (772 hin/zurück, Umsteigezeit, Wartezeit, Backtracking T12), Duplikate, Dominanz Glatt/Bahnhof, Säntisstrasse/Glatt (Bus) sekundär, Alternativen, Vorschläge, Zuletzt/Favoriten, Dauer-Farbskala.
- Dabei gefunden und korrigiert: Sekundär-Filter lief nach dem Dominanz-Filter, dadurch konnte Säntisstrasse eine Wallisellen-Verbindung mit demselben Bus verdrängen. Jetzt Sekundär-Filter zuerst.
- Nicht getestet: Darstellung (Balken, Blasen, Zoom, Scroll).

---

## User

In «Alternativen ab …» Details zu jeder Alternative sehen.

## Claude

*(Aktualisiert `index.html`.)*

- Tippen auf eine Alternative klappt ihre Abschnitte als Tabelle auf (gleiche Tabelle wie in den Details), darunter «n× umsteigen · an Ziel hh:mm, X Min. früher/später als geplant». ▸/▾ zeigt den Zustand.
- Gestrichelte Ankunftslinie jetzt pro Mini-Balken statt über die ganze Liste (sonst ginge sie durch die aufgeklappte Tabelle).

---

## User

Zwei Buttons nebeneinander: links «Alternativen» wie bisher, rechts neue Suche mit diesen Parametern. Dafür dritte Suchart «Anderer Ort».

## Claude

*(Aktualisiert `index.html`, Tests.)*

- Richtung «Anderer Ort» (`Direction.OTHER`): zusätzliches Feld «Von», Ort-Feld wird «Nach». Einfache Suche Von → Nach (30-Min.-Paging), ohne Heim-Haltestellen, Zubringer und Heimweg; API-Fusswege an beiden Enden bleiben.
- Pro Umsteigen: «Ab <Haltestelle>: [Alternativen] [Neue Suche]».
- `Planner.followUpSearch`: Nach Hause → «Nach Hause» ab Umsteigeort; Von zu Hause / Anderer Ort → «Anderer Ort» Umsteigeort → ursprünglicher Ort. Zeit = geplante Ankunft am Umsteigeort, «Ab». Formular wird ausgefüllt und die Suche gestartet.
- Vorschläge/Favoriten für beide Felder (`placeField`).
- Fix: `[hidden]` wurde von `.row { display: flex }` überschrieben.
- 4 neue Tests (52).

---

## User

Alternativen zeigen nur Verbindungen in der Vergangenheit (Oerlikon → Flughafen).

## Claude

*(Aktualisiert `index.html`, Tests.)*

- Ursache: eine Abfrage ab Ankunft − 20 Min. mit 6 Resultaten; bei dichtem Takt liegen alle vor der Ankunft, die geplante und spätere fehlen.
- Jetzt zwei parallele Abfragen: ab Ankunft − 20 Min. (davon max. 3 vor der Ankunft) und ab Ankunft (alle bis zur geplanten Abfahrt + 3 danach, bei Bedarf eine Folgeabfrage).
- Mini-Balken 14 px, Labels nicht mehr abgeschnitten.
- Test für den dichten Takt (schlägt mit der alten Version fehl). 53 Tests.

---

## User

Immer Verbindungen zeigen, die vor bis zu 5 Min. losgingen (lohnt sich rennen?). Buttons «Frühere» oben und «Spätere» unten.

## Claude

*(Aktualisiert `index.html`, Tests.)*

- `Planner.search`: bei «Ab» wird ab Zeit − 5 Min. (`RECENT_PAST_MIN`) gesucht; Fenster [Zeit − 5, Zeit + 30]. Solche Karten gestrichelt mit rotem Tag «vor N Min.» (bzw. «N Min. früher», wenn nicht jetzt gesucht). Bei «An» kein Rückblick.
- `Planner.extend`: «Frühere» / «Spätere» holen 30 Min. (`MORE_STEP_MIN`) ausserhalb des Fensters, mergen (Duplikate, Pruning), Fenster wird breiter. Liste bleibt, Zoom/Scroll bleiben.
- Mit «Frühere» geholte, ältere Verbindungen bekommen kein «vor N Min.»-Tag.
- 4 neue Tests (57).

---

## User

Dauer-Pille und «vor N Min.» rechtsbündig. Balken auf ca. 80 % der Kartenbreite – oder gibt es einen Grund dagegen?

## Claude

*(Aktualisiert `index.html`.)*

- Tag + Dauer-Pille rechtsbündig (`.push { margin-left: auto }`).
- Balken schmal, weil alle Karten eine gemeinsame Zeitachse teilen (vergleichbar). Statt eigener Achse pro Karte: Start-Zoom so, dass eine Verbindung mit Durchschnittsdauer 80 % (`BAR_FILL`) der Breite füllt (vom User gewünscht statt der längsten); Position folgt den sichtbaren Karten. Eigener Zoom (Pinch/Ctrl+Rad) bleibt bis zur nächsten Suche. `ZOOM_MAX` 12.
- Nachtrag: Mitscrollen verankert jetzt an der obersten Karte, die noch mindestens zur Hälfte sichtbar ist (vorher: früheste Startzeit aller sichtbaren Karten, das bewegte sich kaum). Dadurch beginnt die oberste Karte links und längere Verbindungen sind nicht scheinbar «zu schmal».

---

## User

Auf dem Handy ist die Schrift zu gross (Zeiten und Pillen brechen um).

## Claude

*(Aktualisiert `index.html`.)*

- Zeiten, Dauer-Pille und «vor N Min.» brechen nicht mehr um (`white-space: nowrap`).
- `@media (max-width: 480px)` am Ende des Stylesheets: Grundschrift 15 px, Zeiten 1.1 rem, kleinere Pillen, Meta-Zeilen, Tabelle, Kartenränder.
- Fix: Vorschlagsliste konnte nach dem Absenden noch aufgehen (verzögerte Suche lief weiter); `close()` bricht sie jetzt ab.

---

## User

Horizontal scrollen und zoomen soll in der ganzen Liste funktionieren, nicht nur auf den Balken.

## Claude

*(Aktualisiert `index.html`.)*

- `#results { touch-action: pan-y }`: Browser macht nur noch vertikales Scrollen; Pinch-Zoom der Seite in der Liste aus.
- Timeline: Pinch überall in der Liste zoomt (Referenz = Balken der Karte unter den Fingern). Ein-Finger-Wischen ausserhalb eines Balkens: nach 8 px Richtung festlegen, horizontal → alle Balken scrollen, vertikal → Seite.
- Desktop: Ctrl+Rad überall in der Liste zoomt, Shift+Rad bzw. seitliches Rad scrollt die Balken.
- Getestet mit emulierten Touch-Events (Wischen und Pinch auf der Textzeile einer Karte).

---

## User

Bei «Nach Hause» nennt die erste Meta-Zeile die Suchhaltestelle; klingt wie der erste Schritt, ist aber der letzte. Zeile weglassen, nur «Umsteigen: …» behalten. Beginnt die Verbindung zu Fuss, fehlt die Sprechblase am Ziel des Fusswegs.

## Claude

*(Aktualisiert `index.html`.)*

- Meta-Zeile «Haltestelle · Linien · + Fussweg» entfernt. Linien stehen im Balken, Fussweg ist gepunktet sichtbar.
- `edgeWalkPins()`: Fussweg am fernen Ende → zusätzliche Blase am Start der ersten bzw. Ende der letzten Fahrt. Fusswege zwischen Fahrten waren schon als Umsteigen gepinnt.

---

## User

Sprechblasen auf zwei Zeilen verteilen, damit sie nicht überlappen? Ausprobieren.

## Claude

*(Aktualisiert `index.html`.)*

- `assignRows()`: Blasen von links nach rechts greedy auf max. 2 Zeilen verteilen.
- `fitPins()` probiert pro Textform (voll, dann Abkürzung) die Zeilenzuteilung; volle Namen auf zwei Zeilen schlagen Abkürzungen auf einer.
- Obere Zeile: `.pin.up`, dünne Linie bis zum Balken. `.track.two-rows` reserviert den Platz nur bei Karten, die ihn brauchen.
- Ungetestet im Browser.

## User

Horizontalen Platz besser nutzen, bevor eine zweite Zeile kommt (z. B. rechts neben «WFurtb» ist frei).

## Claude

*(Aktualisiert `index.html`.)*

- `placePins()`: Blase darf seitlich rutschen, solange die Spitze über der Haltestelle bleibt (`--tip`) und die Blase im Balken. Reihenfolge: zuerst rutschen, erst dann zweite Zeile, erst dann Abkürzung.
- Start/End-Ausrichtung (`.pin.start`/`.pin.end`) entfällt; Blase am Balkenrand hängt an der Ecke.
- `placePins()` ohne DOM getestet (drei Fälle); Browser nicht.

## User

Umsteigen-Zeile: Icon, dann alle Orte, wo etwas passiert (z. B. Zürich HB, Wallisellen Bahnhof, Wallisellen Furtbach). Namen kürzen, in Blasen und Zeile: Furtbach, Dietlikon, Oerlikon, HB, Selnau.

## Claude

*(Aktualisiert `index.html`.)*

- `Planner.shortName()`: Ort weg, wenn ein eigener Teil bleibt; «Bahnhof …» und «(…)» weg. Blasen: kurz → Abkürzung. Zeile: `⇄ HB · Wallisellen · Furtbach`.
- `changeStops()`: jede Grenze zwischen Abschnitten inkl. Heimweg, ohne Start und Ziel. Kurzer Umsteige-Fussweg A → B zählt als ein Ort (A).
- Bekannte Schwäche (wie `stopAbbr`): «Bad Ragaz» → «Ragaz», «St. Gallen» → «Gallen».

## User

Die Umsteigen-Zeile braucht es gar nicht mehr.

## Claude

*(Aktualisiert `index.html`.)* Zeile, `changeStops()` und Icon entfernt. Karte: Zeiten, Balken mit Blasen, Details auf Klick. `shortName()` bleibt für die Blasen.

## User

«Zürich Oerlikon» steht weiterhin zweiwortig in der Blase. Name laut Details: «Zürich Oerlikon, Bahnhof Ost».

## Claude

Ort vor dem Komma war selbst zweiteilig; nach Wegfall von «Bahnhof Ost» blieb der ganze Ort. `shortName()` kürzt den Ort dann auf alles nach dem ersten Wort → «Oerlikon».

---

## User

Im Dauer-Bereich «Schnellste»/«Langsamste» weg. Kleiner Icon-Button, der die längste Dauer wegschneidet (bis zur nächstlängeren), beliebig oft bis nur die kürzeste bleibt; Filter wieder aufhebbar. Zeile darunter: dasselbe für Anzahl Umsteigen.

## Claude

*(Aktualisiert `index.html`.)*

- Zusammenfassung, zwei Zeilen: `[31 Min.] – [52 Min.] ✂ ↺` und `0 – 2× umsteigen ✂ ↺`.
- `Caps`: pro Mass eine Obergrenze. ✂ setzt sie auf den nächsttieferen Wert unter dem aktuellen Maximum der angezeigten Verbindungen; ✂ verschwindet, wenn nur ein Wert bleibt. ↺ hebt auf. Beide Grenzen wirken zusammen, nach dem Fussweg-Toggle.
- Neue Suche setzt die Grenzen zurück; «Frühere/Spätere» behält sie.
- `Caps` ohne DOM getestet.

## User

Layout besser. Dauer-Schnitt in mindestens 5-Minuten-Schritten, bei vielen Verbindungen ist einzeln zu mühsam.

## Claude

*(Aktualisiert `index.html`.)*

- Zusammenfassung als Karte, Grid `Icon | Bereich | ✂ | ↺`; feste Button-Spalten, nichts springt. `⏱ [31 Min.] – [52 Min.]`, `⇄ 0 – 2× umsteigen`.
- `DURATION_CUT_STEP_MIN = 5`: Schnitt auf den grössten vorhandenen Wert ≤ Maximum − 5, sonst Minimum. Umsteigen weiter in 1er-Schritten. Beispiel 31 33 38 41 44 52 53 → 44 → 38 → 33 → 31.

## User

Klick auf die kürzeste Dauer soll direkt danach filtern, mit Puffer: mindestens 10 % der Verbindungen bleiben.

## Claude

*(Aktualisiert `index.html`.)*

- Pille «kürzeste Dauer» klickbar: `Caps.cutToBest()` setzt die Grenze auf den N-t-kleinsten Wert, N = ⌈10 % der angezeigten⌉, min. 1 (`KEEP_SHARE`). Gleiche Werte bleiben alle (≤ Grenze). ↺ hebt auf.
- Beispiel: 12 Verbindungen → N = 2 → Grenze = zweitkürzeste Dauer.

## User

Klick auf die längste Dauer = Schere.

## Claude

*(Aktualisiert `index.html`.)* Pille «längste Dauer» klickbar, ruft `Caps.cut()` wie ✂. Bei nur einem Wert ist die Pille passiv.

## User

Dasselbe für Umsteigen.

## Claude

*(Aktualisiert `index.html`.)* Zahlen in `⇄ 0 – 2× umsteigen` klickbar: Minimum → `cutToBest(CHANGES)`, Maximum → `cut(CHANGES)`.

## User

Beim Filtern der Dauer weiterhin die längste Dauer sehen; Farbskala auf der ungefilterten längsten Dauer behalten.

## Claude

*(Aktualisiert `index.html`.)*

- Farbskala (Pillen in Karten und Zusammenfassung) aus der Liste vor den Grenzen (`all`), nur Fussweg-Toggle angewandt.
- Zusammenfassung zeigt den gefilterten Bereich, bei aktiver Grenze dahinter «(max. 52 Min.)» bzw. «(max. 2×)».

## User

Lücke zwischen Checkbox und Resultaten Absicht? Klick auf «(max. …)» soll den Filter auch aufheben.

## Claude

*(Aktualisiert `index.html`.)* Lücke kam vom leeren `#status` (Mindesthöhe + Rand); leer jetzt ausgeblendet, Ränder kleiner. «(max. …)» klickbar → `Caps.reset()`.

## User

Checkbox in den Filterbereich als dritte Zeile, mit Icon «Fussgänger ok».

## Claude

*(Aktualisiert `index.html`.)*

- Dritte Zeile: `🚶 Mit zusätzlichem Fussweg (3) [x]`; Zahl = Verbindungen mit Fussweg insgesamt.
- Die Checkbox bleibt ein Element (`walkBox`, per Referenz gehalten) und wird bei jedem Render in die Zeile verschoben; `#summary` wird sonst komplett neu aufgebaut.
- Zusammenfassung erscheint, sobald ohne Fussweg-Filter Verbindungen da sind, damit der Toggle nie verschwindet.
- Icon ist das Emoji 🚶; rendert je nach System farbig. SVG möglich.

## User

Klick auf einen Filter muss die Klammer-Texte der anderen Filter aktualisieren.

## Claude

*(Aktualisiert `index.html`.)* `Caps.apply(journeys, except)` lässt eine Grenze aus. «(max. …)» und «(N)» zeigen nun, was der jeweilige Filter allein ausblendet, alle anderen Filter angewandt. Farbskala weiter aus `all` (nur Fussweg-Toggle).

## User

Fussgänger-Filter als x/y (5 von 8 Verbindungen).

## Claude

*(Aktualisiert `index.html`.)* Zeile: `Mit zusätzlichem Fussweg (3/8)` = mit Fussweg / alle, die die Grenzen passieren. Immer angezeigt, auch 0/8.

---

## User

Verbindung 17:48–17:55 (7 Min.): Bus 62 fährt 17:53 ab Aubrücke, 787 kommt dort 18:02 an. Was ist das?

## Claude

API-Daten unverändert übernommen. Vermutung: API plant mit Echtzeit, die `*Timestamp`-Felder sind Fahrplan; der 62 ist verspätet. Auf Nachfrage umgesetzt:

*(Aktualisiert `index.html`.)*

- `liveTime(ev, which)`: `prognosis.departure/arrival` (ISO) wenn vorhanden, sonst Fahrplan; liefert `{ at, delayMin }`.
- Abschnitte, Verbindung (`c.from`/`c.to`) und Zubringer-Abfahrtstafel nutzen Live-Zeiten. Alle abgeleiteten Zeiten (Balken, Umsteigen, Sortierung, Dauer) folgen.
- Details: Zeit mit Abweichung «18:02 +9» in Rot.
- Unsicher: Feldname/Format der Prognose aus dem Gedächtnis (`prognosis.departure` als ISO-String). Ungültige Werte fallen auf Fahrplan zurück.

---

## User

Im Filterbereich alle Bus- und S-Bahn-Linien der Resultate anzeigen; Klick filtert auf Verbindungen mit dieser Linie. Mehrere Linien = beliebige davon.

## Claude

*(Aktualisiert `index.html`.)*

- Vierte Zeile: `🚌 [S8] [S19] [T12] [62] [787] ↺`. Chips aus den Verbindungen, die alle anderen Filter passieren; gewählte Chips bleiben, auch wenn ihre Linie verschwunden ist. Tooltip: Anzahl Verbindungen.
- `LineFilter`: Menge gewählter Linien, ODER-Verknüpfung. Reihenfolge: Buchstaben-Linien (S, T, IR) zuerst, dann numerisch.
- Klammer-Hinweise und Fussweg-Zähler berücksichtigen den Linienfilter. Neue Suche setzt zurück.

## User

Linienfilter zuunterst, eingeklappt starten.

## Claude

*(Aktualisiert `index.html`.)* Reihenfolge: Dauer, Umsteigen, Fussweg, Linien. Eingeklappt: «Linien (2 gewählt) ▸», Klick auf Text oder ▸ klappt auf; ▾ klappt zu. Zustand `linesOpen` bleibt über Renders, neue Suche klappt zu. Filter wirkt auch eingeklappt; ↺ sichtbar.

## User

↺ der Linien in dieselbe Spalte wie bei den anderen Filtern.

## Claude

*(Aktualisiert `index.html`.)* Linien-↺ in die vierte Grid-Spalte.

---

## User

Mehrere Ziele eingeben können; Routen zu allen. (Rückfrage: Chips; nur Ziel, nicht «Von».)

## Claude

*(Aktualisiert `index.html`.)*

- Vorschlag wählen → Chip `[Zürich HB ×]` unter dem Feld, Feld leer für das nächste Ziel. Noch getippter Text zählt beim Suchen mit. Mindestens ein Ziel.
- `Planner.plan(places, …)` plant pro Ziel (`planOne`) parallel, mischt, sortiert nach Abfahrt. `params.places` für Frühere/Spätere. Fehlermeldungen bei mehreren Zielen mit Ziel-Präfix.
- «Neue Suche ab …» setzt genau ein Ziel.
- Nicht übergreifend geprunt: Verbindungen zu verschiedenen Zielen konkurrieren nicht.

## User

GitHub-Test rot: `places.map is not a function`.

## Claude

Tests rufen `Planner.plan("Bern", …)` mit einem String. `plan()` nimmt jetzt String oder Liste (`[].concat`). 57/57 grün.

---

## User

Eigene Orte = mehrere Haltestellen mit je Gehzeit, wie Zuhause. Verallgemeinern. (Aufteilung: 1 Modell + Suche, 2 Speicher + Editor, 3 Export/Import/URL, 4 UI-Vereinheitlichung. Schritt 1 jetzt.)

## Claude

*(Aktualisiert `index.html`, Tests.)* Schritt 1.

- `Place = { name, custom, stops: [{ name, walkMin, secondary? }], feeders }`. `ZUHAUSE` = HOME_STOPS + FEEDERS. `station(name)` = ein Stop, Gehzeit 0. `asPlace()` nimmt String oder Place.
- `Planner.planPlaces(from, to, at, timeRef)`: Paare `from.stops × to.stops` (`forPair`), Zubringer je eigenem Ende. Regeln am eigenen Ende (API-Fussweg dort → verwerfen, Sekundär-Stops, gleiches Fahrzeug an zwei Stops) gelten pro Seite (`Side.FROM/TO`), auch beidseitig.
- `Planner.plan(placeOrPlaces, at, dir, timeRef, origin)` bleibt als Formular-Einstieg; `dir` → Ortspaar. Ziel darf schon ein Place-Objekt sein.
- Journey: `walkStartMin`, `walkEndMin`, `fromPlace/toPlace`, `fromStop/toStop`; `homeStop`, `homeEnd`, `dir` bleiben (Tests, UI). Balken und Detailtabelle zeigen eigene Fusswege an beiden Enden.
- Nicht verallgemeinert: Zubringer bleiben Daten von Zuhause; `extend()` prunt gemischte Resultate nur nach Formularrichtung (`customSides`).
- 62/62 Tests, 5 neu (ferner Ort eigen, An-Modus, API-Fussweg am fernen Ende, beidseitig eigen, `station()`).
