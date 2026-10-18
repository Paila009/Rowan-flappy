import { MODES, createGame, flap, step, reset } from './engine.mjs';
import { PilotAudio } from './audio.mjs';

const PILOTS = {
  rowan: {
    name: 'Rowan', portrait: './assets/rowan.png', title: 'Flappy<br><span>Rowan.</span>',
    description: 'The sky is the limit.<br>The pipes are the problem.',
    boarding: 'FIRST CLASS HUMAN. ECONOMY WINGS.', airline: 'ROWAN AIRLINES',
    personality: 'ONE VOICE. ONE VERY JUDGY DOG.', defeat: 'dog',
    voices: [{ src: './assets/rowan-audio.mp3' }],
    sky: ['#c2e4d9', '#dcecdc', '#e9edd7'], trail: '#fff9e5',
  },
  specs: {
    name: 'Captain Specs', portrait: './assets/captain-specs.png', title: 'Captain<br><span>Specs.</span>',
    description: 'Clear vision. Blurry flight plan.<br>In-flight cake is not optional.',
    boarding: '20/20 VISION. 0/20 LANDINGS.', airline: 'SPECS AIR · CAKE CLASS',
    personality: 'TWO VOICES. ZERO FROSTING IMMUNITY.', defeat: 'cake',
    voices: [
      { src: './assets/specs-voice-1.ogg', fallback: './assets/specs-voice-1.mp3' },
      { src: './assets/specs-voice-2.ogg', fallback: './assets/specs-voice-2.mp3' },
    ],
    sky: ['#ded4ed', '#efe1e7', '#f1ebd9'], trail: '#f7b2b9',
  },
  jaado: {
    name: 'Jaado from Meesho', portrait: './assets/jaado.png', title: 'Jaado<br><span>from Meesho.</span>',
    description: 'Budget airline. Premium damage.<br>Every landing comes at a cost.',
    boarding: 'LOW COST. HIGH CONSEQUENCES.', airline: 'MEESHO AIR · BUDGET CLASS',
    personality: 'ONE VOICE. THIRTY THOUSAND PROBLEMS.', defeat: 'money',
    voices: [{ src: './assets/jaado-voice.ogg', fallback: './assets/jaado-voice.mp3' }],
    sky: ['#eddeb6', '#f0e7cd', '#e8edd6'], trail: '#b3cb87',
  },
};

const DEFEATS = {
  dog: {
    scene: 'bonk-scene', stamp: 'THE SHIH TZU HAS A WORD',
    title: 'Bad flight.<br><span>Dog fight.</span>', recordTitle: 'New record.<br><span>Still bonked.</span>',
    messages: ['Your flight instructor is deeply disappointed.', 'The Shih Tzu would like to speak to the pilot.', 'Great effort. The dog remains unimpressed.', 'Legendary flight. Mandatory bonk anyway.'],
    announcement: 'A Shih Tzu bonks Rowan.', share: 'got bonked by a Shih Tzu', voice: false,
  },
  cake: {
    scene: 'cake-scene', stamp: 'COMPLIMENTARY IN-FACE MEAL',
    title: 'Crash landing.<br><span>Cake pending.</span>', recordTitle: 'New record.<br><span>Extra frosting.</span>',
    messages: ['That was a piece of cake. To the face.', 'Your in-flight dessert has arrived. Aggressively.', 'Good flight. Terrible day for those glasses.', 'A legendary pilot. A fully frosted legend.'],
    announcement: 'Cake smashes into Captain Specs.', share: 'got a cake smashed in my face', voice: true,
  },
  money: {
    scene: 'money-scene', stamp: 'LANDING FEE: ABSOLUTELY BRUTAL',
    title: 'Flight lost.<br><span>Funds too.</span>', recordTitle: 'New record.<br><span>Same −30K.</span>',
    messages: ['That thumbs-up just got very expensive.', 'Budget flight. Thirty-thousand landing fee.', 'A decent flight. An indecent bill.', 'Legendary score. Legendary financial damage.'],
    announcement: 'A cartoon wallet empties and minus thirty thousand appears.', share: 'lost 30K on the landing', voice: true,
  },
};

const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');
const ctx = canvas.getContext('2d');
const frame = $('game-frame');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const modeDescriptions = {
  chill: 'Wider gaps. Softer landings. Same questionable pilot.',
  classic: 'The original recipe. A little skill, a little luck.',
  chaos: 'Smaller gaps. Faster pipes. No refunds.',
};
const storage = {
  get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, String(value)); } catch { /* Private browsing still gets a full game. */ } },
};
let selectedMode = storage.get('rowan-mode', 'classic');
if (!Object.hasOwn(MODES, selectedMode)) selectedMode = 'classic';
let selectedPilot = storage.get('rowan-pilot', 'rowan');
if (!Object.hasOwn(PILOTS, selectedPilot)) selectedPilot = 'rowan';
let state = createGame(selectedMode);
let paused = false;
let lastTime = 0;
let sceneTime = 0;
let gameOverAt = 0;
let toastTimeout;
let scorePulse = 0;
let shake = 0;
let particles = [];
let helpPausedFlight = false;
let lastFlapTime = -1000;
// Rowan keeps his original record keys so existing players retain their scores.
const recordKey = (pilot, mode) => pilot === 'rowan' ? `rowan-best-${mode}` : `rowan-best-${pilot}-${mode}`;
const bests = Object.fromEntries(Object.keys(PILOTS).map((pilot) => [pilot,
  Object.fromEntries(Object.keys(MODES).map((mode) => {
    const value = Number(storage.get(recordKey(pilot, mode), '0'));
    return [mode, Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0];
  })),
]));
const currentPilot = () => PILOTS[selectedPilot];
const currentBest = () => bests[selectedPilot][selectedMode];

const sound = new PilotAudio({
  muted: storage.get('rowan-muted', 'false') === 'true',
  onMuteChange(muted) { storage.set('rowan-muted', muted); updateSoundButton(); },
});
const portraits = Object.fromEntries(Object.entries(PILOTS).map(([id, pilot]) => {
  const image = new Image();
  image.src = new URL(pilot.portrait, import.meta.url).href;
  image.onerror = () => toast('Pilot photo could not load. Flying incognito.');
  return [id, image];
}));

function updateSoundButton() {
  $('sound-button').setAttribute('aria-pressed', String(sound.muted));
  $('sound-button').setAttribute('aria-label', sound.muted ? 'Unmute sound' : 'Mute sound');
  $('sound-button').innerHTML = `<svg><use href="#i-${sound.muted ? 'muted' : 'sound'}"/></svg>`;
}
function announce(message) { $('announcement').textContent = message; }
function toast(message, duration = 1800) {
  clearTimeout(toastTimeout);
  $('game-toast').textContent = message;
  $('game-toast').classList.add('show');
  toastTimeout = setTimeout(() => $('game-toast').classList.remove('show'), duration);
}
function updateBest() {
  $('personal-best').textContent = String(currentBest()).padStart(2, '0');
  $('hud-best').textContent = currentBest();
  $('record-label').textContent = `${currentPilot().name.toUpperCase()}'S PERSONAL BEST`;
}
function updatePilot() {
  const pilot = currentPilot();
  document.body.dataset.pilot = selectedPilot;
  frame.dataset.defeat = pilot.defeat;
  $('ready-portrait').src = portraits[selectedPilot].src;
  $('ready-portrait').alt = `${pilot.name}, your fearless pilot`;
  $('ready-title').innerHTML = pilot.title;
  $('ready-description').innerHTML = pilot.description;
  $('boarding-label').textContent = pilot.boarding;
  $('airline-name').textContent = pilot.airline;
  $('pilot-personality').textContent = pilot.personality;
  $('voice-preview').setAttribute('aria-label', `Preview ${pilot.name}'s voice`);
  canvas.setAttribute('aria-label', `Fly as ${pilot.name}. Press Space or Up Arrow, click, or tap to flap. Avoid pipes and the ground.`);
  for (const [type, defeat] of Object.entries(DEFEATS)) $(defeat.scene).hidden = pilot.defeat !== type;
  sound.setPilot({ id: selectedPilot, voices: pilot.voices.map((voice) => ({
    src: new URL(voice.src, import.meta.url).href,
    ...(voice.fallback ? { fallback: new URL(voice.fallback, import.meta.url).href } : {}),
  })) });
  updateBest();
}
function updateModes() {
  document.querySelectorAll('.mode-button').forEach((button) => {
    const selected = button.dataset.mode === selectedMode;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.disabled = state.status === 'playing';
  });
  $('mode-description').textContent = modeDescriptions[selectedMode];
  document.querySelectorAll('.pilot-button').forEach((button) => {
    const selected = button.dataset.pilot === selectedPilot;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.disabled = state.status === 'playing';
  });
  $('voice-preview').disabled = state.status === 'playing';
  updateBest();
}
function showScreen(screen) {
  $('ready-overlay').hidden = screen !== 'ready';
  $('result-overlay').hidden = screen !== 'over';
  $('pause-overlay').hidden = screen !== 'paused';
  $('pause-button').hidden = screen !== 'playing';
  $('flight-status').textContent = { ready: 'AWAITING TAKEOFF', playing: 'NOW AIRBORNE', over: 'UNSCHEDULED LANDING', paused: 'ON AN AIR BREAK' }[screen];
  frame.dataset.screen = screen;
  document.body.classList.toggle('is-playing', screen === 'playing');
  updateModes();
}
function beginFlight() {
  sound.unlock(); sound.silence();
  reset(state, selectedMode);
  paused = false; particles = []; shake = 0; scorePulse = 0;
  $('score').textContent = '0';
  $('game-toast').classList.remove('show');
  clearTimeout(toastTimeout);
  flap(state); sound.playFlap();
  lastTime = performance.now();
  lastFlapTime = lastTime;
  showScreen('playing');
  announce(`${currentPilot().name}'s ${MODES[selectedMode].label} flight started. Tap or press Space to flap.`);
  canvas.focus({ preventScroll: true });
}
function flapInput() {
  if ($('help-dialog').open) return;
  if (state.status === 'ready') { beginFlight(); return; }
  if (state.status === 'over') {
    if (performance.now() - gameOverAt > 600) beginFlight();
    return;
  }
  if (paused) return;
  const now = performance.now();
  if (now - lastFlapTime < 65) return;
  lastFlapTime = now;
  if (flap(state)) {
    sound.playFlap();
    if (!reducedMotion) for (let i = 0; i < 3; i++) particles.push({ x: state.bird.x - 20, y: state.bird.y + 9, vx: -35 - Math.random() * 35, vy: 15 + Math.random() * 40, age: 0, life: 0.35, color: currentPilot().trail, size: 2 + Math.random() * 3 });
  }
}
function setPaused(value) {
  if (state.status !== 'playing' || paused === value) return;
  paused = value; lastTime = performance.now();
  if (paused) sound.silence();
  showScreen(paused ? 'paused' : 'playing');
  announce(paused ? 'Flight paused.' : 'Flight resumed.');
  if (!paused) { sound.unlock(); canvas.focus({ preventScroll: true }); }
}
function endFlight() {
  gameOverAt = performance.now();
  sound.silence();
  if (!reducedMotion) shake = 0.22;
  const defeat = DEFEATS[currentPilot().defeat];
  const newBest = state.score > currentBest();
  if (newBest) {
    bests[selectedPilot][selectedMode] = state.score;
    storage.set(recordKey(selectedPilot, selectedMode), state.score);
  }
  $('final-score').textContent = state.score;
  $('final-best').textContent = currentBest();
  $('result-stamp').textContent = newBest ? 'A NEW PERSONAL BEST!' : defeat.stamp;
  $('result-stamp').classList.toggle('is-record', newBest);
  $('result-title').innerHTML = newBest ? defeat.recordTitle : defeat.title;
  $('result-message').textContent = defeat.messages[state.score === 0 ? 0 : state.score < 5 ? 1 : state.score < 15 ? 2 : 3];
  $('copy-button').innerHTML = '<svg><use href="#i-copy"/></svg> Copy my score';
  showScreen('over');
  if (defeat.voice) sound.playDefeat();
  if (newBest) sound.chime(true);
  announce(`Flight over. ${currentPilot().name} cleared ${state.score} ${state.score === 1 ? 'pipe' : 'pipes'}. ${newBest ? 'New personal best! ' : ''}${defeat.announcement} Press Space to fly again.`);
}

// The scene is drawn in a fixed coordinate system, independent of display size.
function fitCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(420 * ratio); canvas.height = Math.round(600 * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
function roundRect(x, y, width, height, radius, fill, stroke, lineWidth = 1.5) {
  if (width <= 0 || height <= 0) return;
  ctx.beginPath(); ctx.roundRect(x, y, width, height, radius);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth = lineWidth; ctx.strokeStyle = stroke; ctx.stroke(); }
}
function cloud(x, y, scale, opacity) {
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.globalAlpha = opacity;
  ctx.fillStyle = '#f8f9e9';
  ctx.beginPath(); ctx.moveTo(-43, 12); ctx.bezierCurveTo(-62, 12, -63, -12, -42, -13); ctx.bezierCurveTo(-41, -37, -12, -40, -3, -21); ctx.bezierCurveTo(10, -39, 39, -28, 35, -8); ctx.bezierCurveTo(57, -11, 61, 14, 41, 15); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, 548);
  const sky = currentPilot().sky;
  gradient.addColorStop(0, sky[0]); gradient.addColorStop(0.65, sky[1]); gradient.addColorStop(1, sky[2]);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 420, 600);
  ctx.fillStyle = '#e9efca'; ctx.beginPath(); ctx.arc(336, 107, 33, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#8da99566'; ctx.lineWidth = 1;
  [[55, 164], [367, 235], [283, 52], [38, 303]].forEach(([x, y]) => { ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3); ctx.stroke(); });
  const drift = reducedMotion ? 0 : (sceneTime * 5) % 560;
  cloud(((91 - drift + 620) % 560) - 70, 112, 0.82, 0.68);
  cloud(((367 - drift * 0.7 + 620) % 560) - 70, 222, 0.6, 0.7);
  cloud(((193 - drift * 0.5 + 620) % 560) - 70, 349, 0.48, 0.5);
  ctx.save(); ctx.globalAlpha = 0.22; ctx.strokeStyle = '#4c7860'; ctx.lineWidth = 1.2;
  ctx.translate(302, 172); ctx.rotate(-0.2); ctx.beginPath(); ctx.moveTo(-15, 3); ctx.lineTo(19, -10); ctx.lineTo(4, 12); ctx.lineTo(0, 1); ctx.closePath(); ctx.moveTo(0, 1); ctx.lineTo(19, -10); ctx.stroke();
  ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(-22, 11); ctx.bezierCurveTo(-70, 42, -25, 70, -77, 71); ctx.stroke(); ctx.restore();
  const distance = state.status === 'ready' ? sceneTime * 8 : state.distance;
  drawSkyline(distance * 0.12, 507, '#bdcdb7', 0.55, 61);
  drawSkyline(distance * 0.25, 535, '#a1b89b', 0.65, 47);
  ctx.fillStyle = '#a6c090';
  for (let i = -1; i < 11; i++) { const x = i * 48 - (distance * 0.38) % 48; ctx.beginPath(); ctx.ellipse(x, 550, 41, 23 + (i % 3) * 6, 0, Math.PI, Math.PI * 2); ctx.fill(); }
}
function drawSkyline(scroll, baseline, color, opacity, height) {
  ctx.save(); ctx.globalAlpha = opacity; ctx.fillStyle = color;
  for (let i = -1; i < 12; i++) {
    const x = i * 47 - scroll % 47;
    const h = height + Math.sin(i * 2.8) * 18;
    roundRect(x, baseline - h, 36, h, [4, 4, 0, 0], color);
    ctx.fillStyle = '#e4ebd055';
    for (let j = 0; j < 2; j++) for (let k = 0; k < 3; k++) ctx.fillRect(x + 8 + j * 14, baseline - h + 10 + k * 15, 5, 7);
    ctx.fillStyle = color;
  }
  ctx.restore();
}
function drawPipes() {
  for (const pipe of state.pipes) {
    const top = pipe.gapY - pipe.gap / 2;
    const bottom = pipe.gapY + pipe.gap / 2;
    const x = pipe.x;
    const width = pipe.width;
    for (const [y, height, capY] of [[-5, top + 5, top - 24], [bottom, 548 - bottom, bottom]]) {
      roundRect(x, y, width, height, 3, '#a4a9cb', '#363e43', 2);
      ctx.fillStyle = '#c3c8e0'; ctx.fillRect(x + 7, y + 2, 10, height - 4);
      ctx.fillStyle = '#7e88b233'; ctx.fillRect(x + width - 12, y + 2, 10, height - 4);
      roundRect(x - 5, capY, width + 10, 24, 5, '#b4bad8', '#363e43', 2);
      ctx.fillStyle = '#d9dcee'; ctx.fillRect(x + 3, capY + 4, width + 1, 3);
      ctx.fillStyle = '#626d91';
      for (const boltX of [x + 4, x + width - 5]) { ctx.beginPath(); ctx.arc(boltX, capY + 16, 1.7, 0, 2 * Math.PI); ctx.fill(); }
    }
  }
}
function drawGround() {
  const scroll = (state.status === 'ready' ? sceneTime * 18 : state.distance) % 28;
  ctx.fillStyle = '#becd91'; ctx.fillRect(0, 548, 420, 52);
  ctx.fillStyle = '#d9e3ad'; ctx.fillRect(0, 549, 420, 10);
  ctx.strokeStyle = '#4e634b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 548); ctx.lineTo(420, 548); ctx.stroke();
  ctx.strokeStyle = '#8ca374'; ctx.lineWidth = 1;
  for (let i = -1; i < 17; i++) { const x = i * 28 - scroll; ctx.beginPath(); ctx.moveTo(x, 550); ctx.lineTo(x + 12, 558); ctx.stroke(); }
  ctx.strokeStyle = '#9db27e'; ctx.beginPath(); ctx.moveTo(0, 560); ctx.lineTo(420, 560); ctx.stroke();
}
function drawBird() {
  if (state.status === 'ready') return;
  const portrait = portraits[selectedPilot];
  const { bird } = state;
  ctx.save(); ctx.translate(bird.x, bird.y); ctx.rotate(bird.rotation);
  const wingAngle = reducedMotion ? 0 : Math.sin(state.elapsed * 26) * 0.3;
  ctx.save(); ctx.translate(-14, 7); ctx.rotate(wingAngle);
  ctx.fillStyle = '#fff9e8'; ctx.strokeStyle = '#333b30'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, 3); ctx.bezierCurveTo(-14, -17, -39, -12, -30, 2); ctx.bezierCurveTo(-39, 9, -18, 21, 0, 3); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-11, 3); ctx.lineTo(-28, -3); ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#233f2422'; ctx.beginPath(); ctx.ellipse(2, 6, 25, 26, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.fillStyle = '#fff7df'; ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, 21.5, 0, Math.PI * 2); ctx.clip();
  if (portrait.complete && portrait.naturalWidth) ctx.drawImage(portrait, 0, 0, portrait.naturalWidth, portrait.naturalHeight, -22, -23, 44, 49);
  else { ctx.fillStyle = '#f2745b'; ctx.fillRect(-23, -23, 46, 46); ctx.font = 'bold 28px Arial'; ctx.fillStyle = '#242822'; ctx.fillText(currentPilot().name[0], -10, 10); }
  ctx.restore(); ctx.strokeStyle = '#28382b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
function drawParticles(dt) {
  for (const particle of particles) {
    if (!paused) { particle.age += dt; particle.x += particle.vx * dt; particle.y += particle.vy * dt; }
    ctx.globalAlpha = Math.max(0, 1 - particle.age / particle.life);
    ctx.fillStyle = particle.color; ctx.beginPath(); ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  particles = particles.filter((particle) => particle.age < particle.life);
}
function onScore(score) {
  $('score').textContent = score;
  sound.chime(); scorePulse = 0.25;
  if (score % 5 === 0) toast({ 5: 'FIVE PIPES. STILL ALIVE.', 10: 'DOUBLE DIGITS. WHO IS THIS GUY?', 15: { rowan: 'ROWAN HAS LEFT THE GROUP CHAT.', specs: 'CAN THE CAKE EVEN CATCH HIM?', jaado: 'KEEP FLYING. PROTECT THE WALLET.' }[selectedPilot], 20: 'CERTIFIED FREQUENT FLYER.' }[score] || `${score} PIPES. ABSOLUTE LEGEND.`);
  if (!reducedMotion) for (let i = 0; i < 10; i++) particles.push({ x: state.bird.x + 14, y: state.bird.y, vx: (Math.random() - 0.4) * 130, vy: (Math.random() - 0.5) * 140, age: 0, life: 0.5, color: ['#fff8df', '#f2745b', '#9bafd0'][i % 3], size: 2 + Math.random() * 2 });
}
function render(now) {
  const dt = Math.max(0, Math.min((now - (lastTime || now)) / 1000, 0.05));
  lastTime = now;
  if (!paused && !document.hidden) {
    if (state.status !== 'over') sceneTime += dt;
    for (const event of step(state, dt)) {
      if (event.type === 'score') onScore(event.score);
      else if (event.type === 'death') endFlight();
    }
  }
  ctx.save();
  if (shake > 0) { shake -= dt; ctx.translate(Math.sin(shake * 130) * shake * 13, Math.cos(shake * 100) * shake * 8); }
  drawBackground();
  if (state.status !== 'ready') drawPipes();
  drawGround(); drawParticles(dt); drawBird();
  ctx.restore();
  if (scorePulse > 0) { scorePulse -= dt; $('score').style.transform = `scale(${1 + Math.max(0, scorePulse) * 0.6})`; }
  requestAnimationFrame(render);
}

$('start-button').addEventListener('click', beginFlight);
$('retry-button').addEventListener('click', beginFlight);
$('resume-button').addEventListener('click', () => setPaused(false));
$('restart-button').addEventListener('click', beginFlight);
$('pause-button').addEventListener('click', () => setPaused(true));
$('sound-button').addEventListener('click', () => {
  sound.unlock(); sound.toggle();
  if (state.status === 'playing' && !paused) canvas.focus({ preventScroll: true });
});
$('voice-preview').addEventListener('click', () => {
  sound.unlock();
  if (sound.muted) { toast('Sound is muted. Use the speaker button to unmute.'); return; }
  sound.playFlap();
});
document.querySelectorAll('.pilot-button').forEach((button) => button.addEventListener('click', () => {
  if (state.status === 'playing') return;
  selectedPilot = button.dataset.pilot;
  storage.set('rowan-pilot', selectedPilot);
  reset(state, selectedMode); particles = []; paused = false;
  $('score').textContent = '0';
  $('game-toast').classList.remove('show'); clearTimeout(toastTimeout);
  updatePilot(); showScreen('ready');
  announce(`${currentPilot().name} selected. ${{ dog: 'The original pilot is back.', cake: 'Cake class is now boarding.', money: 'Budget class is now boarding. Mind the landing fee.' }[currentPilot().defeat]}`);
}));
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault(); canvas.focus({ preventScroll: true }); flapInput();
});
document.querySelectorAll('.mode-button').forEach((button) => button.addEventListener('click', () => {
  if (state.status === 'playing') return;
  selectedMode = button.dataset.mode; storage.set('rowan-mode', selectedMode);
  sound.silence();
  reset(state, selectedMode); $('score').textContent = '0'; particles = [];
  showScreen('ready');
  announce(`${MODES[selectedMode].label} mode selected.`);
}));
document.addEventListener('keydown', (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if ($('help-dialog').open) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName))) return;
  if (event.code === 'Space' || event.code === 'ArrowUp') {
    if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) return;
    event.preventDefault();
    if (paused) setPaused(false); else flapInput();
  } else if (event.code === 'KeyP' || event.code === 'Escape') {
    event.preventDefault(); setPaused(!paused);
  } else if (event.code === 'KeyM') sound.toggle();
  else if (event.code === 'KeyR' && state.status !== 'ready') { event.preventDefault(); beginFlight(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { setPaused(true); sound.silence(); } lastTime = performance.now(); });
window.addEventListener('blur', () => { if (state.status === 'playing') setPaused(true); });
window.addEventListener('resize', fitCanvas);
function closeHelp() { $('help-dialog').close(); }
$('help-button').addEventListener('click', () => {
  helpPausedFlight = state.status === 'playing' && !paused;
  setPaused(true); $('help-dialog').showModal(); document.body.classList.add('modal-open');
});
$('close-help').addEventListener('click', closeHelp);
$('got-it-button').addEventListener('click', closeHelp);
$('help-dialog').addEventListener('click', (event) => {
  if (event.target !== $('help-dialog')) return;
  const bounds = $('help-dialog').getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeHelp();
});
$('help-dialog').addEventListener('close', () => {
  document.body.classList.remove('modal-open');
  if (helpPausedFlight) setPaused(false);
  helpPausedFlight = false;
});
$('copy-button').addEventListener('click', async () => {
  const consequence = DEFEATS[currentPilot().defeat].share;
  const scoreText = `I cleared ${state.score} ${state.score === 1 ? 'pipe' : 'pipes'} as ${currentPilot().name} on Flappy Rowan (${MODES[selectedMode].label}) and ${consequence}. Your turn! ${location.href.split('?')[0].split('#')[0]}`;
  try {
    await navigator.clipboard.writeText(scoreText);
    $('copy-button').innerHTML = '<svg><use href="#i-copy"/></svg> Score copied!';
    announce('Score copied to clipboard.');
  } catch {
    $('copy-button').textContent = `${state.score} pipes · ${MODES[selectedMode].label}. Challenge a friend!`;
    announce('Clipboard unavailable. Your score is displayed on the button.');
  }
});
if (!document.fullscreenEnabled) $('fullscreen-button').hidden = true;
$('fullscreen-button').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen(); else await frame.requestFullscreen();
  } catch { toast('Fullscreen is unavailable in this browser.'); }
  if (state.status === 'playing' && !paused) canvas.focus({ preventScroll: true });
});
document.addEventListener('fullscreenchange', () => {
  $('fullscreen-button').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
  fitCanvas();
});
updateSoundButton(); updatePilot(); showScreen('ready'); fitCanvas(); requestAnimationFrame(render);
