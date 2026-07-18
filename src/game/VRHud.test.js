import { describe, expect, it } from 'vitest';
import {
  VR_HUD_REFRESH_MS,
  VRHud,
  createHapticProfile,
  formatHudTime,
  normalizeVRHudData,
  shouldRefreshVRHud,
  shouldShowVRHud,
} from './VRHud.js';

describe('VRHud presentation rules', () => {
  it('only appears inside an immersive playing surface and never over the VR menu', () => {
    expect(shouldShowVRHud({ presenting: true, phase: 'playing', menuVisible: false })).toBe(true);
    expect(shouldShowVRHud({ presenting: true, phase: 'paused', menuVisible: false })).toBe(true);
    expect(shouldShowVRHud({ presenting: true, phase: 'results', menuVisible: false })).toBe(true);
    expect(shouldShowVRHud({ presenting: false, phase: 'playing', menuVisible: false })).toBe(false);
    expect(shouldShowVRHud({ presenting: true, phase: 'playing', menuVisible: true })).toBe(false);
    expect(shouldShowVRHud({ presenting: true, phase: 'menu', menuVisible: false })).toBe(false);
  });

  it('throttles texture uploads to ten hertz unless feedback forces a redraw', () => {
    expect(shouldRefreshVRHud(Number.NaN, 0)).toBe(true);
    expect(shouldRefreshVRHud(1000, 1000 + VR_HUD_REFRESH_MS - 1)).toBe(false);
    expect(shouldRefreshVRHud(1000, 1000 + VR_HUD_REFRESH_MS)).toBe(true);
    expect(shouldRefreshVRHud(1000, 1001, true)).toBe(true);
  });
});

describe('VRHud score data and feedback', () => {
  it('normalizes timer, progress and competitive counters for the 3D panel', () => {
    const data = normalizeVRHudData({
      time: 73.8,
      duration: 120,
      mode: 'auto',
      phase: 'playing',
      title: 'Neon Tide Run',
      state: { score: 12345.4, combo: 17, multiplier: 4, accuracy: 0.9874, hits: 18, misses: 1, health: 92 },
    });

    expect(formatHudTime(data.time)).toBe('01:13');
    expect(formatHudTime(data.duration)).toBe('02:00');
    expect(data).toMatchObject({ score: 12345, combo: 17, multiplier: 4, hits: 18, misses: 1, health: 92, mode: 'auto', phase: 'playing' });
    expect(data.progress).toBeCloseTo(0.615, 3);
    expect(data.accuracy).toBeCloseTo(0.9874, 4);
  });

  it('shows a reusable Quest-friendly HUD group and themed hit banner without DOM globals', () => {
    const hud = new VRHud({ lowPower: true });
    const standingViewAngle = Math.atan2(hud.group.position.y - 1.65, Math.abs(hud.group.position.z - 0.18)) * 180 / Math.PI;
    expect(standingViewAngle).toBeGreaterThan(-35);
    hud.setPresenting(true);
    hud.setMenuVisible(false);
    hud.update({ phase: 'playing', time: 10, duration: 60, state: { score: 900, combo: 3, accuracy: 1 } }, { force: true, now: 1000 });
    expect(hud.group.visible).toBe(true);
    expect(hud.group.getObjectByName('vr-hud-display')).toBeTruthy();
    expect(hud.group.getObjectByName('vr-hud-halo')?.material?.transparent).toBe(true);

    hud.flashHit({ noteScore: 115, judgement: { automatic: true }, hand: 'left', color: 0x43d9ff });
    expect(hud.feedback).toMatchObject({ label: 'AI PERFECT', score: '+115', side: -1, miss: false });
    hud.setMenuVisible(true);
    expect(hud.group.visible).toBe(false);
    hud.dispose();
  });

  it('uses stronger, longer damage haptics than normal hits', () => {
    const normal = createHapticProfile({ lowPower: true });
    const damage = createHapticProfile({ hurt: true, lowPower: true });
    expect(damage.intensity).toBeGreaterThan(normal.intensity);
    expect(damage.duration).toBeGreaterThan(normal.duration);
  });
});
