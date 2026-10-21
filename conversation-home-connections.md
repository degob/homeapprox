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
