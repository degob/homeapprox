// Results: caps, line filter, summary and the main render().
//
// state: the current search result and UI flags, shared with app.js
// (ES imports are read-only, so it is an object, not two lets).

import { CapKind, LegKind, MS_PER_MIN, RECENT_PAST_MIN, TimeRef, WalkMode } from "./config.js";
import { Planner } from "./planner.js";
import { $, minutes } from "./dom.js";
import { durColor, fitLabels, renderJourney } from "./journey-view.js";
import { Timeline } from "./timeline.js";

function durationScale(journeys) {
  const mins = journeys.map((j) => minutes(j.start, j.end));
  return { best: Math.min(...mins), worst: Math.max(...mins) };
}

// ---------- Caps: trim the slowest / most-changes journeys step by step ----------

const CUT_ICON = "✂";
const RESET_ICON = "↺";
const DURATION_ICON = "⏱";
const WALK_ICON = "🚶";
const LINES_ICON = "🚌";
const CHANGES_ICON = "⇄";
const DURATION_CUT_STEP_MIN = 5;
// Share of journeys kept when jumping straight to the best value.
const KEEP_SHARE = 0.1;

const durationOf = (j) => minutes(j.start, j.end);
const changesOf = (j) => j.transfers.length;

// One cap per measure. cut() lowers the cap by at least the measure's step
// below the current maximum of the shown journeys, landing on an existing
// value, e.g. durations 31 38 41 52, step 5 → 41 (≤ 47). It ends at the
// minimum; reset() lifts the cap.
export const Caps = (() => {
  const caps = { [CapKind.DURATION]: null, [CapKind.CHANGES]: null };
  const measure = { [CapKind.DURATION]: durationOf, [CapKind.CHANGES]: changesOf };
  const step = { [CapKind.DURATION]: DURATION_CUT_STEP_MIN, [CapKind.CHANGES]: 1 };

  // `except`: leave that one cap out, to see what it alone hides.
  const apply = (journeys, except = null) =>
    journeys.filter((j) =>
      Object.keys(caps).every((k) => k === except || caps[k] === null || measure[k](j) <= caps[k])
    );

  function nextCap(kind, journeys) {
    const values = [...new Set(journeys.map(measure[kind]))].sort((a, b) => a - b);
    if (values.length < 2) {
      return null;
    }
    const target = values[values.length - 1] - step[kind];
    const below = values.filter((v) => v <= target);
    return below.length ? below[below.length - 1] : values[0];
  }

  // Cap at the N-th smallest value, N = KEEP_SHARE of the shown journeys
  // (at least one): e.g. 12 journeys → 2 kept → cap = 2nd smallest duration.
  function cutToBest(kind, journeys) {
    const sorted = journeys.map(measure[kind]).sort((a, b) => a - b);
    const keep = Math.max(1, Math.ceil(sorted.length * KEEP_SHARE));
    caps[kind] = sorted[keep - 1];
  }

  const canCut = (kind, journeys) => nextCap(kind, journeys) !== null;
  const cut = (kind, journeys) => { caps[kind] = nextCap(kind, journeys) ?? caps[kind]; };
  const reset = (kind) => { caps[kind] = null; };
  const resetAll = () => Object.keys(caps).forEach(reset);
  const active = (kind) => caps[kind] !== null;

  return { apply, canCut, cut, cutToBest, reset, resetAll, active };
})();

// Lines picked in the summary; a journey passes when it rides any of them.
export const LineFilter = (() => {
  const picked = new Set();
  const linesOf = (j) => j.legs.filter((l) => l.kind === LegKind.RIDE).map((l) => l.line);

  const apply = (journeys) =>
    picked.size ? journeys.filter((j) => linesOf(j).some((l) => picked.has(l))) : journeys;
  const toggle = (line) => { picked.has(line) ? picked.delete(line) : picked.add(line); };
  const clear = () => picked.clear();
  const active = () => picked.size > 0;
  const has = (line) => picked.has(line);

  // Lines to offer: all ridden in `journeys`, plus picked ones no longer
  // present (so they can be unpicked). Trains first, then natural order.
  function offer(journeys) {
    const all = new Set([...picked, ...journeys.flatMap(linesOf)]);
    const rank = (l) => (/^[A-Z]/.test(l) ? 0 : 1);
    return [...all].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "de", { numeric: true }));
  }

  return { apply, toggle, clear, active, has, offer, linesOf };
})();

export function iconButton(icon, title, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn";
  btn.textContent = icon;
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.addEventListener("click", onClick);
  return btn;
}

// Third summary row: the walk toggle; "3/8" = journeys with an extra walk
// out of all that pass the caps.
//   🚶  Mit zusätzlichem Fussweg (3/8)        [x]
function walkRow(everything) {
  const capped = LineFilter.apply(Caps.apply(everything));
  const n = capped.filter((j) => j.hasExtraWalk).length;
  const icon = document.createElement("span");
  icon.className = "icon";
  icon.textContent = WALK_ICON;
  icon.title = "Zusätzlicher Fussweg";
  const label = document.createElement("label");
  label.className = "range toggle";
  label.append(`Mit zusätzlichem Fussweg (${n}/${capped.length})`);
  const slot = document.createElement("span");
  slot.className = "slot";
  walkBox.hidden = false;
  slot.append(walkBox);
  label.htmlFor = "walk";
  return [icon, label, slot, document.createElement("span")];
}

// Last summary row: collapsed, "Linien" plus how many are picked; expanded,
// one chip per line in the shown journeys, picked chips filled.
// `others` = journeys passing every other filter.
//   🚌  Linien (2 gewählt) ▸                     ↺
//   🚌  [S8] [S19] [62] [787] ▾                  ↺

function linesRow(others) {
  const icon = document.createElement("span");
  icon.className = "icon";
  icon.textContent = LINES_ICON;
  icon.title = "Linien";

  const chips = document.createElement("span");
  chips.className = "range chips";
  const caret = document.createElement("button");
  caret.type = "button";
  caret.className = "caret";
  caret.textContent = state.linesOpen ? "▾" : "▸";
  caret.title = state.linesOpen ? "Linien einklappen" : "Linien anzeigen";
  caret.setAttribute("aria-expanded", String(state.linesOpen));
  caret.addEventListener("click", () => { state.linesOpen = !state.linesOpen; render(); });

  if (!state.linesOpen) {
    const n = LineFilter.offer(others).filter(LineFilter.has).length;
    const label = document.createElement("span");
    label.className = "jump";
    label.textContent = n ? `Linien (${n} gewählt)` : "Linien";
    label.addEventListener("click", () => { state.linesOpen = true; render(); });
    chips.append(label, caret);
  }

  state.linesOpen && LineFilter.offer(others).forEach((line) => {
    const n = others.filter((j) => LineFilter.linesOf(j).includes(line)).length;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = LineFilter.has(line) ? "chip on" : "chip";
    chip.textContent = line;
    chip.title = `${n} Verbindung${n === 1 ? "" : "en"}`;
    chip.setAttribute("aria-pressed", String(LineFilter.has(line)));
    chip.addEventListener("click", () => { LineFilter.toggle(line); render(); });
    chips.append(chip);
  });
  if (state.linesOpen) {
    chips.append(caret);
  }

  // Reset in the last column, aligned with the other rows' ↺.
  const slot = document.createElement("span");
  slot.className = "slot";
  if (LineFilter.active()) {
    slot.append(iconButton(RESET_ICON, "Filter aufheben", () => { LineFilter.clear(); render(); }));
  }
  return [icon, chips, document.createElement("span"), slot];
}

// Summary grid, one row per measure: icon | range | ✂ ↺ (right-aligned,
// slots kept so nothing jumps when a button appears).
//   ⏱  [31 Min.] – [52 Min.]        ✂  ↺
//   ⇄  0 – 2× umsteigen             ✂
// `all` = journeys before the caps: colors and the "(max. …)" hint keep
// referring to the full range, so a capped list still shows what was cut.
function renderSummary(journeys, all, everything) {
  const box = $("summary");
  box.replaceChildren();
  if (!everything.length) {
    return;
  }
  // Order: duration, changes, walk, lines (collapsed by default).
  const tail = [...walkRow(everything), ...linesRow(Caps.apply(all))];
  if (!journeys.length) {
    box.append(...tail);
    return;
  }
  const scale = durationScale(all);
  const { best, worst } = durationScale(journeys);
  // What each cap alone hides: other filters applied, this one left out.
  const worstButDur = durationScale(LineFilter.apply(Caps.apply(all, CapKind.DURATION))).worst;
  const maxCButChg = Math.max(...LineFilter.apply(Caps.apply(all, CapKind.CHANGES)).map(changesOf));

  const pill = (min) => {
    const p = document.createElement("span");
    p.className = "dur";
    p.textContent = `${min} Min.`;
    p.style.background = durColor(min, scale.best, scale.worst);
    return p;
  };
  // Clickable pills: best jumps straight to the shortest durations
  // (cutToBest), worst cuts one step like the scissors.
  const clickable = (el, title, action) => {
    el.classList.add("jump");
    el.title = title;
    el.setAttribute("role", "button");
    el.addEventListener("click", () => { action(); render(); });
    return el;
  };
  const toBest = (kind) => () => Caps.cutToBest(kind, journeys);
  const cutOne = (kind) => () => Caps.cut(kind, journeys);
  const bestPill = (min) => clickable(pill(min), "Nur die kürzesten zeigen", toBest(CapKind.DURATION));
  const worstPill = (min) => clickable(pill(min), "Längste weglassen", cutOne(CapKind.DURATION));
  const text = (t) => {
    const s = document.createElement("span");
    s.textContent = t;
    return s;
  };
  const range = (lo, hi) => (lo === hi ? [lo] : [lo, " – ", hi]);
  const cell = (cls, ...parts) => {
    const span = document.createElement("span");
    span.className = cls;
    span.append(...parts);
    return span;
  };
  const row = (kind, icon, iconTitle, ...parts) => {
    const ic = cell("icon", icon);
    ic.title = iconTitle;
    ic.setAttribute("aria-label", iconTitle);
    const cut = Caps.canCut(kind, journeys)
      ? iconButton(CUT_ICON, "Grösste weglassen", () => { Caps.cut(kind, journeys); render(); })
      : "";
    const reset = Caps.active(kind)
      ? iconButton(RESET_ICON, "Filter aufheben", () => { Caps.reset(kind); render(); })
      : "";
    return [ic, cell("range", ...parts), cell("slot", cut), cell("slot", reset)];
  };

  const changes = journeys.map(changesOf);
  const minC = Math.min(...changes);
  const maxC = Math.max(...changes);
  // Shown when a cap hides the top: "(max. 52 Min.)"; click lifts the cap.
  const hint = (kind, shown, full, unit) =>
    shown < full ? [clickable(text(`(max. ${full}${unit})`), "Filter aufheben", () => Caps.reset(kind))] : [];

  box.append(
    ...row(CapKind.DURATION, DURATION_ICON, "Dauer",
      ...(best === worst ? [pill(best)] : [bestPill(best), " – ", worstPill(worst)]),
      ...hint(CapKind.DURATION, worst, worstButDur, " Min.")),
    ...row(CapKind.CHANGES, CHANGES_ICON, "Umsteigen", ...(minC === maxC
      ? [text(`${minC}× umsteigen`)]
      : [
          clickable(text(String(minC)), "Nur die wenigsten zeigen", toBest(CapKind.CHANGES)),
          " – ",
          clickable(text(String(maxC)), "Meiste weglassen", cutOne(CapKind.CHANGES)),
          "× umsteigen",
        ]),
      ...hint(CapKind.CHANGES, maxC, maxCButChg, "×")),
    ...tail
  );
}

// Last search result; the walk toggle filters it without searching again.
export const state = { lastResult: null, linesOpen: false };

// Held by reference: the box lives inside #summary, which render() rebuilds,
// so it is detached between renders and $("walk") would miss it.
export const walkBox = $("walk");
const walkMode = () => (walkBox.checked ? WalkMode.SHOW : WalkMode.HIDE);

// "vor 3 Min." if the asked time is now, else "3 Min. früher"; null if not past.
function pastLabel(j) {
  const r = state.lastResult;
  if (!r || r.timeRef !== TimeRef.DEPART || j.start >= r.at) {
    return null;
  }
  const n = minutes(j.start, r.at);
  if (n > RECENT_PAST_MIN) {
    return null; // fetched with "Frühere": just earlier, not a run candidate
  }
  const asked = Math.abs(Date.now() - r.at) < 2 * MS_PER_MIN;
  return asked ? `vor ${n} Min.` : `${n} Min. früher`;
}

export function render() {
  const list = $("results");
  list.replaceChildren();
  $("summary").replaceChildren();
  $("earlier").hidden = !state.lastResult;
  $("later").hidden = !state.lastResult;
  if (!state.lastResult) {
    return;
  }

  const { failed } = state.lastResult;
  const everything = Planner.visible(state.lastResult, WalkMode.SHOW);
  const all = Planner.visible(state.lastResult, walkMode());
  const journeys = LineFilter.apply(Caps.apply(all));

  renderSummary(journeys, all, everything);
  const status = $("status");
  status.className = failed.length ? "error" : "";
  status.textContent = failed.length ? `Keine Daten für: ${failed.join(", ")}` : "";

  if (!journeys.length) {
    status.textContent ||= "Keine Verbindungen gefunden. Ort oder Zeit anpassen.";
    return;
  }

  const t0 = Math.min(...journeys.map((j) => j.start));
  const t1 = Math.max(...journeys.map((j) => j.end));
  const scale = durationScale(all);
  journeys.forEach((j) => {
    const li = renderJourney(j, t0, t1, scale, pastLabel(j));
    li.classList.toggle("past", Boolean(pastLabel(j)));
    list.append(li);
  });
  const avg = journeys.reduce((sum, j) => sum + (j.end - j.start), 0) / journeys.length;
  Timeline.fit(list, t1 - t0, avg);
  fitLabels(list);
}
