import { describe, expect, it } from 'vitest';
import { CutDirection, GameMode, GameplayEvent, normalizeGameMode } from './contracts.js';

describe('shared gameplay contracts', () => {
  it('exposes three stable play modes with a safe standard fallback', () => {
    expect(Object.values(GameMode)).toEqual(['standard', 'auto', 'zen']);
    expect(normalizeGameMode('auto')).toBe(GameMode.AUTO);
    expect(normalizeGameMode('zen')).toBe(GameMode.ZEN);
    expect(normalizeGameMode('unknown')).toBe(GameMode.STANDARD);
  });

  it('keeps all eight directional cuts plus the any-direction modifier', () => {
    expect(new Set(Object.values(CutDirection)).size).toBe(9);
    expect(CutDirection.UP_LEFT).toBe('up-left');
    expect(CutDirection.DOWN_RIGHT).toBe('down-right');
  });

  it('publishes integration events for VR selection and custom audio', () => {
    expect(GameplayEvent.MODE_CHANGE).toBe('game:mode-change');
    expect(GameplayEvent.TRACK_SELECT).toBe('game:track-select');
    expect(GameplayEvent.CUSTOM_TRACK).toBe('game:custom-track');
    expect(GameplayEvent.DODGE).toBe('game:get-dodge');
    expect(GameplayEvent.OBSTACLE).toBe('game:obstacle');
  });
});
