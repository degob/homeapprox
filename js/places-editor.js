// Places editor: list, add, edit, delete

import { DEBOUNCE_MS, EXPORT_FILE, MIN_QUERY_CHARS } from "./config.js";
import { Planner } from "./planner.js";
import { Places } from "./places.js";
import { $ } from "./dom.js";
import { iconButton } from "./results.js";

//   ⌂ Orte
//   Büro   Zürich Oerlikon 5' · Zürich Seebach 12'   [✎] [×]
//   [Name          ]
//   [Haltestelle   ] [ 5] Min. [×]
//   [+ Haltestelle] [Speichern]
export const PlacesEditor = (() => {
  let editing = null; // name of the place being edited, null = new
  let timer = null;

  function stopRow(stop = { name: "", walkMin: "" }) {
    const row = document.createElement("div");
    row.className = "stop-row";
    const name = document.createElement("input");
    name.type = "text";
    name.placeholder = "Haltestelle";
    name.setAttribute("list", "stop-options");
    name.value = stop.name;
    name.addEventListener("input", () => fillOptions(name.value));
    const walk = document.createElement("input");
    walk.type = "number";
    walk.min = "0";
    walk.placeholder = "Min.";
    walk.value = stop.walkMin;
    walk.title = "Gehminuten";
    walk.setAttribute("aria-label", "Gehminuten");
    // Secondary: only shown when its vehicle isn't already in another journey.
    const sec = document.createElement("input");
    sec.type = "checkbox";
    sec.checked = Boolean(stop.secondary);
    sec.title = "Nebenhaltestelle: nur wenn ihr Bus nicht schon über eine andere Haltestelle erreicht wird";
    sec.setAttribute("aria-label", "Nebenhaltestelle");
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "rm";
    rm.textContent = "×";
    rm.setAttribute("aria-label", "Haltestelle entfernen");
    rm.addEventListener("click", () => row.remove());
    row.append(name, walk, sec, rm);
    return row;
  }

  // Datalist for stop names: API lookup after MIN_QUERY_CHARS, debounced.
  function fillOptions(query) {
    clearTimeout(timer);
    if (query.trim().length < MIN_QUERY_CHARS) {
      return;
    }
    timer = setTimeout(async () => {
      try {
        const names = await Planner.suggest(query.trim(), []);
        const dl = $("stop-options");
        dl.replaceChildren(...names.map((n) => Object.assign(document.createElement("option"), { value: n })));
      } catch {
        // No suggestions; typing still works.
      }
    }, DEBOUNCE_MS);
  }

  function readForm() {
    const stops = [...$("pf-stops").querySelectorAll(".stop-row")].map((r) => {
      const [name, walk, sec] = r.querySelectorAll("input");
      return { name: name.value, walkMin: walk.value, secondary: sec.checked };
    });
    const keepHome = editing !== null && Places.byName(editing)?.home;
    return Places.normalize($("pf-name").value, stops, keepHome);
  }

  function showForm(place) {
    editing = place ? place.name : null;
    $("pf-title").textContent = place ? `${place.name} bearbeiten` : "Neuer Ort";
    $("pf-name").value = place ? place.name : "";
    $("pf-stops").replaceChildren(...(place ? place.stops : [{ name: "", walkMin: "" }]).map(stopRow));
    $("pf-cancel").hidden = !place;
    $("pf-delete").hidden = !place;
    $("pf-error").textContent = "";
  }

  function renderList() {
    const ul = $("places-list");
    ul.replaceChildren();
    Places.all().forEach((p) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "pname";
      name.textContent = p.name;
      const stops = document.createElement("span");
      stops.className = "pstops";
      stops.textContent = p.stops.map((s) => `${s.name} ${s.walkMin}'${s.secondary ? " (neben)" : ""}`).join(" · ");
      // ★ marks the default "Von"; click another to move it. Delete lives
      // in the edit form.
      const star = iconButton("★", p.home ? "Standard-Von" : "Als Standard-Von", () => { Places.setHome(p.name); renderList(); });
      star.classList.toggle("on", p.home);
      li.append(star, name, iconButton("✎", "Bearbeiten", () => showForm(p)), stops);
      ul.append(li);
    });
  }

  function onSave() {
    try {
      Places.put(readForm(), editing ?? undefined);
    } catch (err) {
      $("pf-error").textContent = err.message;
      return;
    }
    renderList();
    showForm(null);
  }

  const status = (text, error = false) => {
    $("px-status").textContent = text;
    $("px-status").className = error ? "error" : "meta";
  };

  function onExport() {
    const blob = new Blob([Places.exportJson()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = EXPORT_FILE;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function onLink() {
    const link = Places.toLink(location.href.split("#")[0]);
    try {
      await navigator.clipboard.writeText(link);
      status("Link kopiert.");
    } catch {
      prompt("Link kopieren:", link);
    }
  }

  async function onImport(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) {
      return;
    }
    importText(await file.text());
  }

  function importText(text) {
    try {
      const n = Places.importJson(text);
      renderList();
      status(`${n} Ort${n === 1 ? "" : "e"} importiert.`);
    } catch (err) {
      status(err.message, true);
    }
  }

  // Shows/hides the card; the search form below is dimmed meanwhile.
  function openSettings(open) {
    if (open && !$("saved-panel").hidden) {
      $("saved-btn").click(); // one card at a time
    }
    $("places-panel").hidden = !open;
    $("settings").setAttribute("aria-expanded", String(open));
    document.querySelector("main")?.classList.toggle("settings-open", open);
  }

  // Opened via a share link: import, open the card, drop the fragment.
  function importFromHash() {
    const text = Places.fromHash(location.hash);
    if (text === null) {
      return;
    }
    openSettings(true);
    importText(text);
    history.replaceState(null, "", location.pathname + location.search);
  }

  function init() {
    renderList();
    showForm(null);
    $("px-export").addEventListener("click", onExport);
    $("px-link").addEventListener("click", onLink);
    $("px-import").addEventListener("change", onImport);
    importFromHash();
    $("pf-save").addEventListener("click", onSave);
    // Enter inside the editor saves the place, not the search form.
    $("place-form").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onSave();
      }
    });
    $("pf-add").addEventListener("click", () => $("pf-stops").append(stopRow()));
    $("pf-cancel").addEventListener("click", () => showForm(null));
    $("pf-delete").addEventListener("click", () => {
      if (editing !== null) {
        Places.remove(editing);
        renderList();
        showForm(null);
      }
    });
    $("settings").addEventListener("click", () => openSettings($("places-panel").hidden));
  }

  return { init };
})();
