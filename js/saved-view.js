// Saved connections card (★): upcoming rides by departure, live where near,
// past one-offs greyed with their deletion day. Click a row for its legs.

import { MS_PER_MIN } from "./config.js";
import { $, hhmm } from "./dom.js";
import { Saved, SavedStatus } from "./saved.js";
import { legTable } from "./journey-view.js";
import { iconButton } from "./results.js";

const WEEKLY_ICON = "↻";
const REMOVE_ICON = "×";

export const SavedView = (() => {
  // Ignores live answers that arrive after a newer render.
  let renderId = 0;

  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const weekday = (d) => d.toLocaleDateString("de-CH", { weekday: "long" });

  // Heute / Morgen / Fr 06.11.
  function dayLabel(d, now) {
    const days = Math.round((dayStart(d) - dayStart(now)) / (24 * 60 * MS_PER_MIN));
    if (days === 0) {
      return "Heute";
    }
    if (days === 1) {
      return "Morgen";
    }
    return d.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit" });
  }

  const delayTag = (min) => {
    const d = document.createElement("span");
    d.className = "delay";
    d.textContent = ` ${min > 0 ? "+" : ""}${min}`;
    d.title = "Minuten gegenüber Fahrplan";
    return d;
  };

  // Times line; delays of the first departure and the last arrival when live.
  function times(occ, now) {
    const t = document.createElement("span");
    t.className = "stimes";
    const day = document.createElement("span");
    day.className = "sday";
    day.textContent = dayLabel(occ.start, now);
    const first = occ.legs[0];
    const last = occ.legs[occ.legs.length - 1];
    t.append(day, hhmm(occ.start));
    if (first?.depDelayMin) {
      t.append(delayTag(first.depDelayMin));
    }
    t.append(` – ${hhmm(occ.end)}`);
    if (last?.arrDelayMin) {
      t.append(delayTag(last.arrDelayMin));
    }
    return t;
  }

  // weekly / past / live state, small under the route.
  function meta(row, live) {
    const m = document.createElement("div");
    m.className = "smeta";
    const parts = [];
    if (row.entry.weekly) {
      parts.push(`jeden ${weekday(row.occ.start)}`);
    }
    if (row.status === SavedStatus.PAST) {
      const d = row.expires.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit" });
      parts.push(`vorbei · wird am ${d} gelöscht`);
    }
    m.textContent = parts.join(" · ");
    if (live === "live") {
      m.append(parts.length ? " · " : "", "live");
    } else if (live === "gone") {
      const g = document.createElement("span");
      g.className = "gone";
      g.textContent = "nicht im Fahrplan gefunden – geändert?";
      m.append(parts.length ? " · " : "", g);
    } else if (live === "error") {
      m.append(parts.length ? " · " : "", "Fahrplan (live nicht erreichbar)");
    }
    return m;
  }

  function rowEl(row, now, occ = row.occ, live = null) {
    const li = document.createElement("li");
    li.className = row.status === SavedStatus.PAST ? "past" : "";
    const e = row.entry;
    const weekly = iconButton(WEEKLY_ICON, e.weekly ? "Nur noch einmal" : `Jeden ${weekday(occ.start)}`, (ev) => {
      ev.stopPropagation();
      Saved.setWeekly(e.id, !e.weekly);
      render();
    });
    weekly.classList.toggle("on", Boolean(e.weekly));
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "rm";
    rm.textContent = REMOVE_ICON;
    rm.title = "Löschen";
    rm.setAttribute("aria-label", "Löschen");
    rm.addEventListener("click", (ev) => {
      ev.stopPropagation();
      Saved.remove(e.id);
      render();
    });
    const route = document.createElement("div");
    route.className = "sroute";
    route.textContent = `${e.fromPlace} → ${e.toPlace} · ${e.lines}`;
    const legs = legTable(occ);
    legs.hidden = li.dataset.open !== "1";
    legs.addEventListener("click", (ev) => ev.stopPropagation());
    li.append(times(occ, now), weekly, rm, route, meta(row, live), legs);
    li.addEventListener("click", () => {
      legs.hidden = !legs.hidden;
    });
    return li;
  }

  // Scheduled first; near upcoming rides are then asked live and replaced in place.
  function render() {
    const id = ++renderId;
    const now = new Date();
    const rows = Saved.list(now);
    const list = $("saved-list");
    list.replaceChildren(...rows.map((r) => rowEl(r, now)));
    $("saved-empty").hidden = rows.length > 0;
    rows.forEach((r, i) => {
      if (r.status !== SavedStatus.UPCOMING || !Saved.isLiveRange(r.occ, now)) {
        return;
      }
      Saved.refresh(r.entry, now)
        .then((occ) => occ ? ["live", occ] : ["gone", r.occ])
        .catch(() => ["error", r.occ])
        .then(([live, occ]) => {
          const old = list.children[i];
          if (id !== renderId || !old) {
            return;
          }
          const fresh = rowEl(r, now, occ, live);
          fresh.querySelector(".legs").hidden = old.querySelector(".legs").hidden;
          old.replaceWith(fresh);
        });
    });
  }

  function open(show) {
    if (show && !$("places-panel").hidden) {
      $("settings").click(); // one card at a time
    }
    $("saved-panel").hidden = !show;
    $("saved-btn").setAttribute("aria-expanded", String(show));
    document.querySelector("main")?.classList.toggle("settings-open", show);
    if (show) {
      render();
    }
  }

  function init() {
    $("saved-btn").addEventListener("click", () => open($("saved-panel").hidden));
    $("saved-refresh").addEventListener("click", render);
  }

  return { init, render };
})();
