import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  VRMenu,
  VR_MENU_ACTIONS,
  VR_MENU_MODE_LABELS,
  VR_MENU_MODES,
  VR_MENU_PAGE_SIZE,
  VR_MENU_SCREENS,
  VR_MENU_TEXT,
  createVRMenuState,
  getVRMenuControls,
  normalizeVRMenuResults,
  reduceVRMenuAction,
  vrTrackStyle,
  vrTrackTitle,
} from './VRMenu.js';

const TRACKS = Array.from({ length: 10 }, (_, index) => ({
  id: `track-${index + 1}`,
  title: `曲目 ${index + 1}`,
  bpm: 100 + index,
}));

describe('VR 中文菜单状态', () => {
  it('将十首曲目分成两页并限制翻页范围', () => {
    let state = createVRMenuState({ tracks: TRACKS });
    expect(VR_MENU_PAGE_SIZE).toBe(5);
    expect(state).toMatchObject({ page: 0, pages: 2, selectedTrackId: 'track-1', screen: VR_MENU_SCREENS.SELECTION });

    state = reduceVRMenuAction(state, { type: VR_MENU_ACTIONS.PAGE, delta: 1 }, TRACKS);
    expect(state.page).toBe(1);
    state = reduceVRMenuAction(state, { type: VR_MENU_ACTIONS.PAGE, delta: 99 }, TRACKS);
    expect(state.page).toBe(1);
    state = reduceVRMenuAction(state, { type: VR_MENU_ACTIONS.PAGE, delta: -99 }, TRACKS);
    expect(state.page).toBe(0);
  });

  it('支持标准、AI 自动和纯享三种模式', () => {
    expect(VR_MENU_MODES).toEqual(['standard', 'auto', 'zen']);
    expect(VR_MENU_MODE_LABELS).toEqual({ standard: '标准模式', auto: 'AI 自动', zen: '纯享模式' });
    for (const mode of VR_MENU_MODES) {
      expect(reduceVRMenuAction(createVRMenuState({ tracks: TRACKS }), { type: VR_MENU_ACTIONS.MODE, mode }, TRACKS).mode).toBe(mode);
    }
    expect(reduceVRMenuAction(createVRMenuState({ tracks: TRACKS }), { type: VR_MENU_ACTIONS.MODE, mode: 'invalid' }, TRACKS).mode).toBe('standard');
  });

  it('三个界面的关键按钮全部使用中文且动作完整', () => {
    const selection = getVRMenuControls(createVRMenuState({ tracks: TRACKS }), TRACKS);
    const pause = getVRMenuControls(createVRMenuState({ tracks: TRACKS, screen: VR_MENU_SCREENS.PAUSE }), TRACKS);
    const results = getVRMenuControls(createVRMenuState({ tracks: TRACKS, screen: VR_MENU_SCREENS.RESULTS }), TRACKS);

    expect(selection.map(({ action }) => action.type)).toEqual(expect.arrayContaining([
      VR_MENU_ACTIONS.TRACK,
      VR_MENU_ACTIONS.PAGE,
      VR_MENU_ACTIONS.MODE,
      VR_MENU_ACTIONS.START,
    ]));
    expect(pause.map(({ action }) => action.type)).toEqual([
      VR_MENU_ACTIONS.RESUME,
      VR_MENU_ACTIONS.RESTART,
      VR_MENU_ACTIONS.RETURN_TO_SELECTION,
    ]);
    expect(results.map(({ action }) => action.type)).toEqual([
      VR_MENU_ACTIONS.PLAY_AGAIN,
      VR_MENU_ACTIONS.RETURN_TO_SELECTION,
    ]);

    const fixedLabels = [
      ...Object.values(VR_MENU_TEXT),
      ...Object.values(VR_MENU_MODE_LABELS),
      ...pause.map(({ label }) => label),
      ...results.map(({ label }) => label),
    ];
    expect(fixedLabels.every((label) => /[\u3400-\u9fff]/u.test(label))).toBe(true);
  });

  it('规范化结算的总分、命中、最高连击和准度', () => {
    expect(normalizeVRMenuResults({ score: 12345.6, hits: 80.2, bestCombo: 28, accuracy: 1.4 })).toEqual({
      score: 12346,
      hits: 80,
      maxCombo: 28,
      accuracy: 1,
    });
  });

  it('内置曲目优先显示中文名与中文编曲方向', () => {
    const track = {
      id: 'neon-tide-run',
      title: 'Neon Tide Run',
      bpm: 132,
      metadata: { titleZh: '霓虹潮汐', style: 'liquid synthwave sprint' },
    };
    const controls = getVRMenuControls(createVRMenuState({ tracks: [track] }), [track]);

    expect(vrTrackTitle(track)).toBe('霓虹潮汐');
    expect(vrTrackStyle(track)).toBe('流动合成波');
    expect(controls.find(({ action }) => action.type === VR_MENU_ACTIONS.TRACK)?.label).toBe('霓虹潮汐');
    expect(vrTrackStyle(track)).not.toContain('synthwave');
  });
});

describe('VR 菜单手柄交互与动作 API', () => {
  it('手柄射线可悬停并按扳机选择曲目', () => {
    const onAction = vi.fn();
    const menu = new VRMenu({ tracks: TRACKS, onAction });
    menu.setVisible(true);

    const controller = new THREE.Group();
    controller.position.set(0, menu.group.position.y + 0.76, 0);

    expect(menu.updateController(controller)).toEqual({ type: VR_MENU_ACTIONS.TRACK, trackId: 'track-1' });
    expect(menu.hovered?.userData?.menuAction?.trackId).toBe('track-1');
    expect(controller.getObjectByName('rift-menu-ray')?.visible).toBe(true);
    expect(controller.getObjectByName('rift-menu-reticle')?.visible).toBe(true);

    expect(menu.select(controller)).toBe(true);
    expect(menu.state.selectedTrackId).toBe('track-1');
    expect(onAction).toHaveBeenCalledWith(
      { type: VR_MENU_ACTIONS.TRACK, trackId: 'track-1' },
      expect.objectContaining({ selectedTrackId: 'track-1', screen: VR_MENU_SCREENS.SELECTION }),
      expect.any(Object),
    );
    disposeObject(controller);
    menu.dispose();
  });

  it('公开选曲、暂停与结算状态切换，并派发所有流程动作', () => {
    const onAction = vi.fn();
    const menu = new VRMenu({ tracks: TRACKS, selectedTrackId: 'track-2', mode: 'auto', onAction });

    expect(menu.activate({ type: VR_MENU_ACTIONS.START })).toEqual({
      type: VR_MENU_ACTIONS.START,
      trackId: 'track-2',
      mode: 'auto',
    });

    expect(menu.showPause().screen).toBe(VR_MENU_SCREENS.PAUSE);
    expect(menu.hitTargets.map((target) => target.userData.menuAction.type)).toEqual([
      VR_MENU_ACTIONS.RESUME,
      VR_MENU_ACTIONS.RESTART,
      VR_MENU_ACTIONS.RETURN_TO_SELECTION,
    ]);
    expect(menu.activate({ type: VR_MENU_ACTIONS.RESUME })).toEqual({ type: VR_MENU_ACTIONS.RESUME });
    expect(menu.activate({ type: VR_MENU_ACTIONS.RESTART })).toEqual({
      type: VR_MENU_ACTIONS.RESTART,
      trackId: 'track-2',
      mode: 'auto',
    });
    expect(menu.activate({ type: VR_MENU_ACTIONS.RETURN_TO_SELECTION })).toEqual({ type: VR_MENU_ACTIONS.RETURN_TO_SELECTION });
    expect(menu.snapshot().screen).toBe(VR_MENU_SCREENS.SELECTION);

    expect(menu.showResults({ score: 8800, hits: 70, maxCombo: 24, accuracy: 0.965 })).toMatchObject({
      screen: VR_MENU_SCREENS.RESULTS,
      results: { score: 8800, hits: 70, maxCombo: 24, accuracy: 0.965 },
    });
    expect(menu.activate({ type: VR_MENU_ACTIONS.PLAY_AGAIN })).toEqual({
      type: VR_MENU_ACTIONS.PLAY_AGAIN,
      trackId: 'track-2',
      mode: 'auto',
    });
    expect(onAction.mock.calls.map(([action]) => action.type)).toEqual([
      VR_MENU_ACTIONS.START,
      VR_MENU_ACTIONS.RESUME,
      VR_MENU_ACTIONS.RESTART,
      VR_MENU_ACTIONS.RETURN_TO_SELECTION,
      VR_MENU_ACTIONS.PLAY_AGAIN,
    ]);
    menu.dispose();
  });

  it('外部选择曲目时同步切换到对应页', () => {
    const menu = new VRMenu({ tracks: TRACKS });
    menu.setTrack('track-8');
    expect(menu.snapshot()).toMatchObject({ page: 1, pages: 2, selectedTrackId: 'track-8' });
    expect(menu.hitTargets.filter((target) => target.userData.menuAction?.type === VR_MENU_ACTIONS.TRACK)).toHaveLength(5);
    menu.dispose();
  });
});

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
  });
}
