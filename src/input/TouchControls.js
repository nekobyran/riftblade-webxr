export const TouchInputEvent = Object.freeze({
  SLICE: 'input:touch-slice',
  DODGE: 'input:dodge',
  PAUSE: 'input:pause',
});

const DODGE_STATE_EVENT = 'game:get-dodge';
const LOCAL_DODGE_FEEDBACK_MS = 320;
const SLICE_RELEASE_FEEDBACK_MS = 220;

/**
 * Mobile controls intentionally leave the play field unobstructed: pointers are
 * captured directly on the renderer canvas and forwarded to RhythmGame's
 * note-raycast slice API. Only pause and obstacle-dodge actions occupy UI space.
 */
export class TouchControls {
  constructor({ game = null, eventTarget = null, parent = null, onPause = null } = {}) {
    this.game = game;
    this.eventTarget = eventTarget ?? new EventTarget();
    this.parent = parent;
    this.onPause = onPause;
    this.canvas = game?.canvas ?? null;
    this.root = null;
    this.active = false;
    this.paused = false;
    this.activeSlices = new Map();
    this.dodgeLane = 0;
    this.dodgeFeedbackTimer = null;
    this.sliceFeedbackTimer = null;
    this.abortController = new AbortController();

    this.handleCanvasPointerDown = this.handleCanvasPointerDown.bind(this);
    this.handleCanvasPointerMove = this.handleCanvasPointerMove.bind(this);
    this.handleCanvasPointerEnd = this.handleCanvasPointerEnd.bind(this);
    this.handleCanvasPointerCancel = this.handleCanvasPointerCancel.bind(this);
    this.handleControlPointerDown = this.handleControlPointerDown.bind(this);
    this.handleControlPointerEnd = this.handleControlPointerEnd.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.handleDodgeState = this.handleDodgeState.bind(this);
  }

  initialize() {
    if (this.root) return this.root;
    this.parent = resolveTouchMount(this.parent);
    if (!this.parent) return null;
    this.canvas = this.canvas
      ?? this.game?.canvas
      ?? globalThis.document?.querySelector?.('#game-canvas')
      ?? null;

    const root = document.createElement('section');
    root.id = 'touch-control-deck';
    root.className = 'touch-controls';
    root.dataset.dodgeLane = 'center';
    root.setAttribute('aria-label', '手机划击与障碍躲避控制');
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <p class="sr-only">触摸画面中的音符，再沿箭头方向滑动以切击。障碍来临时使用左躲或右躲按钮。</p>
      <button class="touch-pause" type="button" data-touch-action="pause" aria-label="暂停游戏" disabled>Ⅱ</button>
      <div class="touch-slice-instruction" aria-hidden="true">
        <i></i><span>按住音符 · 沿箭头划击</span>
      </div>
      <div class="touch-dodge-rail" role="group" aria-label="障碍躲避">
        ${renderDodgeButton(-1, '左躲', '‹')}
        ${renderDodgeButton(1, '右躲', '›')}
      </div>`;
    this.parent.setAttribute?.('aria-label', '移动端划击与躲避控制');
    this.parent.append(root);
    this.root = root;

    const { signal } = this.abortController;
    root.addEventListener('pointerdown', this.handleControlPointerDown, { signal });
    root.addEventListener('pointerup', this.handleControlPointerEnd, { signal });
    root.addEventListener('pointercancel', this.handleControlPointerEnd, { signal });
    root.addEventListener('lostpointercapture', this.handleControlPointerEnd, { signal });
    root.addEventListener('click', this.handleClick, { signal });

    // Capture-phase canvas listeners run before RhythmGame's desktop pointer
    // controls, preventing one touch from being interpreted as both a tap and a
    // directional mobile slice.
    const canvasOptions = { signal, capture: true, passive: false };
    this.canvas?.addEventListener?.('pointerdown', this.handleCanvasPointerDown, canvasOptions);
    this.canvas?.addEventListener?.('pointermove', this.handleCanvasPointerMove, canvasOptions);
    this.canvas?.addEventListener?.('pointerup', this.handleCanvasPointerEnd, canvasOptions);
    this.canvas?.addEventListener?.('pointercancel', this.handleCanvasPointerCancel, canvasOptions);
    this.canvas?.addEventListener?.('lostpointercapture', this.handleCanvasPointerCancel, { signal, capture: true });
    this.eventTarget?.addEventListener?.(DODGE_STATE_EVENT, this.handleDodgeState, { signal });

    this.syncControlState();
    return root;
  }

  dispose() {
    this.cancelAllSlices();
    this.abortController.abort();
    clearTimeout(this.dodgeFeedbackTimer);
    clearTimeout(this.sliceFeedbackTimer);
    this.dodgeFeedbackTimer = null;
    this.sliceFeedbackTimer = null;
    this.root?.remove();
    this.root = null;
  }

  setActive(active) {
    this.active = Boolean(active);
    if (!this.active) {
      this.cancelAllSlices();
      this.setDodgeLane(0);
    }
    if (!this.root) return;
    this.root.classList.toggle('is-active', this.active);
    this.root.setAttribute('aria-hidden', String(!this.active));
    this.syncControlState();
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    if (this.paused) this.cancelAllSlices();
    const button = this.root?.querySelector('[data-touch-action="pause"]');
    if (button) {
      button.textContent = this.paused ? '▶' : 'Ⅱ';
      button.setAttribute('aria-label', this.paused ? '继续游戏' : '暂停游戏');
    }
    this.root?.classList.toggle('is-paused', this.paused);
    this.syncControlState();
  }

  syncControlState() {
    this.root?.querySelectorAll('button').forEach((button) => {
      const pauseButton = button.dataset.touchAction === 'pause';
      button.disabled = !this.active || (!pauseButton && this.paused);
    });
  }

  handleCanvasPointerDown(event) {
    if (!this.active || this.paused || !isSlicePointer(event) || this.activeSlices.has(event.pointerId)) return;
    consumePointerEvent(event);
    this.canvas?.setPointerCapture?.(event.pointerId);
    const point = pointerPoint(event);
    this.activeSlices.set(event.pointerId, point);
    this.paintSliceFeedback(point, true);
    const result = this.game?.beginTouchSlice?.(event.pointerId, point.x, point.y);
    this.emit(TouchInputEvent.SLICE, {
      phase: 'start', pointerId: event.pointerId, clientX: point.x, clientY: point.y, pointerType: event.pointerType, result,
    });
  }

  handleCanvasPointerMove(event) {
    if (!this.activeSlices.has(event.pointerId)) return;
    consumePointerEvent(event);
    const point = pointerPoint(event);
    this.activeSlices.set(event.pointerId, point);
    this.paintSliceFeedback(point, true);
    const result = this.game?.updateTouchSlice?.(event.pointerId, point.x, point.y);
    this.emit(TouchInputEvent.SLICE, {
      phase: 'move', pointerId: event.pointerId, clientX: point.x, clientY: point.y, pointerType: event.pointerType, result,
    });
  }

  handleCanvasPointerEnd(event) {
    if (!this.activeSlices.has(event.pointerId)) return;
    consumePointerEvent(event);
    const point = pointerPoint(event, this.activeSlices.get(event.pointerId));
    this.activeSlices.delete(event.pointerId);
    const result = this.game?.endTouchSlice?.(event.pointerId, point.x, point.y);
    this.releaseCanvasPointer(event.pointerId);
    this.paintSliceFeedback(point, false);
    this.emit(TouchInputEvent.SLICE, {
      phase: 'end', pointerId: event.pointerId, clientX: point.x, clientY: point.y, pointerType: event.pointerType, result,
    });
  }

  handleCanvasPointerCancel(event) {
    if (!this.activeSlices.has(event.pointerId)) return;
    consumePointerEvent(event);
    const point = pointerPoint(event, this.activeSlices.get(event.pointerId));
    this.activeSlices.delete(event.pointerId);
    const result = this.game?.cancelTouchSlice?.(event.pointerId);
    this.releaseCanvasPointer(event.pointerId);
    this.paintSliceFeedback(point, false);
    this.emit(TouchInputEvent.SLICE, {
      phase: 'cancel', pointerId: event.pointerId, clientX: point.x, clientY: point.y, pointerType: event.pointerType, result,
    });
  }

  cancelAllSlices() {
    for (const pointerId of this.activeSlices.keys()) {
      this.game?.cancelTouchSlice?.(pointerId);
      this.releaseCanvasPointer(pointerId);
    }
    this.activeSlices.clear();
    this.root?.classList.remove('is-slicing', 'just-sliced');
  }

  releaseCanvasPointer(pointerId) {
    try {
      if (!this.canvas?.hasPointerCapture || this.canvas.hasPointerCapture(pointerId)) {
        this.canvas?.releasePointerCapture?.(pointerId);
      }
    } catch {
      // A browser may release capture before dispatching lostpointercapture.
    }
  }

  paintSliceFeedback(point, slicing) {
    if (!this.root) return;
    clearTimeout(this.sliceFeedbackTimer);
    this.root.style.setProperty('--slice-x', `${point.x}px`);
    this.root.style.setProperty('--slice-y', `${point.y}px`);
    this.root.classList.toggle('is-slicing', slicing || this.activeSlices.size > 0);
    this.root.classList.remove('just-sliced');
    if (!slicing && this.activeSlices.size === 0) {
      // Force a fresh pulse even when several cuts finish in quick succession.
      void this.root.offsetWidth;
      this.root.classList.add('just-sliced');
      this.sliceFeedbackTimer = setTimeout(() => this.root?.classList.remove('just-sliced'), SLICE_RELEASE_FEEDBACK_MS);
    }
  }

  handleControlPointerDown(event) {
    if (!this.active || this.paused) return;
    const button = event.target.closest?.('[data-touch-dodge]');
    if (!button) return;
    button.setPointerCapture?.(event.pointerId);
    button.dataset.pressPointer = String(event.pointerId);
    button.classList.add('is-pressed');
  }

  handleControlPointerEnd(event) {
    const button = event.target.closest?.('[data-touch-dodge]');
    if (!button || button.dataset.pressPointer !== String(event.pointerId)) return;
    button.classList.remove('is-pressed');
    delete button.dataset.pressPointer;
  }

  handleClick(event) {
    const pauseButton = event.target.closest?.('[data-touch-action="pause"]');
    if (pauseButton && this.active) {
      this.emit(TouchInputEvent.PAUSE, { paused: this.paused });
      if (typeof this.onPause === 'function') this.onPause();
      else if (this.paused) this.game?.resume?.();
      else this.game?.pause?.();
      return;
    }

    const dodgeButton = event.target.closest?.('[data-touch-dodge]');
    if (!dodgeButton || !this.active || this.paused) return;
    const direction = normalizeDodgeLane(dodgeButton.dataset.touchDodge);
    if (direction === 0) return;
    this.setDodgeLane(direction, { temporary: true });
    const result = this.game?.dodge?.(direction);
    const resultLane = readDodgeLane(result);
    if (resultLane !== null) this.setDodgeLane(resultLane);
    this.emit(TouchInputEvent.DODGE, { direction, lane: resultLane ?? direction, result });
  }

  handleDodgeState(event) {
    const lane = readDodgeLane(event?.detail);
    if (lane !== null) this.setDodgeLane(lane);
  }

  setDodgeLane(lane, { temporary = false } = {}) {
    const normalized = normalizeDodgeLane(lane);
    this.dodgeLane = normalized;
    clearTimeout(this.dodgeFeedbackTimer);
    this.dodgeFeedbackTimer = null;
    if (this.root) {
      this.root.dataset.dodgeLane = normalized < 0 ? 'left' : normalized > 0 ? 'right' : 'center';
      this.root.querySelectorAll('[data-touch-dodge]').forEach((button) => {
        const selected = normalizeDodgeLane(button.dataset.touchDodge) === normalized && normalized !== 0;
        button.classList.toggle('is-current', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
    }
    if (temporary && normalized !== 0) {
      this.dodgeFeedbackTimer = setTimeout(() => this.setDodgeLane(0), LOCAL_DODGE_FEEDBACK_MS);
    }
    return normalized;
  }

  emit(type, detail) {
    this.eventTarget?.dispatchEvent?.(createCustomEvent(type, detail));
    this.root?.dispatchEvent(createCustomEvent(type, detail));
  }
}

export function normalizeDodgeLane(value, fallback = 0) {
  const candidate = typeof value === 'object' && value !== null
    ? (value.lane ?? value.direction)
    : value;
  if (typeof candidate === 'string') {
    const label = candidate.trim().toLowerCase();
    if (['left', '左', '-1'].includes(label)) return -1;
    if (['right', '右', '+1', '1'].includes(label)) return 1;
    if (['center', 'centre', '中', '0'].includes(label)) return 0;
  }
  const numeric = Number(candidate);
  if (Number.isFinite(numeric)) return Math.sign(numeric);
  return Math.sign(Number(fallback) || 0);
}

export function resolveTouchMount(parent = null, documentRef = globalThis.document) {
  return parent
    ?? documentRef?.getElementById?.('touch-controls')
    ?? documentRef?.body
    ?? null;
}

function renderDodgeButton(direction, label, arrow) {
  return `
    <button class="touch-dodge-button" type="button" data-touch-dodge="${direction}" aria-label="${label}障碍" aria-pressed="false" disabled>
      <span aria-hidden="true">${arrow}</span><b>${label}</b>
    </button>`;
}

function readDodgeLane(value) {
  const candidate = typeof value === 'object' && value !== null
    ? (value.lane ?? value.direction)
    : value;
  if (candidate === undefined || candidate === null || candidate === '' || typeof candidate === 'boolean') return null;
  return normalizeDodgeLane(candidate);
}

function pointerPoint(event, fallback = { x: 0, y: 0 }) {
  const x = Number(event?.clientX);
  const y = Number(event?.clientY);
  return {
    x: Number.isFinite(x) ? x : fallback.x,
    y: Number.isFinite(y) ? y : fallback.y,
  };
}

function isSlicePointer(event) {
  return event?.pointerType !== 'mouse' || event.button === 0;
}

function consumePointerEvent(event) {
  event.preventDefault?.();
  event.stopImmediatePropagation?.();
}

function createCustomEvent(type, detail) {
  if (typeof CustomEvent === 'function') return new CustomEvent(type, { detail });
  const event = new Event(type);
  Object.defineProperty(event, 'detail', { value: detail });
  return event;
}
