import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  VR_HUD_ACTIONS,
  VR_HUD_MODE_LABELS,
  VR_HUD_PHASE_LABELS,
  VR_HUD_REFRESH_MS,
  VR_HUD_TEXT,
  VRHud,
  createHapticProfile,
  formatHudTime,
  getVRHudControls,
  localizeVRHudMiss,
  normalizeVRHudData,
  shouldRefreshVRHud,
  shouldShowVRHud,
} from './VRHud.js';

describe('VRHud 呈现规则', () => {
  it('只在沉浸式游戏界面显示且不会覆盖 VR 菜单', () => {
    expect(shouldShowVRHud({ presenting: true, phase: 'playing', menuVisible: false })).toBe(true);
    expect(shouldShowVRHud({ presenting: true, phase: 'paused', menuVisible: false })).toBe(true);
    expect(shouldShowVRHud({ presenting: true, phase: 'results', menuVisible: false })).toBe(true);
    expect(shouldShowVRHud({ presenting: false, phase: 'playing', menuVisible: false })).toBe(false);
    expect(shouldShowVRHud({ presenting: true, phase: 'playing', menuVisible: true })).toBe(false);
    expect(shouldShowVRHud({ presenting: true, phase: 'menu', menuVisible: false })).toBe(false);
  });

  it('默认以十赫兹刷新纹理，强制反馈可立即刷新', () => {
    expect(shouldRefreshVRHud(Number.NaN, 0)).toBe(true);
    expect(shouldRefreshVRHud(1000, 1000 + VR_HUD_REFRESH_MS - 1)).toBe(false);
    expect(shouldRefreshVRHud(1000, 1000 + VR_HUD_REFRESH_MS)).toBe(true);
    expect(shouldRefreshVRHud(1000, 1001, true)).toBe(true);
  });
});

describe('VRHud 中文数据与反馈', () => {
  it('规范化计时、进度、最高连击与竞技数据', () => {
    const data = normalizeVRHudData({
      time: 73.8,
      duration: 120,
      mode: 'auto',
      phase: 'playing',
      title: '霓虹浪潮',
      state: { score: 12345.4, combo: 17, bestCombo: 25, multiplier: 4, accuracy: 0.9874, hits: 18, misses: 1, health: 92 },
    });

    expect(formatHudTime(data.time)).toBe('01:13');
    expect(formatHudTime(data.duration)).toBe('02:00');
    expect(data).toMatchObject({ score: 12345, combo: 17, maxCombo: 25, multiplier: 4, hits: 18, misses: 1, health: 92, mode: 'auto', phase: 'playing' });
    expect(data.progress).toBeCloseTo(0.615, 3);
    expect(data.accuracy).toBeCloseTo(0.9874, 4);
  });

  it('所有固定 HUD 文案、模式和阶段均为中文', () => {
    const labels = [
      ...Object.values(VR_HUD_TEXT),
      ...Object.values(VR_HUD_MODE_LABELS),
      ...Object.values(VR_HUD_PHASE_LABELS),
      localizeVRHudMiss('wrong-direction'),
      localizeVRHudMiss('OBSTACLE'),
    ];
    expect(labels.every((label) => /[\u3400-\u9fff]/u.test(label))).toBe(true);
    expect(localizeVRHudMiss('wrong-direction')).toBe('方向错误');
    expect(localizeVRHudMiss('OBSTACLE')).toBe('撞上障碍');
    expect(localizeVRHudMiss('unknown-runtime-reason')).toBe('未命中');
  });

  it('显示适合 Quest 的三维 HUD，并产生中文命中与受伤反馈', () => {
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
    expect(hud.feedback).toMatchObject({ label: 'AI 完美', score: '+115', side: -1, miss: false });
    hud.flashMiss('wrong-direction');
    expect(hud.feedback).toMatchObject({ label: '方向错误', score: '连击中断', miss: true });
    hud.setMenuVisible(true);
    expect(hud.group.visible).toBe(false);
    hud.dispose();
  });
});

describe('VRHud 手柄交互动作', () => {
  it('游戏、暂停与结算阶段公开完整中文操作', () => {
    expect(getVRHudControls('playing')).toEqual([
      expect.objectContaining({ label: '暂停', action: { type: VR_HUD_ACTIONS.PAUSE } }),
    ]);
    expect(getVRHudControls('paused').map(({ action }) => action.type)).toEqual([
      VR_HUD_ACTIONS.RESUME,
      VR_HUD_ACTIONS.RESTART,
      VR_HUD_ACTIONS.RETURN_TO_SELECTION,
    ]);
    expect(getVRHudControls('results').map(({ action }) => action.type)).toEqual([
      VR_HUD_ACTIONS.PLAY_AGAIN,
      VR_HUD_ACTIONS.RETURN_TO_SELECTION,
    ]);
    expect([
      ...getVRHudControls('playing'),
      ...getVRHudControls('paused'),
      ...getVRHudControls('results'),
    ].every(({ label }) => /[\u3400-\u9fff]/u.test(label))).toBe(true);
  });

  it('手柄射线可以瞄准 HUD 暂停按钮并派发动作', () => {
    const onAction = vi.fn();
    const hud = new VRHud({ onAction });
    hud.setPresenting(true);
    hud.update({ phase: 'playing', duration: 60, state: {} }, { force: true, now: 1000 });
    hud.group.updateWorldMatrix(true, true);

    const pauseTarget = hud.hitTargets.find((target) => target.userData.hudAction?.type === VR_HUD_ACTIONS.PAUSE);
    const world = pauseTarget.getWorldPosition(new THREE.Vector3());
    const controller = new THREE.Group();
    controller.position.set(world.x, world.y, 0);

    expect(hud.updateController(controller)).toEqual({ type: VR_HUD_ACTIONS.PAUSE });
    expect(controller.getObjectByName('rift-hud-ray')?.visible).toBe(true);
    expect(controller.getObjectByName('rift-hud-reticle')?.visible).toBe(true);
    expect(hud.select(controller)).toBe(true);
    expect(onAction).toHaveBeenCalledWith({ type: VR_HUD_ACTIONS.PAUSE }, expect.objectContaining({ phase: 'playing', visible: true }));

    hud.setMenuVisible(true);
    expect(controller.getObjectByName('rift-hud-ray')?.visible).toBe(false);
    disposeObject(controller);
    hud.dispose();
  });

  it('可派发继续、重新开始、返回选曲和再来一次', () => {
    const onAction = vi.fn();
    const hud = new VRHud({ onAction });
    hud.setPhase('paused');
    for (const type of [VR_HUD_ACTIONS.RESUME, VR_HUD_ACTIONS.RESTART, VR_HUD_ACTIONS.RETURN_TO_SELECTION]) {
      expect(hud.activate({ type })).toEqual({ type });
    }
    hud.setPhase('results');
    for (const type of [VR_HUD_ACTIONS.PLAY_AGAIN, VR_HUD_ACTIONS.RETURN_TO_SELECTION]) {
      expect(hud.activate({ type })).toEqual({ type });
    }
    expect(onAction.mock.calls.map(([action]) => action.type)).toEqual([
      VR_HUD_ACTIONS.RESUME,
      VR_HUD_ACTIONS.RESTART,
      VR_HUD_ACTIONS.RETURN_TO_SELECTION,
      VR_HUD_ACTIONS.PLAY_AGAIN,
      VR_HUD_ACTIONS.RETURN_TO_SELECTION,
    ]);
    hud.dispose();
  });

  it('受伤震动强于普通命中', () => {
    const normal = createHapticProfile({ lowPower: true });
    const damage = createHapticProfile({ hurt: true, lowPower: true });
    expect(damage.intensity).toBeGreaterThan(normal.intensity);
    expect(damage.duration).toBeGreaterThan(normal.duration);
  });
});

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
  });
}
