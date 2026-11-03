'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Game, config } = require('../src/game');
function setup(kind = 0, extra = {}) {
  let time = 0;
  const game = new Game({ now: () => time, random: () => kind, ...extra });
  return { game, advance(ms) { time += ms; } };
}
test('random scheduling respects interval and focus', () => {
  const { game, advance } = setup(0.5);
  advance(82499); assert.equal(game.isDue(), false);
  advance(1); assert.equal(game.isDue(), true);
  game.setFocus(false); advance(200000);
  assert.equal(game.isDue(), false); assert.equal(game.begin(), null);
  game.setFocus(true); assert.equal(game.isDue(), false);
});
test('single key awards points and persistent record survives failure', () => {
  const { game } = setup();
  const e = game.begin(); game.ready(e.id);
  assert.deepEqual(game.input(e.id, e.keys[0]), { success: true, points: 20 });
  const next = game.begin(); game.ready(next.id);
  game.input(next.id, 'KeyZ');
  assert.deepEqual(game.stats, { score: 0, best: 20, successes: 1, failures: 1, awayMs: 0 });
});
test('sequence requires all four keys in order', () => {
  const { game } = setup(0.5);
  const e = game.begin(); game.ready(e.id);
  for (let i = 0; i < 3; i++) assert.deepEqual(game.input(e.id, e.keys[i]), { progress: i + 1 });
  assert.equal(game.stats.score, 0);
  assert.equal(game.input(e.id, e.keys[3]).success, true);
  assert.equal(game.stats.score, 35);
});
test('timing validates host clock, including repeated cycles', () => {
  const { game, advance } = setup(0.9);
  let e = game.begin(); game.ready(e.id);
  assert.equal(game.input(e.id, 'Space').success, false);
  e = game.begin(); game.ready(e.id);
  advance(e.period * (1 + e.targetStart + e.targetWidth / 2));
  assert.equal(game.input(e.id, 'Space').success, true);
});
test('deadline is authoritative even before next timer tick', () => {
  const { game, advance } = setup();
  const e = game.begin(); game.ready(e.id); advance(e.duration);
  assert.equal(game.input(e.id, e.keys[0]).success, false);
  assert.equal(game.stats.failures, 1);
});
test('loading does not consume reaction budget; timeout is applied once', () => {
  const { game, advance } = setup();
  const e = game.begin(); advance(50000);
  assert.equal(game.tick(), null); assert.equal(game.input(e.id, e.keys[0]), null);
  assert.equal(game.ready(e.id), true); assert.equal(game.ready(e.id), false);
  advance(5000); assert.equal(game.tick().success, false);
  assert.equal(game.tick(), null); assert.equal(game.stats.failures, 1);
});
test('focus loss cancels without penalty and counts only away time', () => {
  const { game, advance } = setup(0, { saved: { score: 42 } });
  const e = game.begin(); game.ready(e.id);
  advance(2000); game.setFocus(false);
  advance(12500); game.tick(); advance(2500); game.setFocus(true);
  assert.equal(game.stats.awayMs, 15000); assert.equal(game.stats.score, 42);
  assert.equal(game.stats.failures, 0); assert.equal(game.active, null);
  assert.equal(game.input(e.id, e.keys[0]), null);
  advance(4000); game.tick(); assert.equal(game.stats.awayMs, 15000);
});
test('disabled game still tracks away time; config changes cancel neutrally', () => {
  const { game, advance } = setup();
  game.begin(); game.configure({ enabled: false });
  assert.equal(game.active, null); assert.equal(game.begin(), null);
  game.setFocus(false); advance(7000); game.tick();
  assert.equal(game.stats.awayMs, 7000);
});
test('stale, repeated and premature messages cannot change score', () => {
  const { game } = setup();
  const e = game.begin();
  assert.equal(game.input(e.id, e.keys[0]), null);
  assert.equal(game.ready(999), false); game.ready(e.id);
  assert.equal(game.input(999, e.keys[0]), null);
  game.input(e.id, e.keys[0]); const score = game.stats.score;
  assert.equal(game.input(e.id, e.keys[0]), null); assert.equal(game.stats.score, score);
});
test('configuration bounds, corrupted saves and reset', () => {
  assert.deepEqual(config({ minIntervalSeconds: 50, maxIntervalSeconds: 10, reactionSeconds: -1 }), {
    enabled: true, minIntervalSeconds: 50, maxIntervalSeconds: 50, reactionSeconds: 2
  });
  const { game, advance } = setup(0, { saved: { score: -2, best: 'bad', awayMs: Infinity }, focused: false });
  advance(1000); game.reset(); advance(200); game.tick();
  assert.deepEqual(game.stats, { score: 0, best: 0, successes: 0, failures: 0, awayMs: 200 });
});
test('Escape fails an active event, stopping preserves score', () => {
  const { game } = setup(0, { saved: { score: 99 } });
  game.begin(); game.cancel(); assert.equal(game.stats.score, 99);
  const e = game.begin(); game.ready(e.id);
  assert.equal(game.input(e.id, 'Escape').success, false);
});
