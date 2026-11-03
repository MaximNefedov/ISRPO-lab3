'use strict';

const KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'];
const DEFAULTS = { enabled: true, minIntervalSeconds: 45, maxIntervalSeconds: 120, reactionSeconds: 5 };
function config(value = {}) {
  const bounded = (key, min, max) => Number.isFinite(value[key])
    ? Math.max(min, Math.min(max, value[key])) : DEFAULTS[key];
  const min = bounded('minIntervalSeconds', 5, 3600);
  return {
    enabled: value.enabled !== false,
    minIntervalSeconds: min,
    maxIntervalSeconds: Math.max(min, bounded('maxIntervalSeconds', 5, 3600)),
    reactionSeconds: bounded('reactionSeconds', 2, 30)
  };
}
function cleanStats(saved = {}) {
  if (!saved || typeof saved !== 'object') saved = {};
  const stats = {};
  for (const name of ['score', 'best', 'successes', 'failures', 'awayMs']) {
    stats[name] = Number.isFinite(saved[name]) && saved[name] >= 0 ? Math.floor(saved[name]) : 0;
  }
  stats.best = Math.max(stats.score, stats.best);
  return stats;
}
// No VS Code or browser dependencies: the host owns time and checks every input.
class Game {
  constructor({ now = () => performance.now(), random = Math.random, saved, focused = true, settings } = {}) {
    this.now = now;
    this.random = random;
    this.stats = cleanStats(saved);
    this.focused = focused;
    this.settings = config(settings);
    this.lastTick = now();
    this.active = null;
    this.serial = 0;
    this.schedule();
  }
  schedule() {
    const c = this.settings;
    this.nextAt = this.now() + 1000 * (c.minIntervalSeconds + this.random() * (c.maxIntervalSeconds - c.minIntervalSeconds));
  }
  accountTime() {
    const time = this.now();
    if (!this.focused) this.stats.awayMs += Math.max(0, time - this.lastTick);
    this.lastTick = time;
  }
  setFocus(focused) {
    this.accountTime();
    if (this.focused === focused) return;
    this.focused = focused;
    this.cancel();
  }
  configure(settings) {
    this.accountTime();
    this.settings = config(settings);
    this.cancel();
  }
  cancel() {
    this.active = null;
    this.schedule();
  }
  begin() {
    if (!this.focused || !this.settings.enabled || this.active) return null;
    const kind = ['key', 'sequence', 'timing'][Math.floor(this.random() * 3)];
    const key = () => KEYS[Math.floor(this.random() * KEYS.length)];
    this.active = {
      id: ++this.serial, kind,
      keys: kind === 'sequence' ? [key(), key(), key(), key()] : kind === 'key' ? [key()] : [],
      progress: 0, startedAt: null, duration: this.settings.reactionSeconds * 1000,
      targetStart: 0.38 + this.random() * 0.12, targetWidth: 0.22, period: 1800
    };
    return this.active;
  }
  ready(id) {
    if (this.active?.id !== id || this.active.startedAt !== null || !this.focused) return false;
    this.active.startedAt = this.now();
    return true;
  }
  tick() {
    this.accountTime();
    if (this.active && this.active.startedAt !== null && this.now() - this.active.startedAt >= this.active.duration) {
      return this.finish(false);
    }
    return null;
  }
  isDue() {
    return this.focused && this.settings.enabled && !this.active && this.now() >= this.nextAt;
  }
  input(id, code) {
    const event = this.active;
    if (!event || event.id !== id || event.startedAt === null || !this.focused || !this.settings.enabled) return null;
    if (this.now() - event.startedAt >= event.duration) return this.finish(false);
    if (code === 'Escape') return this.finish(false);
    if (event.kind === 'timing') {
      if (code !== 'Space') return this.finish(false);
      const phase = ((this.now() - event.startedAt) % event.period) / event.period;
      return this.finish(phase >= event.targetStart && phase <= event.targetStart + event.targetWidth);
    }
    if (code !== event.keys[event.progress]) return this.finish(false);
    event.progress++;
    if (event.progress === event.keys.length) return this.finish(true);
    return { progress: event.progress };
  }
  finish(success) {
    if (!this.active) return null;
    const base = { key: 10, sequence: 25, timing: 20 }[this.active.kind];
    const bonus = success ? Math.max(0, Math.ceil(10 * (1 - (this.now() - this.active.startedAt) / this.active.duration))) : 0;
    const points = success ? base + bonus : 0;
    if (success) {
      this.stats.score += points;
      this.stats.successes++;
      this.stats.best = Math.max(this.stats.best, this.stats.score);
    } else {
      this.stats.score = 0;
      this.stats.failures++;
    }
    this.cancel();
    return { success, points };
  }
  reset() {
    this.accountTime();
    this.stats = cleanStats();
    this.cancel();
  }
}
module.exports = { Game, config };
