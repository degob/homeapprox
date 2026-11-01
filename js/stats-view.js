// Hidden API statistics in the settings card: tap "⌂ Orte" STATS_TAPS times
// within STATS_TAP_WINDOW_MS to show or hide it. Calls per window, the last
// searches from the call log, and the log as a file (share sheet or download).

import {
  BOARD_LIMIT, BOARD_MAX_REQUERIES, BOARD_SLACK_MIN, CONNECTIONS_PER_STOP, CallPurpose, LOG_FILE, LOG_SHOWN,
  MAX_PAGES, MIN_WINDOW_MIN, REQUERY_LIMIT, STATS_TAPS, STATS_TAP_WINDOW_MS
} from "./config.js";
import { $, hhmm } from "./dom.js";
import { ApiStats } from "./api-stats.js";
import { CallLog } from "./call-log.js";
import { Places } from "./places.js";

const ENDPOINTS = Object.freeze([
  ["connections", "Verb."],
  ["stationboard", "Tafeln"],
  ["locations", "Orte"],
]);

const SEARCH_CALLS = Object.freeze([
  [CallPurpose.BASE, "Basis"],
  [CallPurpose.PAGE, "Seiten"],
  [CallPurpose.BOARD, "Tafeln"],
  [CallPurpose.REQUERY, "Nachfragen"],
]);

export const StatsView = (() => {
  let taps = [];
  const el = (tag, text, cls = "") => Object.assign(document.createElement(tag), { textContent: text, className: cls });

  function renderTable() {
    const head = document.createElement("tr");
    head.append(el("th", "Zeitraum"), el("th", "Total", "n"), ...ENDPOINTS.map(([, label]) => el("th", label, "n")));
    const rows = ApiStats.summary().map((w) => {
      const tr = document.createElement("tr");
      tr.append(el("td", w.label), el("td", String(w.total), "n total"),
        ...ENDPOINTS.map(([e]) => el("td", String(w.byEndpoint[e] || 0), "n")));
      return tr;
    });
    $("stats-table").replaceChildren(head, ...rows);
  }

  //   09:31 Zuhause → Zürich HB, Zuhause → Oerlikon
  //   78 Aufrufe, 2.4 s · Basis 14 · Seiten 9 · Tafeln 11 · Nachfragen 40
  //   gezeigt 12 · aus Nachfragen 2 · ab Nebenhaltestelle 1
  function renderLog() {
    const items = CallLog.recent(LOG_SHOWN).map((s) => {
      const li = document.createElement("li");
      const what = s.kind === "extend" ? `${s.side === "earlier" ? "Frühere" : "Spätere"}: ` : "";
      const secs = s.ms === null ? "" : `, ${(s.ms / 1000).toFixed(1)} s`;
      const calls = SEARCH_CALLS.map(([p, label]) => `${label} ${s.calls[p] || 0}`).join(" · ");
      const shown = s.error
        ? `Fehler: ${s.error}`
        : `gezeigt ${s.shown} · aus Nachfragen ${s.shownRequery} · ab Nebenhaltestelle ${s.shownSecondary}`;
      li.append(el("strong", `${hhmm(s.t)} ${what}${s.pairs.join(", ")}`),
        el("span", `${s.total} Aufrufe${secs} · ${calls}`, "meta"),
        el("span", shown, "meta"));
      return li;
    });
    $("stats-log").replaceChildren(...(items.length ? items : [el("li", "Noch keine Suche protokolliert.", "meta")]));
  }

  function render() {
    renderTable();
    renderLog();
  }

  // Log with what is needed to read it: places (stops, walks) and limits.
  function exportText() {
    return CallLog.exportJson({
      places: Places.all(),
      config: {
        CONNECTIONS_PER_STOP, MAX_PAGES, MIN_WINDOW_MIN, BOARD_LIMIT, BOARD_SLACK_MIN, BOARD_MAX_REQUERIES, REQUERY_LIMIT,
      },
    });
  }

  // Phone: share sheet (mail, messenger, files); otherwise a download.
  async function onExport() {
    const text = exportText();
    const file = new File([text], LOG_FILE, { type: "application/json" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "HomeApprox Log" });
        return;
      } catch (err) {
        if (err.name === "AbortError") {
          return;
        }
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = LOG_FILE;
    a.click();
    URL.revokeObjectURL(a.href);
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
    $("stats-export").addEventListener("click", onExport);
    $("stats-reset").addEventListener("click", () => {
      if (confirm("API-Statistik und Log zurücksetzen?")) {
        ApiStats.reset();
        CallLog.reset();
        render();
      }
    });
  }

  return { init, exportText };
})();
