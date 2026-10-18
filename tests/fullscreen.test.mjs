import test from 'node:test';
import assert from 'node:assert/strict';
import { fullscreenLayout, setupFullscreen } from '../fullscreen.mjs';

const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function environment() {
  function target() {
    const handlers = new Map();
    return {
      addEventListener(type, handler) { const values = handlers.get(type) || []; values.push(handler); handlers.set(type, values); },
      removeEventListener(type, handler) { handlers.set(type, (handlers.get(type) || []).filter((value) => value !== handler)); },
      dispatch(type, event = {}) { for (const handler of handlers.get(type) || []) handler(event); },
    };
  }
  const doc = target();
  const win = Object.assign(target(), {
    scrollX: 3, scrollY: 480, innerWidth: 844, innerHeight: 390,
    visualViewport: Object.assign(target(), { width: 844, height: 390, offsetLeft: 0, offsetTop: 0 }),
    requestAnimationFrame(callback) { queueMicrotask(callback); return 1; }, cancelAnimationFrame() {},
    getComputedStyle() { return { paddingLeft: '34px', paddingRight: '34px', paddingTop: '10px', paddingBottom: '21px' }; },
    scrollTo(x, y) { this.scrollX = x; this.scrollY = y; },
  });
  doc.defaultView = win;
  function element() {
    const values = new Map();
    const classes = new Set();
    const attributes = new Map();
    return Object.assign(target(), {
      ownerDocument: doc, innerHTML: '<svg>expand</svg>', dataset: {}, hidden: false, isConnected: true,
      style: {
        getPropertyValue(name) { return values.get(name)?.value || ''; },
        getPropertyPriority(name) { return values.get(name)?.priority || ''; },
        setProperty(name, value, priority = '') { values.set(name, { value, priority }); },
        removeProperty(name) { values.delete(name); },
      },
      classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); }, contains(name) { return classes.has(name); } },
      setAttribute(name, value) { attributes.set(name, value); }, getAttribute(name) { return attributes.get(name); },
      focus() { doc.activeElement = this; },
      append(child) { this.child = child; }, remove() { this.isConnected = false; },
      contains(child) { return child === this || child === this.child; }, querySelectorAll() { return this.child ? [this.child] : []; },
      getClientRects() { return [1]; },
    });
  }
  doc.documentElement = element(); doc.body = element(); doc.createElement = element;
  const host = element(), frame = element(), button = element(), canvas = element();
  doc.activeElement = button;
  let exited = 0, resized = 0;
  const setup = () => setupFullscreen({ host, frame, button, canvas, onResize() { resized += 1; }, onExit() { exited += 1; } });
  return { doc, win, host, frame, button, canvas, setup, get exited() { return exited; }, get resized() { return resized; } };
}

test('the complete portrait stage fits safe areas in landscape, portrait, and small screens', () => {
  for (const [width, height] of [[844, 390], [390, 844], [320, 240], [2560, 1440]]) {
    const padding = { left: 34, right: 12, top: 10, bottom: 21 };
    const layout = fullscreenLayout(width, height, padding);
    assert.ok(layout.scale > 0);
    assert.ok(420 * layout.scale <= width - 46 + 1e-10);
    assert.ok(600 * layout.scale <= height - 31 + 1e-10);
    assert.equal(layout.x, 34 + (width - 46) / 2);
    assert.equal(layout.y, 10 + (height - 31) / 2);
  }
});

test('immersive fallback handles viewport changes, Escape, and exact style/scroll restoration', async () => {
  const env = environment();
  env.doc.body.style.setProperty('overflow', 'clip', 'important');
  const controller = env.setup();
  assert.equal(env.button.hidden, false);
  await controller.toggle();
  assert.equal(controller.active, true);
  assert.equal(env.host.dataset.fullscreenMode, 'immersive');
  assert.equal(env.host.classList.contains('is-fullscreen'), true);
  assert.equal(env.doc.activeElement, env.canvas);
  assert.equal(env.host.child.hidden, false);
  assert.equal(env.button.getAttribute('aria-label'), 'Exit fullscreen');
  env.win.visualViewport.height = 320;
  env.win.visualViewport.dispatch('resize');
  await flush();
  assert.equal(Number(env.host.style.getPropertyValue('--fullscreen-scale')), (320 - 31) / 600);
  let prevented = false, stopped = false;
  env.doc.dispatch('keydown', { code: 'Escape', preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
  await flush();
  assert.equal(controller.active, false);
  assert.equal(prevented && stopped, true);
  assert.equal(env.doc.body.style.getPropertyValue('overflow'), 'clip');
  assert.equal(env.doc.body.style.getPropertyPriority('overflow'), 'important');
  assert.equal(env.doc.body.style.getPropertyValue('position'), '');
  assert.equal(env.win.scrollY, 480);
  assert.equal(env.win.scrollX, 3);
  assert.equal(env.doc.activeElement, env.button);
  assert.equal(env.host.child.hidden, true);
  assert.equal(env.exited, 1);
  controller.destroy();
});

test('denied native fullscreen keeps the immersive view available', async () => {
  const env = environment();
  env.host.requestFullscreen = async () => { throw new Error('Unavailable'); };
  const controller = env.setup();
  await controller.toggle();
  assert.equal(controller.active, true);
  assert.equal(env.host.dataset.fullscreenMode, 'immersive');
  await controller.exit();
  assert.equal(controller.active, false);
});

test('a late native enter cannot reopen an already exited game', async () => {
  const env = environment();
  const pending = deferred();
  env.host.requestFullscreen = () => pending.promise;
  let exits = 0;
  env.doc.exitFullscreen = async () => { exits += 1; env.doc.fullscreenElement = null; env.doc.dispatch('fullscreenchange'); };
  const controller = env.setup();
  const entering = controller.toggle();
  await controller.exit();
  env.doc.fullscreenElement = env.host;
  pending.resolve();
  await entering;
  assert.equal(controller.active, false);
  assert.equal(env.doc.fullscreenElement, null);
  assert.equal(exits, 1);
  assert.equal(env.host.classList.contains('is-fullscreen'), false);
  assert.equal(env.doc.body.style.getPropertyValue('position'), '');
});

test('a browser-initiated native exit restores normal page state', async () => {
  const env = environment();
  env.host.requestFullscreen = async () => { env.doc.fullscreenElement = env.host; env.doc.dispatch('fullscreenchange'); };
  const controller = env.setup();
  await controller.toggle();
  assert.equal(env.host.dataset.fullscreenMode, 'native');
  env.doc.fullscreenElement = null;
  env.doc.dispatch('fullscreenchange');
  assert.equal(controller.active, false);
  assert.equal(env.button.getAttribute('aria-label'), 'Enter fullscreen');
  assert.equal(env.exited, 1);
  assert.equal(env.host.classList.contains('is-fullscreen'), false);
});
