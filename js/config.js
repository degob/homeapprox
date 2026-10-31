// Config

// Walk minutes from home to each stop. Names as known by the SBB timetable.
const HOME_STOPS = Object.freeze([
  { name: "Wallisellen, Furtbach", walkMin: 2 },
  { name: "Wallisellen, Ifang", walkMin: 6 },
  // Glatt has two stops: tram (T12) preferred, bus stop only where its
  // vehicle isn't covered by another connection (secondary).
  { name: "Wallisellen, Glatt (Tram)", walkMin: 13 },
  { name: "Wallisellen, Glatt (Bus)", walkMin: 14, secondary: true },
  { name: "Dietlikon", walkMin: 15 },
  { name: "Wallisellen", walkMin: 15 },
  // secondary: only kept if its first vehicle (bus 774) isn't already in
  // another connection, see dropCoveredSecondary().
  { name: "Wallisellen, Säntisstrasse", walkMin: 8, secondary: true },
]);

// Departure/arrival board per custom stop, see boardTimes(): the planner
// hides a bus when a walk reaches the same train, so we ask again at each
// bus/tram time within the window. Trains need no re-ask (same journeys).
export const BOARD_LIMIT = 40;
export const BOARD_MODES = Object.freeze(["bus", "tram"]);
export const BOARD_MAX_REQUERIES = 6;
export const REQUERY_LIMIT = 3;
// Board window around the base results' times at the custom end.
export const BOARD_SLACK_MIN = 20;
// Results always cover at least this window after (Ab) / before (An) the
// asked time; stop queries page on until they do.
export const MIN_WINDOW_MIN = 30;
// Ab: also connections that left up to this long ago (worth running?).
export const RECENT_PAST_MIN = 5;
// "Frühere / Spätere Verbindungen" widen the window by this much.
export const MORE_STEP_MIN = 30;
export const MAX_PAGES = 4;
export const ALT_BEFORE_MIN = 20; // alternatives at a transfer: earlier ones from arrival − this
export const ALT_LIMIT = 6;
export const ALT_EARLIER = 3; // shown before my arrival at the transfer
export const ALT_LATER = 3; // shown after the planned departure

// Place: where a journey starts or ends. A station is one stop with no walk.
// A custom place is several stops, each with its own walk.
//   Zuhause ──2'──► Furtbach          station("Bern") ──0'──► Bern
//           ──6'──► Ifang
//           ──15'─► Wallisellen
// Rules that apply at a custom end: the walk there is ours (an API walk
// there means another stop was reached → drop), same vehicle boarded at
// two of its stops is pruned to the best one, secondary stops are dropped
// when covered, and its board is re-asked (see boardTimes).
// `home`: the default "Von". Seeded into storage on first run.
export const ZUHAUSE = Object.freeze({ name: "Zuhause", custom: true, home: true, stops: HOME_STOPS });
export const station = (name) => ({ name, custom: false, stops: [{ name, walkMin: 0 }] });
export const asPlace = (p) => (typeof p === "string" ? station(p) : p);
export const Side = Object.freeze({ FROM: "from", TO: "to" });

// Direction of the form; maps onto (from place, to place), see plan().
// OTHER: plain A → B search, no custom end.
export const Direction = Object.freeze({ TO_HOME: "toHome", FROM_HOME: "fromHome", OTHER: "other" });
export const TimeRef = Object.freeze({ DEPART: "depart", ARRIVE: "arrive" });
export const BoardKind = Object.freeze({ DEPART: "depart", ARRIVE: "arrive" });
export const LegKind = Object.freeze({ RIDE: "ride", WALK: "walk", CHANGE: "change" });
export const TRANSFER_WALK_MAX_MIN = 5;
export const WalkMode = Object.freeze({ SHOW: "show", HIDE: "hide" });
export const CapKind = Object.freeze({ DURATION: "duration", CHANGES: "changes" });

export const API_BASE = "https://transport.opendata.ch/v1";
export const CONNECTIONS_PER_STOP = 6;
export const MAX_RESULTS = 15;
export const STOP_ABBR_MAX = 6;
export const MS_PER_MIN = 60_000;
export const MS_PER_SEC = 1_000;
export const MS_PER_DAY = 24 * 60 * MS_PER_MIN;

export const MIN_QUERY_CHARS = 2;
export const MAX_SUGGESTIONS = 6;
export const UMLAUT_VARIANTS = 4;
export const MAX_RECENT = 5;
export const DEBOUNCE_MS = 250;
export const STORAGE_KEY = "homeapprox.stations";
export const PLACES_KEY = "homeapprox.places";
export const PLACE_ICON = "⌂";
export const EXPORT_VERSION = 1;
export const SHARE_PARAM = "places";
export const EXPORT_FILE = "homeapprox-orte.json";

// Saved connections (see saved.js).
export const SAVED_KEY = "homeapprox.saved";
export const SAVED_KEEP_DAYS = 7; // a past one-off stays (greyed) this long
export const SAVED_LIVE_DAYS = 7; // only occurrences this close are re-asked live
export const SAVED_QUERY_LIMIT = 4;

// Lines at stops (see stop-lines.js).
export const STOP_LINES_KEY = "homeapprox.stoplines";
export const STOP_BOARD_LIMIT = 30; // departures asked on tap; ~6 KB each at hubs
export const STOP_LINES_MAX_DAYS = 60; // and always forgotten at the timetable change
