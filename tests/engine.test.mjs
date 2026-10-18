import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, createGame, flap, reset, step } from '../engine.mjs';

const close = (actual, expected, tolerance = 1e-8) => {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
};

test('ready, start, flap, death, and reset have explicit transitions', () => {
  const game = createGame('chill', () => 0.5);
  assert.equal(game.status, 'ready');
  assert.equal(game.pipes.length, 1);
  assert.ok(game.pipes[0].x >= 500);
  assert.deepEqual(step(game, 0.1), []);
  assert.equal(game.elapsed, 0);
  assert.equal(flap(game), true);
  assert.equal(game.status, 'playing');
  assert.equal(game.bird.vy, MODES.chill.impulse);
  step(game, 0.1);
  flap(game);
  assert.equal(game.bird.vy, MODES.chill.impulse);
  game.bird.y = game.groundY;
  step(game, 0.01);
  assert.equal(game.status, 'over');
  assert.equal(flap(game), false);
  const sameObject = reset(game, 'chaos');
  assert.equal(sameObject, game);
  assert.equal(game.mode, 'chaos');
  assert.equal(game.status, 'ready');
  assert.equal(game.score, 0);
  assert.equal(game.distance, 0);
  assert.equal(game.deathReason, null);
  assert.equal(game.bird.y, 260);
  assert.equal(createGame('unknown').mode, 'classic');
});

test('physics agrees across frame rates and a stalled frame is safely capped', () => {
  const largeFrames = createGame('classic', () => 0.5);
  const smallFrames = createGame('classic', () => 0.5);
  flap(largeFrames);
  flap(smallFrames);
  for (let i = 0; i < 5; i += 1) step(largeFrames, 0.1);
  for (let i = 0; i < 50; i += 1) step(smallFrames, 0.01);
  close(largeFrames.bird.y, smallFrames.bird.y);
  close(largeFrames.bird.vy, smallFrames.bird.vy);
  close(largeFrames.distance, smallFrames.distance);
  close(largeFrames.pipes[0].x, smallFrames.pipes[0].x);
  const stalled = createGame();
  flap(stalled);
  step(stalled, 15);
  close(stalled.elapsed, 0.1);
  const before = stalled.bird.y;
  for (const dt of [NaN, Infinity, 0, -1]) assert.deepEqual(step(stalled, dt), []);
  assert.equal(stalled.bird.y, before);
  assert.ok(stalled.bird.rotation >= -0.62 && stalled.bird.rotation <= 1.32);
});

test('a passed pipe scores exactly once and events do not repeat', () => {
  const game = createGame('classic', () => 0.5);
  flap(game);
  game.bird.vy = 0;
  game.pipes = [{ x: 40, width: 70, gapY: 260, gap: 170, scored: false }];
  assert.deepEqual(step(game, 0.01), [{ type: 'score', score: 1 }]);
  assert.equal(game.score, 1);
  assert.equal(game.pipes[0].scored, true);
  assert.deepEqual(step(game, 0.01), []);
  assert.equal(game.score, 1);
});

for (const [reason, y, velocity] of [['ceiling', 24, -300], ['ground', 524, 300]]) {
  test(`${reason} collision emits a single terminal event`, () => {
    const game = createGame();
    flap(game);
    game.bird.y = y;
    game.bird.vy = velocity;
    assert.deepEqual(step(game, 0.02), [{ type: 'death', reason }]);
    assert.equal(game.status, 'over');
    assert.equal(game.deathReason, reason);
    const stoppedAt = game.elapsed;
    assert.deepEqual(step(game, 0.1), []);
    assert.equal(game.elapsed, stoppedAt);
  });
}

test('pipe collisions use a forgiving circle and gaps stay playable', () => {
  const hit = createGame();
  flap(hit);
  hit.bird.vy = 0;
  hit.bird.y = 150;
  hit.pipes = [{ x: 100, width: 70, gapY: 260, gap: 170, scored: false }];
  assert.deepEqual(step(hit, 0.001), [{ type: 'death', reason: 'pipe' }]);

  const nearEdge = createGame();
  flap(nearEdge);
  nearEdge.bird.vy = 0;
  nearEdge.bird.y = 195; // 20px below the top pipe; the visible portrait is 23px.
  nearEdge.pipes = [{ x: 100, width: 70, gapY: 260, gap: 170, scored: false }];
  assert.deepEqual(step(nearEdge, 0.001), []);
  assert.equal(nearEdge.status, 'playing');
});

test('spawn randomness is bounded, adjacent gaps are reachable, and difficulty is capped', () => {
  for (const mode of Object.keys(MODES)) {
    let sample = 0;
    const values = [-4, 4, NaN, 0, 1];
    const game = createGame(mode, () => values[sample++ % values.length]);
    let previousY = 260;
    const recorded = [game.pipes[0]];
    flap(game);
    for (let i = 0; i < 100; i += 1) {
      // Keep flight clear while exercising real spawning and scrolling over ten seconds.
      game.bird.y = 260;
      game.bird.vy = 0;
      for (const pipe of game.pipes) pipe.x = -200;
      game.score = 1000;
      step(game, 0.1);
      for (const pipe of game.pipes) if (!recorded.includes(pipe)) recorded.push(pipe);
    }
    assert.ok(recorded.length >= 5);
    assert.equal(game.status, 'playing');
    for (const pipe of recorded) {
      assert.ok(Number.isFinite(pipe.gapY));
      assert.ok(pipe.gapY - pipe.gap / 2 >= 62);
      assert.ok(pipe.gapY + pipe.gap / 2 <= game.groundY - 62);
      assert.ok(Math.abs(pipe.gapY - previousY) <= 82);
      assert.ok(pipe.gap >= MODES[mode].gap - 12);
      previousY = pipe.gapY;
    }
    close(game.distance, MODES[mode].speed * 1.2 * 10, 1e-6);
  }
});
