// Stations: recent + favorites, persisted in localStorage

import { MAX_RECENT, STORAGE_KEY } from "./config.js";

export const Stations = (() => {
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { recent: [], favorites: [] };
    } catch {
      return { recent: [], favorites: [] };
    }
  };
  const save = (s) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      // Storage unavailable (private mode): keep working without memory.
    }
  };

  // Most recently used first, capped; favorites are never dropped from recent.
  function touch(name) {
    const s = load();
    s.recent = [name, ...s.recent.filter((n) => n !== name)].slice(0, MAX_RECENT);
    save(s);
  }

  function toggleFavorite(name) {
    const s = load();
    const isFav = s.favorites.includes(name);
    s.favorites = isFav ? s.favorites.filter((n) => n !== name) : [...s.favorites, name];
    save(s);
    return !isFav;
  }

  const isFavorite = (name) => load().favorites.includes(name);
  const favorites = () => load().favorites;
  const recent = () => load().recent.filter((n) => !isFavorite(n));

  return { touch, toggleFavorite, isFavorite, favorites, recent };
})();
