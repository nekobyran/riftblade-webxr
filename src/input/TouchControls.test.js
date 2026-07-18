import { describe, expect, it, vi } from 'vitest';
import { TouchControls, TouchInputEvent, normalizeDodgeLane, resolveTouchMount } from './TouchControls.js';

describe('normalizeDodgeLane', () => {
  it('normalizes numeric, localized, and event-detail lane values', () => {
    expect(normalizeDodgeLane(-4)).toBe(-1);
    expect(normalizeDodgeLane('+1')).toBe(1);
    expect(normalizeDodgeLane('左')).toBe(-1);
    expect(normalizeDodgeLane({ lane: 'right' })).toBe(1);
    expect(normalizeDodgeLane({ direction: 'center' })).toBe(0);
  });

  it('uses a signed fallback for invalid lane data', () => {
    expect(normalizeDodgeLane('unknown', -1)).toBe(-1);
    expect(normalizeDodgeLane(undefined, 1)).toBe(1);
  });
});

describe('TouchControls canvas slicing', () => {
  it('forwards a captured canvas gesture through the start, move, and end slice API', () => {
    const canvas = createCanvas();
    const game = {
      canvas,
      beginTouchSlice: vi.fn(() => ({ noteId: 'n-1' })),
      updateTouchSlice: vi.fn(),
      endTouchSlice: vi.fn(() => ({ rating: 'perfect' })),
      cancelTouchSlice: vi.fn(),
    };
    const eventTarget = new EventTarget();
    const phases = [];
    eventTarget.addEventListener(TouchInputEvent.SLICE, (event) => phases.push(event.detail.phase));
    const controls = new TouchControls({ game, eventTarget });
    controls.setActive(true);

    const down = pointerEvent({ pointerId: 7, clientX: 112, clientY: 204 });
    const move = pointerEvent({ pointerId: 7, clientX: 156, clientY: 166 });
    const up = pointerEvent({ pointerId: 7, clientX: 174, clientY: 148 });
    controls.handleCanvasPointerDown(down);
    controls.handleCanvasPointerMove(move);
    controls.handleCanvasPointerEnd(up);

    expect(canvas.setPointerCapture).toHaveBeenCalledWith(7);
    expect(game.beginTouchSlice).toHaveBeenCalledWith(7, 112, 204);
    expect(game.updateTouchSlice).toHaveBeenCalledWith(7, 156, 166);
    expect(game.endTouchSlice).toHaveBeenCalledWith(7, 174, 148);
    expect(game.cancelTouchSlice).not.toHaveBeenCalled();
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(phases).toEqual(['start', 'move', 'end']);
    expect(down.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(controls.activeSlices.size).toBe(0);
  });

  it('routes pointercancel to cancelTouchSlice instead of completing a cut', () => {
    const canvas = createCanvas();
    const game = {
      canvas,
      beginTouchSlice: vi.fn(),
      updateTouchSlice: vi.fn(),
      endTouchSlice: vi.fn(),
      cancelTouchSlice: vi.fn(),
    };
    const controls = new TouchControls({ game });
    controls.setActive(true);
    controls.handleCanvasPointerDown(pointerEvent({ pointerId: 3, clientX: 90, clientY: 120 }));
    controls.handleCanvasPointerCancel(pointerEvent({ pointerId: 3, clientX: 96, clientY: 110 }));

    expect(game.cancelTouchSlice).toHaveBeenCalledWith(3);
    expect(game.endTouchSlice).not.toHaveBeenCalled();
    expect(controls.activeSlices.size).toBe(0);
  });

  it('cancels every live gesture when controls are paused or hidden', () => {
    const canvas = createCanvas();
    const game = { canvas, beginTouchSlice: vi.fn(), cancelTouchSlice: vi.fn() };
    const controls = new TouchControls({ game });
    controls.setActive(true);
    controls.handleCanvasPointerDown(pointerEvent({ pointerId: 1 }));
    controls.handleCanvasPointerDown(pointerEvent({ pointerId: 2, clientX: 40 }));

    controls.setPaused(true);

    expect(game.cancelTouchSlice).toHaveBeenCalledTimes(2);
    expect(game.cancelTouchSlice).toHaveBeenCalledWith(1);
    expect(game.cancelTouchSlice).toHaveBeenCalledWith(2);
    expect(controls.activeSlices.size).toBe(0);
  });

  it('does not retain the removed joystick or drag-to-look event contract', () => {
    expect(TouchInputEvent).toEqual({
      SLICE: 'input:touch-slice',
      DODGE: 'input:dodge',
      PAUSE: 'input:pause',
    });
    expect(TouchInputEvent).not.toHaveProperty('SABER');
    expect(TouchInputEvent).not.toHaveProperty('LOOK');
  });
});

describe('TouchControls actions', () => {
  it('calls game.dodge with the requested side and mirrors the action event', () => {
    const dodge = vi.fn(() => ({ lane: -1 }));
    const eventTarget = new EventTarget();
    const received = [];
    eventTarget.addEventListener(TouchInputEvent.DODGE, (event) => received.push(event.detail));
    const controls = new TouchControls({ game: { dodge }, eventTarget });
    controls.setActive(true);
    const button = createClosestButton({ touchDodge: '-1' });

    controls.handleClick({ target: button });

    expect(dodge).toHaveBeenCalledWith(-1);
    expect(controls.dodgeLane).toBe(-1);
    expect(received[0]).toMatchObject({ direction: -1, lane: -1 });
  });

  it('accepts lane feedback from game:get-dodge detail', () => {
    const controls = new TouchControls();
    controls.handleDodgeState({ detail: { lane: 1 } });
    expect(controls.dodgeLane).toBe(1);
    controls.handleDodgeState({ detail: { lane: 0 } });
    expect(controls.dodgeLane).toBe(0);
  });

  it('keeps pause available while paused and delegates through onPause', () => {
    const onPause = vi.fn();
    const controls = new TouchControls({ onPause });
    controls.setActive(true);
    controls.setPaused(true);
    const button = createClosestButton({ touchAction: 'pause' });

    controls.handleClick({ target: button });

    expect(onPause).toHaveBeenCalledOnce();
  });

  it('prefers the dedicated touch-controls mount and falls back to body', () => {
    const mount = { id: 'touch-controls' };
    const body = { id: 'body' };
    expect(resolveTouchMount(null, { getElementById: () => mount, body })).toBe(mount);
    expect(resolveTouchMount(null, { getElementById: () => null, body })).toBe(body);
  });
});

function createCanvas() {
  return {
    setPointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
  };
}

function pointerEvent({ pointerId = 1, clientX = 20, clientY = 30, pointerType = 'touch', button = 0 } = {}) {
  return {
    pointerId,
    clientX,
    clientY,
    pointerType,
    button,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };
}

function createClosestButton(dataset) {
  const button = { dataset };
  button.closest = (selector) => {
    if (selector.includes('touch-action') && dataset.touchAction) return button;
    if (selector.includes('touch-dodge') && dataset.touchDodge) return button;
    return null;
  };
  return button;
}
