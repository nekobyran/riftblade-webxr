import { Hand } from '../shared/contracts.js';

export const TouchInputEvent = Object.freeze({
  SABER: 'input:touch-saber',
  LOOK: 'input:look',
  PAUSE: 'input:pause',
});

/**
 * Mobile-only dual saber sticks and a separate drag-to-look surface.
 * The class calls optional RhythmGame methods and always mirrors input as DOM events,
 * so the renderer can integrate without coupling the controls to Three.js.
 */
export class TouchControls {
  constructor({ game = null, eventTarget = null, parent = null, onPause = null } = {}) {
    this.game = game;
    this.eventTarget = eventTarget ?? new EventTarget();
    // Keep an explicit mount when supplied. Otherwise resolve the dedicated
    // shell lazily in initialize(), so scripts loaded before <body> still work.
    this.parent = parent;
    this.onPause = onPause;
    this.root = null;
    this.active = false;
    this.paused = false;
    this.abortController = new AbortController();
    this.sticks = new Map([
      [Hand.LEFT, createStickState(Hand.LEFT)],
      [Hand.RIGHT, createStickState(Hand.RIGHT)],
    ]);
    this.look = { pointerId: null, x: 0, y: 0 };

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerEnd = this.handlePointerEnd.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleClick = this.handleClick.bind(this);
  }

  initialize() {
    if (this.root) return this.root;
    this.parent = resolveTouchMount(this.parent);
    if (!this.parent) return null;
    const root = document.createElement('section');
    root.id = 'touch-control-deck';
    root.className = 'touch-controls';
    root.setAttribute('aria-label', '手机双剑控制器');
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <button class="touch-pause" type="button" data-touch-action="pause" aria-label="暂停游戏">Ⅱ</button>
      <div class="touch-look-zone" data-touch-look tabindex="0" role="application" aria-label="转视角区域，拖动以转向">
        <span aria-hidden="true"><i></i>拖动转视角</span>
      </div>
      ${renderStick(Hand.LEFT, '左剑', 'L')}
      ${renderStick(Hand.RIGHT, '右剑', 'R')}`;
    this.parent.append(root);
    this.root = root;

    const { signal } = this.abortController;
    root.addEventListener('pointerdown', this.handlePointerDown, { signal });
    root.addEventListener('pointermove', this.handlePointerMove, { signal });
    root.addEventListener('pointerup', this.handlePointerEnd, { signal });
    root.addEventListener('pointercancel', this.handlePointerEnd, { signal });
    root.addEventListener('lostpointercapture', this.handlePointerEnd, { signal });
    root.addEventListener('keydown', this.handleKeyDown, { signal });
    root.addEventListener('keyup', this.handleKeyUp, { signal });
    root.addEventListener('click', this.handleClick, { signal });
    return root;
  }

  dispose() {
    this.abortController.abort();
    for (const hand of this.sticks.keys()) this.releaseStick(hand);
    this.root?.remove();
    this.root = null;
  }

  setActive(active) {
    this.active = Boolean(active);
    if (!this.root) return;
    this.root.classList.toggle('is-active', this.active);
    this.root.setAttribute('aria-hidden', String(!this.active));
    this.root.querySelectorAll('button, [tabindex]').forEach((control) => {
      if ('disabled' in control) control.disabled = !this.active;
      if (control.hasAttribute('tabindex')) control.tabIndex = this.active ? 0 : -1;
    });
    if (!this.active) {
      for (const hand of this.sticks.keys()) this.releaseStick(hand);
      this.look.pointerId = null;
    }
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    const button = this.root?.querySelector('[data-touch-action="pause"]');
    if (button) {
      button.textContent = this.paused ? '▶' : 'Ⅱ';
      button.setAttribute('aria-label', this.paused ? '继续游戏' : '暂停游戏');
    }
  }

  handlePointerDown(event) {
    if (!this.active) return;
    const pad = event.target.closest('[data-touch-stick]');
    if (pad) {
      const hand = pad.dataset.touchStick;
      const state = this.sticks.get(hand);
      if (!state || state.pointerId !== null) return;
      event.preventDefault();
      pad.setPointerCapture?.(event.pointerId);
      state.pointerId = event.pointerId;
      state.lastAt = event.timeStamp;
      state.lastX = event.clientX;
      state.lastY = event.clientY;
      this.updateStickFromPointer(hand, pad, event);
      return;
    }

    const lookZone = event.target.closest('[data-touch-look]');
    if (lookZone && this.look.pointerId === null) {
      event.preventDefault();
      lookZone.setPointerCapture?.(event.pointerId);
      this.look = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      lookZone.classList.add('is-dragging');
    }
  }

  handlePointerMove(event) {
    if (!this.active) return;
    for (const [hand, state] of this.sticks) {
      if (state.pointerId === event.pointerId) {
        event.preventDefault();
        const pad = this.root?.querySelector(`[data-touch-stick="${hand}"]`);
        if (pad) this.updateStickFromPointer(hand, pad, event);
        return;
      }
    }

    if (this.look.pointerId === event.pointerId) {
      event.preventDefault();
      const zone = this.root?.querySelector('[data-touch-look]');
      const rect = zone?.getBoundingClientRect() ?? { width: innerWidth, height: innerHeight };
      const deltaX = event.clientX - this.look.x;
      const deltaY = event.clientY - this.look.y;
      this.look.x = event.clientX;
      this.look.y = event.clientY;
      const normalized = normalizeLookDelta(deltaX, deltaY, rect.width, rect.height);
      this.emitLook({ ...normalized, deltaX, deltaY, pointerType: event.pointerType });
    }
  }

  handlePointerEnd(event) {
    for (const [hand, state] of this.sticks) {
      if (state.pointerId === event.pointerId) {
        event.preventDefault();
        this.releaseStick(hand);
        return;
      }
    }
    if (this.look.pointerId === event.pointerId) {
      this.look.pointerId = null;
      this.root?.querySelector('[data-touch-look]')?.classList.remove('is-dragging');
    }
  }

  handleKeyDown(event) {
    const pad = event.target.closest('[data-touch-stick]');
    if (!pad || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) return;
    event.preventDefault();
    const hand = pad.dataset.touchStick;
    const state = this.sticks.get(hand);
    if (!state) return;
    const increment = 0.42;
    if (event.key === 'ArrowLeft') state.x = Math.max(-1, state.x - increment);
    if (event.key === 'ArrowRight') state.x = Math.min(1, state.x + increment);
    if (event.key === 'ArrowUp') state.y = Math.min(1, state.y + increment);
    if (event.key === 'ArrowDown') state.y = Math.max(-1, state.y - increment);
    if (event.key === ' ') state.y = state.y >= 0 ? -1 : 1;
    this.paintStick(hand);
    this.emitSaber(hand, { x: state.x, y: state.y, active: true, velocity: 1, source: 'keyboard' });
  }

  handleKeyUp(event) {
    const pad = event.target.closest('[data-touch-stick]');
    if (!pad || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) return;
    event.preventDefault();
    this.releaseStick(pad.dataset.touchStick);
  }

  handleClick(event) {
    if (!event.target.closest('[data-touch-action="pause"]') || !this.active) return;
    this.emit(TouchInputEvent.PAUSE, { paused: this.paused });
    if (typeof this.onPause === 'function') this.onPause();
    else if (this.paused) this.game?.resume?.();
    else this.game?.pause?.();
  }

  updateStickFromPointer(hand, pad, event) {
    const state = this.sticks.get(hand);
    if (!state) return;
    const rect = pad.getBoundingClientRect();
    const point = normalizeStickPosition(event.clientX, event.clientY, rect);
    const elapsed = Math.max(8, event.timeStamp - state.lastAt);
    const distance = Math.hypot(event.clientX - state.lastX, event.clientY - state.lastY);
    const velocity = Math.min(4, distance / elapsed / 0.65);
    Object.assign(state, {
      x: point.x,
      y: point.y,
      lastAt: event.timeStamp,
      lastX: event.clientX,
      lastY: event.clientY,
    });
    this.paintStick(hand);
    this.emitSaber(hand, { x: point.x, y: point.y, active: true, velocity, source: 'pointer' });
  }

  paintStick(hand) {
    const state = this.sticks.get(hand);
    const pad = this.root?.querySelector(`[data-touch-stick="${hand}"]`);
    const knob = pad?.querySelector('.joystick-knob');
    if (!state || !pad || !knob) return;
    knob.style.setProperty('--stick-x', `${state.x * 42}%`);
    knob.style.setProperty('--stick-y', `${state.y * -42}%`);
    pad.classList.toggle('is-engaged', Math.abs(state.x) + Math.abs(state.y) > 0.02);
    pad.setAttribute('aria-valuetext', `横向 ${Math.round(state.x * 100)}，纵向 ${Math.round(state.y * 100)}`);
  }

  releaseStick(hand) {
    const state = this.sticks.get(hand);
    if (!state) return;
    const wasActive = state.pointerId !== null || Math.abs(state.x) + Math.abs(state.y) > 0;
    Object.assign(state, { pointerId: null, x: 0, y: 0, lastAt: 0, lastX: 0, lastY: 0 });
    this.paintStick(hand);
    if (wasActive) this.emitSaber(hand, { x: 0, y: 0, active: false, velocity: 0, source: 'release' });
  }

  emitSaber(hand, detail) {
    const payload = { hand, ...detail };
    this.game?.updateTouchSaber?.(hand, payload.x, payload.y, payload.active, payload.velocity);
    this.emit(TouchInputEvent.SABER, payload);
  }

  emitLook(detail) {
    // RhythmGame consumes screen-space pixel deltas and applies its own
    // sensitivity. The mirrored DOM event keeps normalized yaw/pitch so other
    // renderers and accessibility tooling can consume device-independent data.
    this.game?.rotateView?.(detail.deltaX, detail.deltaY);
    this.emit(TouchInputEvent.LOOK, detail);
  }

  emit(type, detail) {
    this.eventTarget.dispatchEvent(createCustomEvent(type, detail));
    this.root?.dispatchEvent(createCustomEvent(type, detail));
  }
}

export function normalizeStickPosition(clientX, clientY, rect) {
  const width = Math.max(1, Number(rect?.width) || 1);
  const height = Math.max(1, Number(rect?.height) || 1);
  const centerX = (Number(rect?.left) || 0) + width / 2;
  const centerY = (Number(rect?.top) || 0) + height / 2;
  const radius = Math.max(1, Math.min(width, height) * 0.36);
  let x = (Number(clientX) - centerX) / radius;
  let y = (centerY - Number(clientY)) / radius;
  const length = Math.hypot(x, y);
  if (length > 1) {
    x /= length;
    y /= length;
  }
  return { x: cleanZero(x), y: cleanZero(y), magnitude: Math.min(1, length) };
}

export function normalizeLookDelta(deltaX, deltaY, width, height) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const x = clamp(Number(deltaX) / safeWidth, -1, 1);
  const y = clamp(Number(deltaY) / safeHeight, -1, 1);
  return {
    x,
    y,
    yaw: x * -2.4,
    pitch: y * -1.8,
  };
}

export function resolveTouchMount(parent = null, documentRef = globalThis.document) {
  return parent
    ?? documentRef?.getElementById?.('touch-controls')
    ?? documentRef?.body
    ?? null;
}

function renderStick(hand, label, shortLabel) {
  return `
    <div class="touch-stick-wrap" data-hand="${hand}">
      <span>${label}</span>
      <div class="joystick-pad" data-touch-stick="${hand}" tabindex="-1" role="slider" aria-label="${label}虚拟摇杆" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="0" aria-valuetext="居中">
        <i class="joystick-ring" aria-hidden="true"></i>
        <b class="joystick-knob" aria-hidden="true">${shortLabel}</b>
      </div>
    </div>`;
}

function createStickState(hand) {
  return { hand, pointerId: null, x: 0, y: 0, lastAt: 0, lastX: 0, lastY: 0 };
}

function createCustomEvent(type, detail) {
  if (typeof CustomEvent === 'function') return new CustomEvent(type, { detail });
  const event = new Event(type);
  Object.defineProperty(event, 'detail', { value: detail });
  return event;
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function cleanZero(value) { return Math.abs(value) < 1e-9 ? 0 : value; }
