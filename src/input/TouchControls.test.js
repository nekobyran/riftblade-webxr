import { describe, expect, it, vi } from 'vitest';
import { TouchControls, normalizeLookDelta, normalizeStickPosition, resolveTouchMount } from './TouchControls.js';

describe('normalizeStickPosition', () => {
  const rect = { left: 10, top: 20, width: 200, height: 200 };

  it('returns a stable zero vector in the center', () => {
    expect(normalizeStickPosition(110, 120, rect)).toEqual({ x: 0, y: 0, magnitude: 0 });
  });

  it('normalizes each cardinal direction and flips screen-space Y', () => {
    expect(normalizeStickPosition(182, 120, rect)).toMatchObject({ x: 1, y: 0 });
    expect(normalizeStickPosition(110, 48, rect)).toMatchObject({ x: 0, y: 1 });
  });

  it('clamps diagonal input to the unit circle', () => {
    const result = normalizeStickPosition(410, -280, rect);
    expect(Math.hypot(result.x, result.y)).toBeCloseTo(1, 7);
    expect(result.magnitude).toBe(1);
  });
});

describe('normalizeLookDelta', () => {
  it('produces bounded yaw and pitch deltas', () => {
    expect(normalizeLookDelta(50, -25, 500, 250)).toEqual({ x: 0.1, y: -0.1, yaw: -0.24, pitch: 0.18000000000000002 });
    expect(normalizeLookDelta(9999, -9999, 100, 100)).toMatchObject({ x: 1, y: -1, yaw: -2.4, pitch: 1.8 });
  });
});

describe('TouchControls integration', () => {
  it('prefers the dedicated touch-controls mount and falls back to body', () => {
    const mount = { id: 'touch-controls' };
    const body = { id: 'body' };
    expect(resolveTouchMount(null, { getElementById: () => mount, body })).toBe(mount);
    expect(resolveTouchMount(null, { getElementById: () => null, body })).toBe(body);
  });

  it('passes raw pointer deltas to the game while emitting normalized look data', () => {
    const rotateView = vi.fn();
    const dispatchEvent = vi.fn();
    const controls = new TouchControls({ game: { rotateView }, eventTarget: { dispatchEvent } });
    const detail = { deltaX: 18, deltaY: -7, x: 0.1, y: -0.05, yaw: -0.24, pitch: 0.09 };

    controls.emitLook(detail);

    expect(rotateView).toHaveBeenCalledWith(18, -7);
    expect(dispatchEvent.mock.calls[0][0].detail).toEqual(detail);
  });
});
