// HomeApprox entry point: form handlers and wiring.
//
// Compares connections over all stops near home, incl. walking time.
//
//   Home ──walk──► Stop A ──transit──► Place
//        ──walk──► Stop B ──transit──►
//        ──walk──► ...
//
// Modules (UI ──► logic ──► API, never upwards):
//   app ──► results, timeline, journey-view, place-fields, places-editor   (UI)
//       ──► planner (adds walking, merges, sorts) ──► api (HTTP)
//       ──► stations, places (localStorage)
//   config, dom: shared constants and helpers

import { DEBOUNCE_MS } from "./config.js";
import { Planner } from "./planner.js";
import { Stations } from "./stations.js";
import { Places } from "./places.js";
import { $, hhmm, localDateValue } from "./dom.js";
import { fitLabels, initInputs, onDateChange, onPickDate, showDate } from "./journey-view.js";
import { Destinations, closeSuggestions, placeFields } from "./place-fields.js";
import { PlacesEditor } from "./places-editor.js";
import { SavedView } from "./saved-view.js";
import { Caps, LineFilter, render, state, walkBox } from "./results.js";
import { Timeline } from "./timeline.js";

async function onSubmit(e) {
  e.preventDefault();

  const places = Destinations.all();
  const origin = $("origin").value.trim();
  if (!places.length || !origin) {
    return;
  }

  closeSuggestions();
  Destinations.set(places);
  // Recent list: stations only; custom places are listed anyway.
  [origin, ...places].filter((n) => !Places.byName(n)).forEach(Stations.touch);

  const at = new Date(`${$("date").value}T${$("time").value}`);
  const timeRef = document.querySelector("input[name=ref]:checked").value;
  $("status").className = "";
  $("status").textContent = "Suche …";
  state.lastResult = null;
  Caps.resetAll();
  LineFilter.clear();
  state.linesOpen = false;
  render();

  try {
    const from = Places.resolve(origin);
    const pairs = places.map((p) => [from, Places.resolve(p)]);
    state.lastResult = await Planner.searchPairs(pairs, at, timeRef);
    Timeline.reset();
    render();
  } catch (err) {
    $("status").className = "error";
    $("status").textContent = `Fehler: ${err.message}`;
  }
}

// ⌂ inside Von/Nach when the text is a known place.
export function markPlaces() {
  ["origin", "place"].forEach((id) => {
    const input = $(id);
    const box = input.closest?.(".place");
    box?.classList.toggle("known", Boolean(Places.byName(input.value.trim())));
    box?.classList.toggle("filled", input.value !== "");
  });
}

// ×: empties the field and opens its list (places, favorites, recent).
function onClear(e) {
  const input = $(e.currentTarget.dataset.for);
  input.value = "";
  markPlaces();
  input.focus();
}

// Jetzt: today, current time. Does not search.
export function onNow() {
  const now = new Date();
  $("date").value = localDateValue(now);
  $("time").value = hhmm(now);
  showDate();
}

// ⇅: Von ↔ first Nach. Further destinations are dropped (one Von only).
function onSwap() {
  const dests = Destinations.all();
  const origin = $("origin").value.trim();
  $("origin").value = dests[0] || "";
  Destinations.set(origin ? [origin] : []);
  markPlaces();
}

const pad2 = (n) => String(n).padStart(2, "0");

// Fills the form from search parameters and runs it, e.g. "Neue Suche ab …".
export function startSearch({ from, to, at, timeRef }) {
  document.querySelector(`input[name=ref][value="${timeRef}"]`).checked = true;
  $("origin").value = from;
  Destinations.set([to]);
  markPlaces();
  $("date").value = `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
  $("time").value = hhmm(at);
  window.scrollTo({ top: 0, behavior: "smooth" });
  $("form").requestSubmit();
}

// Frühere / Spätere: widen the current result, keep the list in place.
async function onMore(side) {
  const btn = $(side);
  if (!state.lastResult || btn.disabled) {
    return;
  }
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Lädt …";
  try {
    state.lastResult = await Planner.extend(state.lastResult, side);
    render();
  } catch (err) {
    $("status").className = "error";
    $("status").textContent = `Fehler: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

initInputs();
Timeline.init();
$("earlier").addEventListener("click", () => onMore("earlier"));
$("later").addEventListener("click", () => onMore("later"));
placeFields.forEach((f) => f.init());
PlacesEditor.init();
SavedView.init();
$("swap").addEventListener("click", onSwap);
$("add-dest").addEventListener("click", Destinations.park);
["origin", "place"].forEach((id) => $(id).addEventListener("input", markPlaces));
markPlaces();
$("pick-date").addEventListener("click", onPickDate);
$("now").addEventListener("click", onNow);
document.querySelectorAll(".place .clear").forEach((b) => b.addEventListener("click", onClear));
$("date").addEventListener("change", onDateChange);
$("date").addEventListener("blur", () => { $("date").hidden = true; });
$("form").addEventListener("submit", onSubmit);
walkBox.addEventListener("change", render);
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => fitLabels($("results")), DEBOUNCE_MS);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".place")) {
    closeSuggestions();
  }
});
// Close the other field's list when one field gets focus.
document.addEventListener("focusin", (e) => {
  if (e.target.id === "place") {
    placeFields[1].close();
  } else if (e.target.id === "origin") {
    placeFields[0].close();
  }
});
