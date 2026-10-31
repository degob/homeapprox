// Timeline zoom: pinch / Ctrl+wheel widens all bars, swipe scrolls

import { $ } from "./dom.js";
import { fitLabels } from "./journey-view.js";

const ZOOM_MIN = 1;
const ZOOM_MAX = 12;
// Start zoom: a journey of average duration fills this share of the card width
// (longer ones run past the edge; swipe or zoom out).
const BAR_FILL = 0.8;
const WHEEL_ZOOM_STEP = 1.1;
const FOLLOW_MARGIN_PX = 8;

export const Timeline = (() => {
  let zoom = ZOOM_MIN;
  let scrollFrac = 0; // left edge as share of the bar width, kept across re-renders
  let syncing = false;
  let fitQueued = false;

  const root = () => $("results");
  const tracks = () => [...root().querySelectorAll(".track")];
  const clamp = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

  function scrollAll(left, except) {
    syncing = true;
    tracks().forEach((t) => {
      if (t !== except) {
        t.scrollLeft = left;
      }
    });
    requestAnimationFrame(() => {
      syncing = false;
    });
  }

  function queueFit() {
    if (fitQueued) {
      return;
    }
    fitQueued = true;
    requestAnimationFrame(() => {
      fitQueued = false;
      fitLabels(root());
    });
  }

  // Zooms so the time under screen x `clientX` stays under it.
  let userZoomed = false;

  // Zoom keeps a focus point (share of the bar width) at the same x on the
  // track, so the content there doesn't drift away.
  function zoomAt(newZoom, track, focus) {
    userZoomed = true;
    zoom = clamp(newZoom);
    root().style.setProperty("--zoom", String(zoom));
    track.scrollLeft = focus.frac * track.scrollWidth - focus.x;
    scrollAll(track.scrollLeft, track);
    scrollFrac = track.scrollLeft / track.scrollWidth;
    queueFit();
  }

  // Focus = middle of the journey of the card under the fingers/mouse, kept
  // where it is on screen; if that middle is off screen, it's brought to the
  // centre. No card (between cards): the point under the fingers.
  //   before:  |   [===J===]   |      after zoom:  | [=====J=====] |
  //                    ^ mid stays here                   ^
  function focusFor(track, target, clientX) {
    const box = track.getBoundingClientRect();
    const li = target.closest?.("#results > li");
    if (!li) {
      const x = clientX - box.left;
      return { frac: (track.scrollLeft + x) / track.scrollWidth, x };
    }
    const frac = (Number(li.dataset.startFrac) + Number(li.dataset.endFrac)) / 2;
    let x = frac * track.scrollWidth - track.scrollLeft;
    if (x < 0 || x > box.width) {
      x = box.width / 2;
    }
    return { frac, x };
  }

  // After a render: user zoom kept; otherwise zoom so an average journey
  // fills BAR_FILL of the width, scrolled to the first connections on screen.
  // All bars still share one time axis, so they stay comparable.
  function fit(list, span, average) {
    if (userZoomed) {
      restore(list);
      return;
    }
    zoom = clamp((BAR_FILL * span) / (average || span || 1));
    list.style.setProperty("--zoom", String(zoom));
    followNow();
  }

  // New search: back to automatic zoom.
  function reset() {
    userZoomed = false;
    scrollFrac = 0;
  }

  // After a re-render: same zoom and position as before.
  function restore(list) {
    list.style.setProperty("--zoom", String(zoom));
    const first = list.querySelector(".track");
    if (first) {
      scrollAll(scrollFrac * first.scrollWidth);
    }
  }

  function onScroll(e) {
    const t = e.target;
    if (!(t instanceof Element) || !t.classList.contains("track") || syncing) {
      return;
    }
    scrollFrac = t.scrollLeft / t.scrollWidth;
    scrollAll(t.scrollLeft, t);
  }

  let pinch = null;
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  // Track used as geometry reference for a gesture anywhere in the list:
  // the bar of the card under the finger, else the first one.
  const trackAt = (target) =>
    target.closest?.(".track") || target.closest?.("#results > li")?.querySelector(".track") || root().querySelector(".track");

  // One-finger swipe outside a bar: horizontal → scroll all bars; vertical →
  // page scrolls natively (#results has touch-action: pan-y). On a bar the
  // native horizontal scroll does it.
  let swipe = null;
  const SWIPE_LOCK_PX = 8;

  function onTouchStart(e) {
    const track = trackAt(e.target);
    if (!track) {
      return;
    }
    if (e.touches.length === 2) {
      swipe = null;
      const mid = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      pinch = { d: dist(e.touches[0], e.touches[1]), zoom, track, focus: focusFor(track, e.target, mid) };
    } else if (e.touches.length === 1 && !e.target.closest(".track")) {
      const t = e.touches[0];
      swipe = { x: t.clientX, y: t.clientY, left: track.scrollLeft, lock: null };
    }
  }

  function onTouchMove(e) {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = e.touches;
      zoomAt(pinch.zoom * (dist(a, b) / pinch.d), pinch.track, pinch.focus);
      return;
    }
    if (!swipe || e.touches.length !== 1) {
      return;
    }
    const dx = e.touches[0].clientX - swipe.x;
    const dy = e.touches[0].clientY - swipe.y;
    if (!swipe.lock && Math.max(Math.abs(dx), Math.abs(dy)) > SWIPE_LOCK_PX) {
      swipe.lock = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (swipe.lock === "x") {
      e.preventDefault();
      scrollAll(swipe.left - dx);
      const first = root().querySelector(".track");
      scrollFrac = first ? first.scrollLeft / first.scrollWidth : 0;
    }
  }

  function onTouchEnd(e) {
    if (e.touches.length < 2) {
      pinch = null;
    }
    if (!e.touches.length) {
      swipe = null;
    }
  }

  // Desktop, anywhere in the list: Ctrl+wheel (also trackpad pinch) zooms;
  // Shift+wheel or sideways wheel scrolls the bars (on a bar natively).
  function onWheel(e) {
    const track = trackAt(e.target);
    if (!track) {
      return;
    }
    if (e.ctrlKey) {
      e.preventDefault();
      zoomAt(zoom * (e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP), track, focusFor(track, e.target, e.clientX));
      return;
    }
    const sideways = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
    if (sideways && !e.target.closest(".track")) {
      e.preventDefault();
      scrollAll(track.scrollLeft + (e.deltaX || e.deltaY));
      scrollFrac = track.scrollLeft / track.scrollWidth;
    }
  }

  // Vertical scroll: move the timeline so the topmost card's start sits at
  // the left edge (see followNow).
  let followQueued = false;
  function followViewport() {
    if (zoom <= ZOOM_MIN || pinch || swipe?.lock === "x" || followQueued) {
      return;
    }
    followQueued = true;
    requestAnimationFrame(() => {
      followQueued = false;
      followNow();
    });
  }

  // Anchor = topmost card still at least half on screen; its start goes to
  // the left edge, cards below run on to the right. (Earlier: the earliest of
  // all cards on screen, which barely moved once several were visible.)
  function followNow() {
    const first = root().querySelector(".track");
    const cards = [...root().children];
    if (!first || !cards.length) {
      return;
    }
    const anchor = cards.find((li) => {
      const r = li.getBoundingClientRect();
      return r.top + r.height / 2 >= 0;
    }) || cards[cards.length - 1];
    const frac = Number(anchor.dataset.startFrac);
    scrollAll(Math.max(0, frac * first.scrollWidth - FOLLOW_MARGIN_PX));
    scrollFrac = first.scrollLeft / first.scrollWidth;
  }

  function init() {
    const r = root();
    window.addEventListener("scroll", followViewport, { passive: true });
    r.addEventListener("scroll", onScroll, true); // scroll doesn't bubble
    r.addEventListener("touchstart", onTouchStart, { passive: true });
    r.addEventListener("touchmove", onTouchMove, { passive: false });
    r.addEventListener("touchend", onTouchEnd);
    r.addEventListener("touchcancel", onTouchEnd);
    r.addEventListener("wheel", onWheel, { passive: false });
    // iOS Safari: block page zoom while pinching the timeline.
    r.addEventListener("gesturestart", (e) => e.preventDefault());
  }

  return { init, restore, fit, reset };
})();
