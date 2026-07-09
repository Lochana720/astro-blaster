/*
 * Astro Blaster — a retro space shooter
 * Vanilla JavaScript + HTML5 Canvas. No libraries, no build step.
 */
'use strict';

(() => {
  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  const W = 480;
  const H = 720;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  canvas.width = W;
  canvas.height = H;

  const $ = (sel) => document.querySelector(sel);
  const screens = {
    start: $('#screen-start'),
    pause: $('#screen-pause'),
    over: $('#screen-over'),
  };
  const el = {
    bestStart: $('#best-start'),
    finalScore: $('#final-score'),
    finalLevel: $('#final-level'),
    finalBest: $('#final-best'),
    newBest: $('#new-best'),
    mute: $('#btn-mute'),
    pause: $('#btn-pause'),
  };

  const FONT = '"Press Start 2P", monospace';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hit = (a, b) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const r = a.r + b.r;
    return dx * dx + dy * dy < r * r;
  };

  const storage = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* storage unavailable — ignore */
      }
    },
  };

  const BEST_KEY = 'astro-blaster-best';
  const MUTE_KEY = 'astro-blaster-muted';
  let best = Number(storage.get(BEST_KEY, 0)) || 0;
  el.bestStart.textContent = best;
})();
