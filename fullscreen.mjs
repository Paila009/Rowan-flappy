/** Fit the complete 420 × 600 stage, including its HTML controls and overlays. */
export function fullscreenLayout(width, height, padding = {}) {
  const left = Math.max(0, Number(padding.left) || 0);
  const right = Math.max(0, Number(padding.right) || 0);
  const top = Math.max(0, Number(padding.top) || 0);
  const bottom = Math.max(0, Number(padding.bottom) || 0);
  const availableWidth = Math.max(1, width - left - right);
  const availableHeight = Math.max(1, height - top - bottom);
  return { scale: Math.min(availableWidth / 420, availableHeight / 600), x: left + availableWidth / 2, y: top + availableHeight / 2 };
}

/** Native fullscreen where supported, with the same fitted stage in immersive mode. */
export function setupFullscreen({ host, frame, button, canvas, onResize = () => {}, onExit = () => {} }) {
  if (!host || !frame || !button || !canvas) throw new TypeError('Fullscreen requires host, frame, button, and canvas elements.');
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const originalIcon = button.innerHTML;
  const listeners = [];
  let session = null;
  let desired = false;
  let nativeObserved = false;
  let exitingNative = 0;
  let destroyed = false;
  let animation = 0;
  const nativeElement = () => doc.fullscreenElement || doc.webkitFullscreenElement;
  const nativeExit = () => typeof doc.exitFullscreen === 'function' ? doc.exitFullscreen() : doc.webkitExitFullscreen?.();
  const focus = (element) => { try { element?.focus({ preventScroll: true }); } catch { element?.focus(); } };
  const exitButton = doc.createElement('button');
  exitButton.type = 'button';
  exitButton.className = 'fullscreen-exit';
  exitButton.textContent = '× Exit';
  exitButton.setAttribute('aria-label', 'Exit fullscreen');
  exitButton.hidden = true;
  host.append(exitButton);
  button.hidden = false;

  function listen(target, type, handler, options) {
    target?.addEventListener(type, handler, options);
    listeners.push(() => target?.removeEventListener(type, handler, options));
  }
  function updateButton() {
    button.setAttribute('aria-label', desired ? 'Exit fullscreen' : 'Enter fullscreen');
    button.setAttribute('aria-pressed', String(desired));
    button.title = desired ? 'Exit fullscreen (Escape)' : 'Enter fullscreen';
    button.innerHTML = desired
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v6H3m18 0h-6V3M3 15h6v6m6 0v-6h6"/></svg>'
      : originalIcon;
    exitButton.hidden = !desired;
  }
  function resize() {
    animation = 0;
    if (!session) return;
    const viewport = win.visualViewport;
    const width = viewport?.width || win.innerWidth || doc.documentElement.clientWidth;
    const height = viewport?.height || win.innerHeight || doc.documentElement.clientHeight;
    const native = nativeElement() === host;
    host.style.setProperty('--fullscreen-width', `${width}px`);
    host.style.setProperty('--fullscreen-height', `${height}px`);
    host.style.setProperty('--fullscreen-left', `${native ? 0 : viewport?.offsetLeft || 0}px`);
    host.style.setProperty('--fullscreen-top', `${native ? 0 : viewport?.offsetTop || 0}px`);
    const computed = win.getComputedStyle(host);
    const layout = fullscreenLayout(width, height, {
      left: parseFloat(computed.paddingLeft), right: parseFloat(computed.paddingRight),
      top: parseFloat(computed.paddingTop), bottom: parseFloat(computed.paddingBottom),
    });
    host.style.setProperty('--fullscreen-scale', String(layout.scale));
    host.style.setProperty('--fullscreen-stage-x', `${layout.x}px`);
    host.style.setProperty('--fullscreen-stage-y', `${layout.y}px`);
    onResize();
  }
  function scheduleResize() {
    if (!session || animation) return;
    animation = win.requestAnimationFrame(resize);
  }
  function rememberStyles(element, properties) {
    return properties.map((property) => ({ element, property, value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) }));
  }
  function activate() {
    if (session) return;
    session = {
      x: win.scrollX, y: win.scrollY, focus: doc.activeElement,
      styles: [
        ...rememberStyles(doc.documentElement, ['overflow', 'overscroll-behavior']),
        ...rememberStyles(doc.body, ['overflow', 'overscroll-behavior', 'position', 'top', 'left', 'width']),
      ],
    };
    doc.documentElement.style.setProperty('overflow', 'hidden');
    doc.documentElement.style.setProperty('overscroll-behavior', 'none');
    doc.body.style.setProperty('overflow', 'hidden');
    doc.body.style.setProperty('overscroll-behavior', 'none');
    doc.body.style.setProperty('position', 'fixed');
    doc.body.style.setProperty('top', `${-session.y}px`);
    doc.body.style.setProperty('left', `${-session.x}px`);
    doc.body.style.setProperty('width', '100%');
    host.classList.add('is-fullscreen');
    host.dataset.fullscreenMode = 'immersive';
    updateButton();
    resize();
    focus(canvas);
  }
  function cleanup() {
    if (!session) return;
    const previous = session;
    session = null;
    nativeObserved = false;
    host.classList.remove('is-fullscreen');
    delete host.dataset.fullscreenMode;
    for (const property of ['width', 'height', 'left', 'top', 'scale', 'stage-x', 'stage-y']) host.style.removeProperty(`--fullscreen-${property}`);
    for (const { element, property, value, priority } of previous.styles) {
      if (value) element.style.setProperty(property, value, priority); else element.style.removeProperty(property);
    }
    updateButton();
    win.scrollTo(previous.x, previous.y);
    focus(previous.focus?.isConnected ? previous.focus : button);
    onResize();
    onExit();
  }
  async function leaveNative() {
    if (nativeElement() !== host) return;
    exitingNative += 1;
    try { await nativeExit(); } catch { /* The fitted immersive view still has an exit control. */ }
    finally { exitingNative -= 1; }
  }
  async function enter() {
    if (destroyed) return;
    desired = true;
    activate();
    const request = host.requestFullscreen || host.webkitRequestFullscreen;
    if (nativeElement() !== host && request) {
      try { await request.call(host, { navigationUI: 'hide' }); }
      catch { /* iOS, embedded pages, and denied native requests retain immersive mode. */ }
    }
    // An earlier native request may finish after the user has already exited.
    if (!desired || destroyed) { await leaveNative(); return; }
    if (nativeElement() === host) {
      nativeObserved = true;
      host.dataset.fullscreenMode = 'native';
    }
    scheduleResize();
  }
  async function exit() {
    desired = false;
    cleanup();
    await leaveNative();
    if (!desired && !destroyed && nativeElement() === host) {
      // A browser may reject exit while changing state; retain a usable exit control.
      desired = true;
      activate();
      nativeObserved = true;
      host.dataset.fullscreenMode = 'native';
    }
  }
  function changed() {
    if (nativeElement() === host) {
      if (!desired || destroyed) { void leaveNative(); return; }
      nativeObserved = true;
      host.dataset.fullscreenMode = 'native';
      scheduleResize();
    } else if (nativeObserved) {
      nativeObserved = false;
      if (desired && exitingNative) { host.dataset.fullscreenMode = 'immersive'; scheduleResize(); }
      else { desired = false; cleanup(); }
    }
  }
  const toggle = () => desired ? exit() : enter();
  listen(button, 'click', (event) => { event.stopPropagation(); void toggle(); });
  listen(exitButton, 'click', (event) => { event.stopPropagation(); void exit(); });
  listen(doc, 'keydown', (event) => {
    if (!desired) return;
    if (event.key === 'Escape' || event.code === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); void exit();
    } else if (event.key === 'Tab') {
      const targets = [...host.querySelectorAll('button:not([disabled]),a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hidden && element.getClientRects().length);
      const first = targets[0], last = targets.at(-1);
      if (first && ((!event.shiftKey && (doc.activeElement === last || !host.contains(doc.activeElement))) || (event.shiftKey && (doc.activeElement === first || !host.contains(doc.activeElement))))) {
        event.preventDefault(); focus(event.shiftKey ? last : first);
      }
    }
  }, true);
  listen(doc, 'fullscreenchange', changed);
  listen(doc, 'webkitfullscreenchange', changed);
  listen(win, 'resize', scheduleResize);
  listen(win, 'orientationchange', scheduleResize);
  listen(win.visualViewport, 'resize', scheduleResize);
  listen(win.visualViewport, 'scroll', scheduleResize);
  const observer = win.ResizeObserver ? new win.ResizeObserver(scheduleResize) : null;
  observer?.observe(host);
  updateButton();
  return {
    toggle, exit,
    get active() { return desired; },
    destroy() {
      destroyed = true;
      void exit();
      for (const remove of listeners) remove();
      observer?.disconnect();
      if (animation) win.cancelAnimationFrame(animation);
      exitButton.remove();
    },
  };
}
