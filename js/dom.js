// UI

import { MS_PER_MIN } from "./config.js";

export const $ = (id) => document.getElementById(id);
export const hhmm = (d) => d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", hour12: false });
export const minutes = (a, b) => Math.round((b - a) / MS_PER_MIN);

export const localDateValue = (d) => new Date(d.getTime() - d.getTimezoneOffset() * MS_PER_MIN).toISOString().slice(0, 10);
