/** Pure game simulation. All coordinates are logical pixels and dt is seconds. */
export const MODES = Object.freeze({
  chill: Object.freeze({ label: 'Chill', gap: 192, speed: 154, gravity: 1010, impulse: -340, spawnEvery: 1.75 }),
  classic: Object.freeze({ label: 'Classic', gap: 170, speed: 180, gravity: 1160, impulse: -365, spawnEvery: 1.58 }),
  chaos: Object.freeze({ label: 'Chaos', gap: 150, speed: 208, gravity: 1240, impulse: -380, spawnEvery: 1.45 }),
});

const WIDTH = 420;
const HEIGHT = 600;
const GROUND_Y = 548;
const PIPE_WIDTH = 70;
const PIPE_START_X = 520;
const HIT_RADIUS = 18;
const MAX_STEP = 0.1;
const SUBSTEP = 1 / 120;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function randomUnit(state) {
  const value = Number(state._random());
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0.5;
}

function difficulty(state) {
  const config = MODES[state.mode];
  return {
    speed: config.speed * (1 + Math.min(state.score * 0.012, 0.2)),
    gap: config.gap - Math.min(state.score * 0.6, 12),
  };
}

function addPipe(state) {
  const { gap } = difficulty(state);
  const minY = gap / 2 + 62;
  const maxY = state.groundY - gap / 2 - 62;
  const target = minY + randomUnit(state) * (maxY - minY);
  // Prevent alternating random extremes from creating impossible vertical jumps.
  const gapY = clamp(target, Math.max(minY, state._lastGapY - 82), Math.min(maxY, state._lastGapY + 82));
  state._lastGapY = gapY;
  state.pipes.push({ x: PIPE_START_X, gapY, gap, width: PIPE_WIDTH, scored: false });
}

export function createGame(mode = 'classic', random = Math.random) {
  const state = {
    mode: Object.hasOwn(MODES, mode) ? mode : 'classic',
    status: 'ready',
    bird: { x: 112, y: 260, vy: 0, rotation: 0, radius: 23 },
    pipes: [],
    score: 0,
    elapsed: 0,
    groundY: GROUND_Y,
    worldWidth: WIDTH,
    worldHeight: HEIGHT,
    distance: 0,
    deathReason: null,
    _random: typeof random === 'function' ? random : Math.random,
    _spawnClock: 0,
    _lastGapY: 260,
  };
  addPipe(state);
  return state;
}

/** Reset in place, preserving the supplied random generator for reproducible runs. */
export function reset(state, mode = state.mode) {
  return Object.assign(state, createGame(mode, state._random));
}

/** Returns whether the flap was accepted. An ended run must be reset first. */
export function flap(state) {
  if (state.status === 'over') return false;
  state.status = 'playing';
  state.bird.vy = MODES[state.mode].impulse;
  state.bird.rotation = -0.52;
  return true;
}

function circleTouchesRect(bird, x, y, width, height) {
  const nearX = clamp(bird.x, x, x + width);
  const nearY = clamp(bird.y, y, y + height);
  return (bird.x - nearX) ** 2 + (bird.y - nearY) ** 2 <= HIT_RADIUS ** 2;
}

function collisionReason(state) {
  const { bird } = state;
  if (bird.y - bird.radius <= 0) return 'ceiling';
  if (bird.y + bird.radius >= state.groundY) return 'ground';
  for (const pipe of state.pipes) {
    if (pipe.x > bird.x + HIT_RADIUS || pipe.x + pipe.width < bird.x - HIT_RADIUS) continue;
    const top = pipe.gapY - pipe.gap / 2;
    const bottom = pipe.gapY + pipe.gap / 2;
    if (circleTouchesRect(bird, pipe.x, 0, pipe.width, top)
      || circleTouchesRect(bird, pipe.x, bottom, pipe.width, state.groundY - bottom)) return 'pipe';
  }
  return null;
}

/**
 * Advance the active run and return only events produced by this call.
 * A 100ms cap prevents a background tab or stalled frame from teleporting the bird.
 */
export function step(state, dt) {
  const events = [];
  if (state.status !== 'playing' || !Number.isFinite(dt) || dt <= 0) return events;
  const total = Math.min(dt, MAX_STEP);
  const slices = Math.ceil(total / SUBSTEP);
  const h = total / slices;
  const config = MODES[state.mode];

  for (let slice = 0; slice < slices && state.status === 'playing'; slice += 1) {
    const { bird } = state;
    const { speed } = difficulty(state);
    bird.y += bird.vy * h + 0.5 * config.gravity * h * h;
    bird.vy += config.gravity * h;
    const targetRotation = clamp(bird.vy / 520, -0.62, 1.32);
    bird.rotation += (targetRotation - bird.rotation) * (1 - Math.exp(-10 * h));
    state.elapsed += h;
    state.distance += speed * h;
    state._spawnClock += h;
    for (const pipe of state.pipes) pipe.x -= speed * h;

    while (state._spawnClock >= config.spawnEvery) {
      state._spawnClock -= config.spawnEvery;
      addPipe(state);
    }

    const reason = collisionReason(state);
    if (reason) {
      state.status = 'over';
      state.deathReason = reason;
      bird.y = clamp(bird.y, bird.radius, state.groundY - bird.radius);
      events.push({ type: 'death', reason });
      break;
    }

    for (const pipe of state.pipes) {
      if (!pipe.scored && pipe.x + pipe.width < bird.x) {
        pipe.scored = true;
        state.score += 1;
        events.push({ type: 'score', score: state.score });
      }
    }
    state.pipes = state.pipes.filter((pipe) => pipe.x + pipe.width > -20);
  }
  return events;
}
