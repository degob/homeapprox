// Place suggestions (one widget per field: Ort/Nach, Von)

import { DEBOUNCE_MS, PLACE_ICON } from "./config.js";
import { Planner } from "./planner.js";
import { Stations } from "./stations.js";
import { Places } from "./places.js";
import { $ } from "./dom.js";
import { render } from "./results.js";
import { markPlaces } from "./app.js";

// `onPick(name)`: what a chosen suggestion does; default fills the field.
function placeField(inputId, listId, onPick = (name) => { $(inputId).value = name; markPlaces(); }) {
  const input = () => $(inputId);
  const list = () => $(listId);
  let timer = null;
  let seq = 0;

  function item(name) {
    const li = document.createElement("li");
    li.setAttribute("role", "option");

    const label = document.createElement("span");
    label.className = "name";
    label.textContent = Places.byName(name) ? `${PLACE_ICON} ${name}` : name;

    const star = document.createElement("button");
    star.type = "button";
    star.className = Stations.isFavorite(name) ? "star on" : "star";
    star.textContent = "★";
    star.setAttribute("aria-label", "Favorit");
    star.addEventListener("click", (e) => {
      e.stopPropagation();
      star.classList.toggle("on", Stations.toggleFavorite(name));
    });

    li.append(label);
    if (!Places.byName(name)) {
      li.append(star);
    }
    li.addEventListener("click", () => {
      onPick(name);
      close();
    });
    return li;
  }

  function group(text) {
    const li = document.createElement("li");
    li.className = "group";
    li.textContent = text;
    return li;
  }

  // Also cancels a pending lookup, so it can't pop up after a search started.
  function close() {
    clearTimeout(timer);
    ++seq;
    list().replaceChildren();
    input().setAttribute("aria-expanded", "false");
  }

  function show(names, grouped) {
    const l = list();
    l.replaceChildren();
    if (grouped) {
      // A name that became a place is listed under Orte only.
      const places = Places.names();
      const notPlace = (n) => !Places.byName(n);
      const favs = Stations.favorites().filter(notPlace);
      const recent = Stations.recent().filter(notPlace);
      if (places.length) {
        l.append(group("Orte"), ...places.map(item));
      }
      if (favs.length) {
        l.append(group("Favoriten"), ...favs.map(item));
      }
      if (recent.length) {
        l.append(group("Zuletzt"), ...recent.map(item));
      }
    } else {
      l.append(...names.map(item));
    }
    input().setAttribute("aria-expanded", l.children.length ? "true" : "false");
  }

  // Empty field: favorites + recent. Otherwise: debounced lookup, stale replies dropped.
  function onInput() {
    clearTimeout(timer);
    const query = input().value.trim();
    const s = ++seq;
    if (!query) {
      show([], true);
      return;
    }
    timer = setTimeout(async () => {
      const known = [...new Set([...Places.names(), ...Stations.favorites(), ...Stations.recent()])];
      try {
        const names = await Planner.suggest(query, known);
        if (s === seq) {
          show(names, false);
        }
      } catch {
        close();
      }
    }, DEBOUNCE_MS);
  }

  // Tap on the field: favorites + recent, not hits for the current text.
  // Text is selected, so typing replaces it.
  function onFocus() {
    clearTimeout(timer);
    ++seq;
    show([], true);
    input().select();
  }

  function init() {
    input().addEventListener("input", onInput);
    input().addEventListener("focus", onFocus);
  }

  return { init, close };
}

// Destinations: the field holds one; "+" moves it to a chip so another
// can be typed. Chips plus the field's text are the destinations.
//   [Zürich HB ×] [Stettbach ×]   ┌ Nach … ┐ [+]
export const Destinations = (() => {
  let names = [];

  function render() {
    const box = $("dests");
    box.replaceChildren();
    names.forEach((name) => {
      const chip = document.createElement("span");
      chip.className = "dest";
      chip.append(Places.byName(name) ? `${PLACE_ICON} ${name}` : name);
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "rm";
      rm.textContent = "×";
      rm.setAttribute("aria-label", `${name} entfernen`);
      rm.addEventListener("click", () => { remove(name); });
      chip.append(rm);
      box.append(chip);
    });
    $("place").required = names.length === 0;
    markPlaces();
  }

  // "+": field text becomes a chip, field is free for the next one.
  function park() {
    const typed = $("place").value.trim();
    if (typed && !names.includes(typed)) {
      names = [...names, typed];
    }
    $("place").value = "";
    render();
    $("place").focus();
  }

  function remove(name) {
    names = names.filter((n) => n !== name);
    render();
  }

  // Last one in the field, the rest as chips: a single destination is
  // plain text, not a chip.
  function set(list) {
    const uniq = [...new Set(list.filter(Boolean))];
    names = uniq.slice(0, -1);
    $("place").value = uniq[uniq.length - 1] || "";
    render();
  }

  // Chips plus whatever is still typed in the field.
  function all() {
    const typed = $("place").value.trim();
    return typed && !names.includes(typed) ? [...names, typed] : names;
  }

  return { park, set, all, render };
})();

export const placeFields = [placeField("place", "sugg"), placeField("origin", "origin-sugg")];
export const closeSuggestions = () => placeFields.forEach((f) => f.close());
