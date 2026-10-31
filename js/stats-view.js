// Hidden API statistics in the settings card: tap "⌂ Orte" STATS_TAPS times
// within STATS_TAP_WINDOW_MS to show or hide it.

import { STATS_TAPS, STATS_TAP_WINDOW_MS } from "./config.js";
import { $ } from "./dom.js";
import { ApiStats } from "./api-stats.js";

const ENDPOINTS = Object.freeze([
  ["connections", "Verb."],
  ["stationboard", "Tafeln"],
  ["locations", "Orte"],
]);

export const StatsView = (() => {
  let taps = [];

  function render() {
    const cell = (tag, text, cls = "") => Object.assign(document.createElement(tag), { textContent: text, className: cls });
    const head = document.createElement("tr");
    head.append(cell("th", "Zeitraum"), cell("th", "Total", "n"), ...ENDPOINTS.map(([, label]) => cell("th", label, "n")));
    const rows = ApiStats.summary().map((w) => {
      const tr = document.createElement("tr");
      tr.append(cell("td", w.label), cell("td", String(w.total), "n total"),
        ...ENDPOINTS.map(([e]) => cell("td", String(w.byEndpoint[e] || 0), "n")));
      return tr;
    });
    $("stats-table").replaceChildren(head, ...rows);
  }

  function onTitleTap() {
    const now = Date.now();
    taps = [...taps.filter((t) => now - t < STATS_TAP_WINDOW_MS), now];
    if (taps.length < STATS_TAPS) {
      return;
    }
    taps = [];
    const box = $("stats");
    box.hidden = !box.hidden;
    if (!box.hidden) {
      render();
      box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function init() {
    $("places-title").addEventListener("click", onTitleTap);
    $("settings").addEventListener("click", () => !$("stats").hidden && render());
    $("stats-reset").addEventListener("click", () => {
      if (confirm("API-Statistik zurücksetzen?")) {
        ApiStats.reset();
        render();
      }
    });
  }

  return { init };
})();
