// Journey rendering: date inputs, timeline bars, legs, transfer alternatives.

import { LegKind, TimeRef } from "./config.js";
import { AltRel, Planner } from "./planner.js";
import { Places } from "./places.js";
import { Saved } from "./saved.js";
import { LinesState, StopLines } from "./stop-lines.js";
import { $, hhmm, localDateValue, minutes } from "./dom.js";
import { onNow, startSearch } from "./app.js";

export function initInputs() {
  $("origin").value = Places.home()?.name || "";
  onNow();
}

// 📅 alone means today; another day shows as "📅 Fr 24.10." on the button.
export function showDate() {
  const btn = $("pick-date");
  const v = $("date").value;
  const today = v === localDateValue(new Date());
  btn.classList.toggle("other", !today);
  if (today) {
    btn.textContent = "📅";
    return;
  }
  const d = new Date(`${v}T00:00`);
  btn.textContent = `📅 ${d.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit" })}`;
}

// Reveal the input and open the picker; hide it again once a day is chosen.
export function onPickDate() {
  const input = $("date");
  input.hidden = false;
  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  } else {
    input.focus();
  }
}

export function onDateChange() {
  $("date").hidden = true;
  showDate();
}

// Duration color: share of --bad on the scale best → worst duration.
export function durColor(min, best, worst) {
  const p = worst > best ? Math.round(((min - best) / (worst - best)) * 100) : 0;
  return `color-mix(in oklab, var(--bad) ${p}%, var(--good))`;
}

// Positions a bar segment on the shared time axis [t0, t1].
function segment(cls, from, to, t0, t1) {
  const span = document.createElement("span");
  const total = t1 - t0 || 1;
  span.className = cls;
  span.style.left = `${((from - t0) / total) * 100}%`;
  span.style.width = `${((to - from) / total) * 100}%`;
  return span;
}

// Segment with text candidates (longest first); fitLabels() picks one.
function labelled(cls, from, to, t0, t1, texts, title) {
  const span = segment(`${cls} lbl`, from, to, t0, t1);
  span.dataset.texts = JSON.stringify(texts);
  span.title = title;
  return span;
}

// Bubble above the bar for a stop, anchored at `at`. Text, row and exact
// position are chosen by fitPins() once the bar is laid out.
function stopPin(name, at, t0, t1, cls = "") {
  const pin = document.createElement("span");
  pin.className = `pin ${cls}`;
  pin.dataset.frac = String((at - t0) / (t1 - t0 || 1));
  pin.dataset.texts = JSON.stringify([...new Set([Planner.shortName(name), Planner.stopAbbr(name)])]);
  pin.title = name;
  return pin;
}

// A walk at the far end hides where the first/last ride starts/ends:
//   Selnau ····walk····► Zürich HB ──S9──► ...   → pin "Zürich HB" too.
// Walks between rides are already pinned as transfers.
function edgeWalkPins(j, t0, t1) {
  const rides = j.legs.filter((l) => l.kind === LegKind.RIDE);
  if (!rides.length) {
    return [];
  }

  const pins = [];
  const first = j.legs[0];
  const last = j.legs[j.legs.length - 1];
  if (first.kind === LegKind.WALK) {
    pins.push(stopPin(rides[0].from, rides[0].dep, t0, t1));
  }
  if (last.kind === LegKind.WALK) {
    const r = rides[rides.length - 1];
    pins.push(stopPin(r.to, r.arr, t0, t1));
  }
  return pins;
}

const PIN_GAP_PX = 3;
const PIN_ROWS = 2;
// Tip must stay this far inside the bubble (rounded corners).
const PIN_TIP_INSET_PX = 6;

// Places bubbles left to right. A bubble slides sideways as far as its tip
// stays over the stop; it goes to the lowest row with room, else fails.
//
//   tip range:   [anchor - w + inset, anchor - inset]
//   bar range:   [0, barW - w]
//   row range:   [rowEnd + gap, ∞)
//
//                 ┌───────────┐          row 1 (only if row 0 is full)
//   ┌────────┐┌───┤  Zürich HB│──┐
//   │ Selnau ││Wal│           │Fu│       row 0: slid right to free space
//   ═══╧═════════╧═══════╧═══════╧════   bar  (╧ = tip = stop)
// Returns [{ pin, left, row }] or null when PIN_ROWS rows don't suffice.
function placePins(pins, barW) {
  const items = pins
    .map((pin) => ({ pin, w: pin.offsetWidth, anchor: Number(pin.dataset.frac) * barW }))
    .sort((a, b) => a.anchor - b.anchor);

  const rowEnd = [];
  const placed = [];
  for (const it of items) {
    const minLeft = Math.max(0, it.anchor - it.w + PIN_TIP_INSET_PX);
    // Stop right at a bar edge: bubble hugs the edge, tip sits in its corner.
    const maxLeft = Math.max(minLeft, Math.min(barW - it.w, it.anchor - PIN_TIP_INSET_PX));

    let row = rowEnd.findIndex((end) => end + PIN_GAP_PX <= maxLeft);
    if (row === -1) {
      row = rowEnd.length;
    }
    if (row >= PIN_ROWS) {
      return null;
    }

    const left = Math.max(minLeft, (rowEnd[row] ?? -Infinity) + PIN_GAP_PX);
    rowEnd[row] = left + it.w;
    const tip = Math.min(it.w - PIN_TIP_INSET_PX, Math.max(PIN_TIP_INSET_PX, it.anchor - left));
    placed.push({ pin: it.pin, left, row, tip });
  }
  return placed;
}

// Per bar: longest text form that placePins() can lay out, same form for
// all bubbles of the bar so they read consistently. Full names on two rows
// beat abbreviations on one. Zooming in gives room.
function fitPins(root) {
  root.querySelectorAll(".bar").forEach((bar) => {
    const pins = [...bar.querySelectorAll(".pin")];
    if (!pins.length) {
      return;
    }
    const barW = bar.clientWidth;
    const forms = pins.map((p) => JSON.parse(p.dataset.texts));
    const levels = Math.max(...forms.map((f) => f.length));

    let placed = null;
    for (let lvl = 0; lvl < levels && !placed; lvl++) {
      pins.forEach((p, i) => {
        p.textContent = forms[i][Math.min(lvl, forms[i].length - 1)];
      });
      placed = placePins(pins, barW);
    }

    // Nothing fits even abbreviated: tips on the stops, single row, overlap.
    placed ||= pins.map((pin) => {
      const w = pin.offsetWidth;
      const left = Number(pin.dataset.frac) * barW - w / 2;
      return { pin, left, row: 0, tip: w / 2 };
    });

    placed.forEach(({ pin, left, row, tip }) => {
      pin.style.left = `${left}px`;
      pin.style.setProperty("--tip", `${tip}px`);
      pin.classList.toggle("up", row > 0);
    });
    bar.closest(".track")?.classList.toggle("two-rows", placed.some((p) => p.row > 0));
  });
}

// Must run once the bar is laid out: first text that fits, else none.
export function fitLabels(root) {
  root.querySelectorAll(".lbl").forEach((el) => {
    const texts = JSON.parse(el.dataset.texts || "[]");
    el.textContent = "";
    for (const t of texts) {
      el.textContent = t;
      if (el.scrollWidth <= el.clientWidth) {
        return;
      }
    }
    el.textContent = "";
  });
  fitPins(root);
}

export function renderJourney(j, t0, t1, scale, past) {
  const li = document.createElement("li");
  li.dataset.startFrac = String((j.start - t0) / (t1 - t0 || 1));
  li.dataset.endFrac = String((j.end - t0) / (t1 - t0 || 1));

  const times = document.createElement("div");
  times.className = "times";
  const tt = document.createElement("span");
  tt.className = "tt";
  tt.textContent = `${hhmm(j.start)} – ${hhmm(j.end)}`;
  times.append(tt);
  const dur = document.createElement("span");
  dur.className = "dur";
  const durMin = minutes(j.start, j.end);
  dur.textContent = `${durMin} Min.`;
  dur.style.background = durColor(durMin, scale.best, scale.worst);
  if (past) {
    const tag = document.createElement("span");
    tag.className = "past-tag";
    tag.textContent = past;
    tag.title = "Schon losgegangen: lohnt es sich zu rennen?";
    times.append(tag);
  }
  times.append(dur);
  // Tag + duration pushed to the right edge of the card.
  (times.querySelector(".past-tag") || dur).classList.add("push");

  const track = document.createElement("div");
  track.className = "track";
  const bar = document.createElement("div");
  bar.className = "bar";
  bar.setAttribute("aria-hidden", "true");
  track.append(bar);
  // Home walk, a wait track under the whole transit span, gray transfer blocks,
  // then each API leg (ride = solid blue with line, walk = dotted; short change
  // walks are covered by the transfer block), then bubbles: start, transfers, end.
  const ownWalks = [
    ...(j.walkStartMin ? [segment("walk", j.start, j.transitStart, t0, t1)] : []),
    ...(j.walkEndMin ? [segment("walk", j.transitEnd, j.end, t0, t1)] : []),
  ];
  const legSeg = (l) => {
    if (l.kind === LegKind.RIDE) {
      return labelled("transit", l.dep, l.arr, t0, t1, [l.line], `${l.line} → ${l.headsign}`);
    }
    return l.kind === LegKind.WALK ? segment("walk", l.dep, l.arr, t0, t1) : null;
  };
  bar.append(
    ...ownWalks,
    segment("wait", j.transitStart, j.transitEnd, t0, t1),
    ...j.transfers.map((x) => segment("xfer", x.from, x.to, t0, t1)),
    ...(j.legs.length
      ? j.legs.map(legSeg).filter(Boolean)
      : [labelled("transit", j.transitStart, j.transitEnd, t0, t1, [j.lines], j.lines)]),
    ...(j.walkStartMin ? [stopPin(j.fromPlace, j.start, t0, t1, "place")] : []),
    stopPin(j.from, j.transitStart, t0, t1),
    ...edgeWalkPins(j, t0, t1),
    ...j.transfers.map((x) =>
      stopPin(x.stop, new Date((x.from.getTime() + x.to.getTime()) / 2), t0, t1)
    ),
    stopPin(j.to, j.transitEnd, t0, t1),
    ...(j.walkEndMin ? [stopPin(j.toPlace, j.end, t0, t1, "place")] : [])
  );

  li.append(times, track);

  // Click toggles the leg-by-leg detail.
  const details = renderDetails(j);
  details.hidden = true;
  li.append(details);
  li.classList.add("clickable");
  li.addEventListener("click", () => {
    details.hidden = !details.hidden;
  });

  return li;
}

// Leg table plus the API query, so a strange result can be traced back.
function renderDetails(j) {
  const box = document.createElement("div");
  box.className = "details";

  const legs = legTable(j);

  const q = document.createElement("div");
  q.className = "meta";
  const ref = j.query.timeRef === TimeRef.ARRIVE ? "an" : "ab";
  const board = j.query.board ? ` · via Abfahrtstafel ${j.query.board}` : "";
  q.textContent = `Abfrage: ${j.query.from} → ${j.query.to}, ${ref} ${hhmm(j.query.at)}${board}`;

  box.addEventListener("click", (e) => e.stopPropagation());
  box.append(legs);
  j.transfers.forEach((x) => box.append(altButton(j, x)));
  box.append(saveRow(j), q);
  return box;
}

// Leg table of a journey (also used by the saved panel).
export function legTable(j) {
  const legs = document.createElement("table");
  legs.className = "legs";
  legRows(j).forEach((r) => {
    const tr = legRow(r);
    legs.append(tr);
    if (r.kind === LegKind.RIDE) {
      const stops = stopsRow(r);
      legs.append(stops);
      tr.classList.add("clickable");
      tr.title = "Haltestellen anzeigen";
      // Whole row: halts + full headsign (→ ZHB ⇄ → Zürich HB).
      const dir = tr.querySelector(".dir");
      tr.addEventListener("click", () => {
        stops.hidden = !stops.hidden;
        tr.classList.toggle("open", !stops.hidden);
        dir.textContent = `→ ${stops.hidden ? Planner.stopAbbr(r.headsign) : r.headsign}`;
      });
    }
  });
  return legs;
}

// Hidden row under a ride: its halts up to where I get off, with live times.
//   16:30 +1  Zürich Oerlikon   1
//   16:35     Zürich HB        32   ← aussteigen
// Without times (saved before passes were kept): names only.
function stopsRow(l) {
  const tr = document.createElement("tr");
  tr.className = "stops-row";
  tr.hidden = true;
  const td = document.createElement("td");
  td.colSpan = 6;
  const ol = document.createElement("ol");
  ol.className = "halts";
  const passes = l.passes?.length ? l.passes.slice(1) : (l.stops || []).slice(1).map((name) => ({ name }));
  passes.forEach((x, i) => {
    const li = document.createElement("li");
    li.className = i === passes.length - 1 ? "off" : "";
    const t = x.arr || x.dep;
    li.append(t ? timeCellSpan(t, x.arr ? x.arrDelayMin : x.depDelayMin) : document.createElement("span"));
    const name = document.createElement("span");
    name.className = "hname";
    name.textContent = x.name;
    const gl = x.platform ? platformSign(x.platform) : document.createElement("span");
    li.append(name, gl, ...transferBadge(x, l.line, t, li));
    ol.append(li);
  });
  if (!passes.length) {
    ol.textContent = "Keine Haltestellen bekannt";
  }
  td.append(ol);
  tr.append(td);
  return tr;
}

// Other lines at a halt: ⇄ n (known), ? (unknown), nothing (board: none).
// Tap the halt: the board is asked once, then the lines show underneath.
//   ⇄ 2   →   S9 → Schaffhausen, Zürich HB · T10 → Bahnhofplatz
function transferBadge(stop, ownLine, at, li) {
  const badge = document.createElement("span");
  badge.className = "xfer";
  const list = document.createElement("div");
  list.className = "xlines";
  list.hidden = true;
  const show = (inf) => {
    badge.className = `xfer ${inf.state}`;
    badge.textContent = { [LinesState.KNOWN]: `⇄ ${inf.lines.length}`, [LinesState.UNKNOWN]: "?", [LinesState.NONE]: "" }[inf.state];
    badge.title = {
      [LinesState.KNOWN]: inf.board ? "Weitere Linien hier" : "Weitere Linien hier (mehr möglich)",
      [LinesState.UNKNOWN]: "Unbekannt – antippen zum Nachschauen",
      [LinesState.NONE]: "Keine weiteren Linien",
    }[inf.state];
  };
  const fill = (inf) => {
    list.replaceChildren(...inf.lines.map((x) => {
      const row = document.createElement("div");
      const b = document.createElement("b");
      b.textContent = x.line;
      row.append(b, ` → ${x.dirs.join(", ")}`);
      return row;
    }));
    if (!inf.lines.length) {
      list.textContent = "Keine weiteren Linien";
    }
  };
  show(StopLines.info(stop, ownLine));
  li.classList.add("clickable");
  li.addEventListener("click", async (e) => {
    e.stopPropagation();
    list.hidden = !list.hidden;
    if (list.hidden) {
      return;
    }
    const known = StopLines.info(stop, ownLine);
    fill(known);
    if (known.board) {
      return;
    }
    list.prepend(Object.assign(document.createElement("div"), { className: "meta", textContent: "Suche …" }));
    try {
      const inf = await StopLines.fetch(stop, at || new Date(), ownLine);
      show(inf);
      fill(inf);
    } catch (err) {
      list.firstChild.textContent = `Fehler: ${err.message}`;
    }
  });
  return [badge, list];
}

function timeCellSpan(at, delayMin) {
  const span = document.createElement("span");
  span.className = "htm";
  span.textContent = hhmm(at);
  if (delayMin) {
    const d = document.createElement("span");
    d.className = "delay";
    d.textContent = ` ${delayMin > 0 ? "+" : ""}${delayMin}`;
    d.title = "Minuten gegenüber Fahrplan";
    span.append(d);
  }
  return span;
}

// "Merken: ☆ Einmal  ☆ Jeden Mittwoch" → after saving "★ Gespeichert".
function saveRow(j) {
  const row = document.createElement("div");
  row.className = "alt-btns save-btns";
  const label = document.createElement("span");
  label.className = "at";
  label.textContent = "Merken:";
  const done = () => {
    const t = document.createElement("span");
    t.className = "saved-tag";
    t.textContent = "★ Gespeichert";
    t.title = "Siehe ★ oben";
    row.replaceChildren(label, t);
  };
  const button = (text, weekly) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "alt-btn";
    b.textContent = text;
    b.addEventListener("click", () => {
      Saved.add(j, weekly);
      done();
    });
    return b;
  };
  const weekday = j.transitStart.toLocaleDateString("de-CH", { weekday: "long" });
  row.append(label, button("☆ Einmal", false), button(`☆ Jeden ${weekday}`, true));
  if (Saved.has(j)) {
    done();
  }
  return row;
}

// Rows of the leg table, incl. our own walks at custom ends.
function legRows(j) {
  const api = j.legs.map((l) => ({ ...l, walkMin: Math.round(l.walkSec / 60) }));
  const walk = (min, from, to, dep, arr) => ({ kind: LegKind.WALK, walkMin: min, from, to, dep, arr });
  return [
    ...(j.walkStartMin ? [walk(j.walkStartMin, j.fromPlace, j.fromStop, j.start, j.transitStart)] : []),
    ...api,
    ...(j.walkEndMin ? [walk(j.walkEndMin, j.toStop, j.toPlace, j.transitEnd, j.end)] : []),
  ];
}

function cell(cls, text) {
  const td = document.createElement("td");
  td.className = cls;
  td.textContent = text;
  return td;
}

// One leg: rides show line + shortened direction (tap for full name);
// walks show "Fuss"/"Umst." and the minutes.
function legRow(l) {
  const tr = document.createElement("tr");
  tr.className = l.kind;
  const ride = l.kind === LegKind.RIDE;

  // Platform signs under both stops: departure and arrival.
  const from = cell("stop", l.from);
  const to = cell("stop", l.to);
  if (ride) {
    l.platform && from.append(platformSign(l.platform));
    l.arrPlatform && to.append(platformSign(l.arrPlatform));
  }

  const ln = document.createElement("td");
  ln.className = "ln";
  const badge = document.createElement("b");
  badge.textContent = ride ? l.line : l.kind === LegKind.WALK ? "Fuss" : "Umst.";
  ln.append(badge);

  const dir = cell("dir", ride ? `→ ${Planner.stopAbbr(l.headsign)}` : `${l.walkMin} Min.`);
  if (ride) {
    dir.title = l.headsign;
  }

  tr.append(timeCell("tm", l.dep, l.depDelayMin), from, ln, dir, to, timeCell("tm end", l.arr, l.arrDelayMin));
  return tr;
}

// Platform as a small sign: the number in a box, like on the station.
function platformSign(platform) {
  const s = document.createElement("span");
  s.className = "gl";
  s.textContent = platform;
  s.title = `Gleis/Kante ${platform}`;
  s.setAttribute("aria-label", `Gleis/Kante ${platform}`);
  return s;
}

// Time with the delay against schedule when there is one: "18:02 +9".
function timeCell(cls, at, delayMin) {
  const td = cell(cls, hhmm(at));
  if (delayMin) {
    const d = document.createElement("span");
    d.className = "delay";
    d.textContent = `${delayMin > 0 ? "+" : ""}${delayMin}`;
    d.title = "Minuten gegenüber Fahrplan";
    td.append(" ", d);
  }
  return td;
}

// Button per transfer; loads and toggles the alternatives below it.
function altButton(j, x) {
  const wrap = document.createElement("div");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "alt-btn";
  btn.textContent = "Alternativen";
  btn.title = `Alternativen ab ${x.stop}`;
  const panel = document.createElement("div");
  panel.hidden = true;
  let loaded = false;

  btn.addEventListener("click", async () => {
    panel.hidden = !panel.hidden;
    if (loaded || panel.hidden) {
      return;
    }
    loaded = true;
    panel.className = "alts";
    panel.textContent = "Suche …";
    try {
      renderAlternatives(panel, j, x, await Planner.alternatives(j, x));
    } catch (err) {
      loaded = false;
      panel.textContent = `Fehler: ${err.message}`;
    }
  });

  // Right: same parameters as a fresh search, results replace the list.
  const again = document.createElement("button");
  again.type = "button";
  again.className = "alt-btn";
  again.textContent = "Neue Suche";
  again.title = `Neue Suche ab ${x.stop}`;
  again.addEventListener("click", () => startSearch(Planner.followUpSearch(j, x)));

  const btns = document.createElement("div");
  btns.className = "alt-btns";
  const label = document.createElement("span");
  label.className = "at";
  label.textContent = `Ab ${x.stop}:`;
  btns.append(label, btn, again);
  wrap.append(btns, panel);
  return wrap;
}

// Legs of one alternative + changes and how it compares at the destination.
function renderAltDetail(a, j) {
  const box = document.createElement("div");
  box.className = "alt-detail";
  const table = document.createElement("table");
  table.className = "legs";
  a.trip.legs.forEach((l) => table.append(legRow({ ...l, walkMin: Math.round(l.walkSec / 60) })));

  const n = a.trip.transfers.length;
  const changes = n === 0 ? "direkt" : `${n}× umsteigen`;
  const delta = a.delta === 0 ? "wie geplant" : a.delta > 0 ? `${a.delta} Min. später als geplant` : `${-a.delta} Min. früher als geplant`;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${changes} · an ${j.to} ${hhmm(a.trip.arr)}, ${delta}`;
  box.append(table, meta);
  return box;
}

const ALT_REL_TEXT = {
  [AltRel.EARLIER]: "falls verspätet",
  [AltRel.PLANNED]: "geplant",
  [AltRel.LATER]: "verpasst",
};

// Mini timelines on a common axis; dashed line = my planned arrival at the
// transfer stop. Left of it: only reachable if that one is late.
function renderAlternatives(panel, j, x, alts) {
  panel.replaceChildren();
  const head = document.createElement("h4");
  head.textContent = `Ab ${x.stop} nach ${j.to} · an ${hhmm(x.from)}`;
  panel.append(head);

  if (!alts.length) {
    panel.append("Keine Verbindungen gefunden.");
    return;
  }

  const t0 = Math.min(x.from, ...alts.map((a) => a.trip.dep));
  const t1 = Math.max(...alts.map((a) => a.trip.arr));
  const axis = document.createElement("div");
  axis.className = "axis";

  alts.forEach((a) => {
    const row = document.createElement("div");
    row.className = `alt-row ${a.rel}`;
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = `${hhmm(a.trip.dep)} – ${hhmm(a.trip.arr)}`;
    const bar = document.createElement("div");
    bar.className = "bar mini";
    a.trip.legs.forEach((l) => {
      if (l.kind === LegKind.RIDE) {
        bar.append(labelled("transit", l.dep, l.arr, t0, t1, [l.line], `${l.line} → ${l.headsign}`));
      } else if (l.kind === LegKind.WALK) {
        bar.append(segment("walk", l.dep, l.arr, t0, t1));
      }
    });
    if (!a.trip.legs.length) {
      bar.append(segment("transit", a.trip.dep, a.trip.arr, t0, t1));
    }
    const d = document.createElement("span");
    d.className = "d";
    const wait = a.wait === 0 ? "±0" : a.wait > 0 ? `+${a.wait}` : `−${-a.wait}`;
    d.textContent = a.rel === AltRel.PLANNED ? `${ALT_REL_TEXT[a.rel]} ${wait}` : `${wait} Min.`;
    d.title = `${ALT_REL_TEXT[a.rel]} · Abfahrt gegenüber meiner Ankunft hier`;
    bar.append(segment("now", x.from, x.from, t0, t1));
    row.append(t, bar, d);

    // Tap a row: its legs as table, like the connection details.
    const detail = renderAltDetail(a, j);
    detail.hidden = true;
    row.addEventListener("click", () => {
      detail.hidden = !detail.hidden;
      row.classList.toggle("open", !detail.hidden);
    });
    axis.append(row, detail);
  });

  panel.append(axis);
  requestAnimationFrame(() => fitLabels(panel));

  const legend = document.createElement("div");
  legend.className = "legend";
  legend.textContent = "Gestrichelt: geplante Ankunft hier. Blass: fährt vorher, nur erreichbar bei Verspätung. ± = Abfahrt gegenüber meiner Ankunft hier.";
  panel.append(legend);
}
