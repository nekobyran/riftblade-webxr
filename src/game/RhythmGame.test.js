import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CutDirection, GameplayEvent, Hand } from '../shared/contracts.js';
import { TRACKS, createBeatmap } from '../data/tracks.js';
import {
  GAME_MODES,
  RhythmGame,
  approachDistanceFromViewer,
  autoPerfectJudgement,
  createBeatmapFromTrack,
  displayTrackTitle,
  directionRotationZ,
  evaluateTouchSwipe,
  isAutoPerfectMoment,
  noteVisualTransform,
  shouldFinishMode,
} from './RhythmGame.js';
import { laneToX, rowToY } from './RhythmLogic.js';
import { VR_MENU_ACTIONS } from './VRMenu.js';

describe('RhythmGame track integration', () => {
  it.each(TRACKS.map((track) => [track.id, track]))('uses the authored deterministic beatmap for %s', (_id, track) => {
    const expected = createBeatmap(track);
    const actual = createBeatmapFromTrack(track);

    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(40);
    expect(new Set(actual.map((note) => note.direction)).size).toBeGreaterThan(3);
  });

  it('retains a safe generated fallback for unknown custom tracks', () => {
    const notes = createBeatmapFromTrack({ id: 'guest-rift', bpm: 120, duration: 30 });
    expect(notes.length).toBeGreaterThan(10);
    expect(notes.every((note) => note.id.startsWith('guest-rift-'))).toBe(true);
  });
});

describe('stable Beat Saber-style note visuals', () => {
  const eightDirections = Object.values(CutDirection).filter((direction) => direction !== CutDirection.ANY);

  it('keeps every flying block front-facing while only its arrow encodes eight directions', () => {
    const rotations = new Set();
    for (const direction of eightDirections) {
      const atSpawn = noteVisualTransform({ time: 10, lane: -1.5, row: 0, hand: Hand.LEFT, direction }, 8);
      const atHit = noteVisualTransform({ time: 10, lane: -1.5, row: 0, hand: Hand.LEFT, direction }, 10);
      expect(atSpawn.rotation).toEqual({ x: 0, y: 0, z: 0 });
      expect(atHit.rotation).toEqual({ x: 0, y: 0, z: 0 });
      expect(atHit.arrowRotationZ).toBe(directionRotationZ(direction));
      rotations.add(atHit.arrowRotationZ.toFixed(5));
    }
    expect(rotations).toHaveLength(8);
  });

  it('builds a flat high-contrast face arrow instead of a spinning 3D cone', () => {
    const game = new RhythmGame({ canvas: {} });
    const arrow = game._createDirectionArrow(CutDirection.DOWN_RIGHT, false);
    const face = arrow.getObjectByName('direction-arrow-face');
    const glow = arrow.getObjectByName('direction-arrow-glow');

    expect(face?.geometry?.type).toBe('ShapeGeometry');
    expect(face?.material?.color.getHex()).toBe(0xffffff);
    expect(arrow.children).toHaveLength(3);
    expect(arrow.children.some((child) => child.material?.color?.getHex() === 0x070914)).toBe(true);
    expect(glow?.material?.blending).toBe(THREE.AdditiveBlending);
    expect(glow?.material?.toneMapped).toBe(false);
    expect(glow?.material?.opacity).toBeLessThanOrEqual(0.12);
    expect(glow?.scale.x).toBeCloseTo(1.28, 5);
    expect(Math.max(glow.material.color.r, glow.material.color.g, glow.material.color.b)).toBeLessThan(0.8);
    expect(arrow.userData).toMatchObject({ hdrGlow: false, glowProfile: 'restrained' });
    expect(arrow.position.z).toBeGreaterThan(0.16);
    expect(arrow.rotation.z).toBeCloseTo(directionRotationZ(CutDirection.DOWN_RIGHT), 6);
    for (const child of arrow.children) {
      child.geometry?.dispose();
      child.material?.dispose();
    }
  });

  it('allows only a restrained accent lift instead of a second light-pollution source', () => {
    const game = new RhythmGame({ canvas: {} });
    const arrow = game._createDirectionArrow(CutDirection.UP, true, 0x7defff);
    const glow = arrow.getObjectByName('direction-arrow-glow');

    expect(glow?.material?.opacity).toBeLessThanOrEqual(0.18);
    expect(glow?.scale.x).toBeLessThanOrEqual(1.34);
    expect(Math.max(glow.material.color.r, glow.material.color.g, glow.material.color.b)).toBeLessThanOrEqual(1.05);
    expect(arrow.userData).toMatchObject({ hdrGlow: true, glowProfile: 'restrained' });

    arrow.traverse((child) => {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    });
  });

  it('wraps each blade in an additive aura and a coloured local light', () => {
    const game = new RhythmGame({ canvas: {} });
    game.lowPower = false;
    const saber = game._createSaber(Hand.LEFT);

    expect(saber.getObjectByName('left-blade-aura')?.material?.blending).toBe(THREE.AdditiveBlending);
    expect(saber.getObjectByName('left-blade-bloom-spill')?.material?.blending).toBe(THREE.AdditiveBlending);
    expect(saber.getObjectByName('left-blade-core')?.material?.toneMapped).toBe(false);
    const light = saber.getObjectByName('left-blade-light');
    expect(light?.isPointLight).toBe(true);
    expect(light?.intensity).toBeGreaterThan(5);
    expect(light?.userData.environmentSpill).toBe(true);
    expect(saber.userData.realLightEmitter).toBe(true);

    saber.traverse((child) => {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    });
  });

  it('turns real desktop and XR saber poses into a persistent speed-responsive world trail', () => {
    const game = new RhythmGame({ canvas: {} });
    game.scene = new THREE.Scene();
    game.player = new THREE.Group();
    game.scene.add(game.player);
    game.renderer = { xr: { isPresenting: false } };
    const controller = new THREE.Group();
    controller.userData.hand = Hand.LEFT;
    controller.userData.saber = game._createSaber(Hand.LEFT);
    controller.add(controller.userData.saber);
    controller.userData.saberTrail = game._createSaberTrail(Hand.LEFT);
    game.player.add(controller);
    game.controllers = [controller];
    game.controllerState.set(controller, {
      hand: Hand.LEFT,
      previous: new THREE.Vector3(),
      current: new THREE.Vector3(),
      initialized: false,
    });

    game._updateControllers(0);
    controller.position.x = 0.45;
    game._updateControllers(0.025);

    const trail = controller.userData.saberTrail;
    expect(trail.visibleSegmentCount).toBeGreaterThan(0);
    expect(trail.currentSpeed).toBeGreaterThan(5);
    expect(trail.glowMesh.material.blending).toBe(THREE.AdditiveBlending);
    expect(trail.group.parent).toBe(game.scene);
    trail.dispose();
    controller.userData.saber.traverse((child) => {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    });
  });

  it('uses Chinese built-in track titles in every immersive surface', () => {
    expect(displayTrackTitle({ title: 'Neon Tide Run', metadata: { titleZh: '霓虹潮汐' } })).toBe('霓虹潮汐');
    expect(displayTrackTitle({})).toBe('未命名曲目');
  });

  it('mounts a genuine procedural 3D black hole behind the themed stage', () => {
    const game = new RhythmGame({ canvas: {} });
    game.scene = new THREE.Scene();
    game.scene.add(game.environmentGroup);

    game._buildEnvironment('void');

    const blackHole = game.scene.getObjectByName('black-hole-backdrop');
    expect(blackHole).toBe(game.blackHoleBackdrop.group);
    expect(blackHole.position.toArray()).toEqual([0, 5.4, -23.5]);
    expect(blackHole.getObjectByName('black-hole-event-horizon')).toBeTruthy();
    expect(blackHole.getObjectByName('black-hole-accretion-disk-volume')?.material?.isShaderMaterial).toBe(true);
    expect(blackHole.getObjectByName('black-hole-gravitational-lens')).toBeTruthy();
    expect(blackHole.getObjectByName('black-hole-relativistic-jets')).toBeTruthy();
    expect(game.cosmicBackdrop).toBeTruthy();
    game.dispose();
  });

  it('places the hit plane within one metre of the desktop and XR viewer', () => {
    expect(approachDistanceFromViewer(0.18)).toBeCloseTo(1, 5);
    expect(approachDistanceFromViewer(0)).toBeLessThan(0.9);
  });
});

describe('automatic and pure-enjoyment modes', () => {
  it('resolves automatic notes at their authored timestamp with a Perfect judgement', () => {
    const note = { time: 12.5 };
    expect(isAutoPerfectMoment(note, 12.499)).toBe(false);
    expect(isAutoPerfectMoment(note, 12.5)).toBe(true);
    expect(autoPerfectJudgement()).toMatchObject({ timing: 0, automatic: true, quality: 'perfect' });
  });

  it('does not let an empty runtime end pure mode after half a second', () => {
    expect(shouldFinishMode({ mode: GAME_MODES.ZEN, elapsed: 0.51, trackDuration: 80, runtimeComplete: true })).toBe(false);
    expect(shouldFinishMode({ mode: GAME_MODES.ZEN, elapsed: 79.99, trackDuration: 80, runtimeComplete: true })).toBe(false);
    expect(shouldFinishMode({ mode: GAME_MODES.ZEN, elapsed: 80, trackDuration: 80, runtimeComplete: false })).toBe(true);
    expect(shouldFinishMode({ mode: GAME_MODES.STANDARD, elapsed: 0.6, runtimeComplete: true })).toBe(true);
  });

  it('visibly drives the desktop AI sabers into the authored note lane and row', () => {
    const game = new RhythmGame({ canvas: {}, music: { getTime: () => 12 } });
    const controller = new THREE.Group();
    controller.visible = false;
    controller.matrixAutoUpdate = false;
    controller.userData.hand = Hand.LEFT;
    game.controllers = [controller];
    game.renderer = { xr: { isPresenting: false } };
    game.phase = 'playing';
    game.mode = GAME_MODES.AUTO;
    game.runtime.active = [{ time: 12, lane: -0.5, row: 1, hand: Hand.LEFT, direction: CutDirection.RIGHT }];

    game._updateDesktopSabers();

    expect(controller.position.x).toBeCloseTo(laneToX(-0.5), 5);
    expect(controller.position.y).toBeCloseTo(rowToY(1), 5);
    expect(controller.rotation.z).toBeCloseTo(directionRotationZ(CutDirection.RIGHT), 5);
    expect(controller.visible).toBe(true);
    expect(controller.matrixAutoUpdate).toBe(true);
  });

  it('completes the first real hit with particles, ring, shards, score and HUD feedback', () => {
    const game = new RhythmGame({ canvas: {}, music: { getTime: () => 2 } });
    const note = { id: 'first-hit', time: 2, lane: -0.5, row: 0, hand: Hand.LEFT, direction: CutDirection.UP, accent: true };
    game.scene = new THREE.Scene();
    game.track = { id: 'qa-track', title: 'QA Track', duration: 30 };
    game.phase = 'playing';
    game.runtime.active = [note];
    game.vrHud = { flashHit: vi.fn(), update: vi.fn() };

    expect(() => game._hitNote(note, autoPerfectJudgement())).not.toThrow();
    expect(game.score.snapshot()).toMatchObject({ hits: 1, combo: 1 });
    expect(game.damageEffects.some((effect) => effect.userData.kind === 'hit')).toBe(true);
    expect(game.damageEffects.some((effect) => effect.userData.kind === 'impact-ring')).toBe(true);
    expect(game.damageEffects.some((effect) => effect.userData.kind === 'split-shards')).toBe(true);
    expect(game.vrHud.flashHit).toHaveBeenCalledWith(expect.objectContaining({ noteScore: expect.any(Number) }), { redraw: false });
    expect(game.vrHud.update).toHaveBeenCalledWith(expect.objectContaining({ state: expect.objectContaining({ hits: 1 }) }));
    game._clearDamageEffects();
  });
});

describe('cross-surface interaction API', () => {
  it('keeps the immersive 3D HUD phase, timer and score live between hits', () => {
    const game = new RhythmGame({ canvas: {}, music: { getTime: () => 12.5 } });
    game.track = { id: 'hud-track', title: 'HUD Track', duration: 90 };
    game.vrHud = { update: vi.fn() };

    game._setPhase('playing');
    game._emitTick(13.2);

    expect(game.vrHud.update).toHaveBeenNthCalledWith(1, expect.objectContaining({ phase: 'playing', time: 12.5, duration: 90, title: 'HUD Track' }), { force: true });
    expect(game.vrHud.update).toHaveBeenNthCalledWith(2, expect.objectContaining({ phase: 'playing', time: 13.2, duration: 90, state: expect.objectContaining({ score: 0 }) }));
  });

  it('preserves the final song time in the results HUD after audio stops', () => {
    let time = 78.4;
    const music = { getTime: () => time, stop: vi.fn(() => { time = 0; }) };
    const game = new RhythmGame({ canvas: {}, music });
    game.phase = 'playing';
    game.track = { id: 'results-track', title: 'Results Track', duration: 80 };
    game.beatmap = [{ id: 'done' }];
    game.vrHud = { update: vi.fn() };
    game._emit = vi.fn();

    game._finish(false);

    expect(music.stop).toHaveBeenCalledOnce();
    expect(game.vrHud.update).toHaveBeenCalledWith(expect.objectContaining({ phase: 'results', time: 78.4 }), { force: true });
    expect(game.score.snapshot().endedAt).toBe(78.4);
  });

  it('emits track, mode and VR-menu events for in-headset choices', () => {
    const eventTarget = new EventTarget();
    const received = [];
    for (const type of [GameplayEvent.TRACK_SELECT, GameplayEvent.MODE_CHANGE, GameplayEvent.VR_MENU]) {
      eventTarget.addEventListener(type, (event) => received.push([type, event.detail]));
    }
    const game = new RhythmGame({ canvas: {}, eventTarget, tracks: TRACKS.slice(0, 2) });
    game.loadTrack = vi.fn((track) => { game.track = track; });

    game._handleVRMenuAction(
      { type: 'track', trackId: TRACKS[1].id },
      { page: 0, pages: 1, selectedTrackId: TRACKS[1].id, mode: 'standard' },
    );
    game._handleVRMenuAction(
      { type: 'mode', mode: 'auto' },
      { page: 0, pages: 1, selectedTrackId: TRACKS[1].id, mode: 'auto' },
    );

    expect(received.some(([type, detail]) => type === GameplayEvent.TRACK_SELECT && detail.source === 'vr')).toBe(true);
    expect(received.some(([type, detail]) => type === GameplayEvent.MODE_CHANGE && detail.mode === 'auto' && detail.source === 'vr')).toBe(true);
    expect(received.filter(([type]) => type === GameplayEvent.VR_MENU)).toHaveLength(2);
  });

  it('completes pause, continue, replay, results and return-to-selection entirely inside VR', () => {
    const music = { pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), getTime: () => 42 };
    const game = new RhythmGame({ canvas: {}, music });
    game.track = { id: 'vr-flow', title: 'VR Flow', metadata: { titleZh: '沉浸流程' }, duration: 60 };
    game.beatmap = [{ id: 'note' }];
    game.phase = 'playing';
    game.renderer = { xr: { isPresenting: true } };
    game.vrHud = { update: vi.fn(), setMenuVisible: vi.fn() };
    const menu = {
      visible: false,
      state: { selectedTrackId: 'vr-flow', mode: 'standard', screen: 'selection' },
      setTracks: vi.fn(),
      setMode: vi.fn(),
      setVisible: vi.fn((visible) => { menu.visible = visible; }),
      setPhase: vi.fn((phase, results) => {
        menu.state.screen = phase === 'paused' ? 'pause' : phase === 'results' ? 'results' : 'selection';
        menu.state.results = results;
      }),
      snapshot: vi.fn(() => ({ ...menu.state })),
    };
    game.vrMenu = menu;

    game._executeVRAction({ type: VR_MENU_ACTIONS.PAUSE }, menu.state, 'test');
    expect(game.phase).toBe('paused');
    expect(menu.setPhase).toHaveBeenCalledWith('paused', expect.any(Object));
    expect(menu.visible).toBe(true);

    game._executeVRAction({ type: VR_MENU_ACTIONS.RESUME }, menu.state, 'test');
    expect(game.phase).toBe('playing');
    expect(menu.visible).toBe(false);

    game.restart = vi.fn(async () => {});
    game._executeVRAction({ type: VR_MENU_ACTIONS.PLAY_AGAIN }, menu.state, 'test');
    expect(game.restart).toHaveBeenCalledOnce();

    game._finish(false);
    expect(game.phase).toBe('results');
    expect(menu.setPhase).toHaveBeenCalledWith('results', expect.objectContaining({ score: expect.any(Number), accuracy: expect.any(Number) }));
    expect(menu.visible).toBe(true);

    game._executeVRAction({ type: VR_MENU_ACTIONS.RETURN_TO_SELECTION }, menu.state, 'test');
    expect(game.phase).toBe('menu');
    expect(menu.state.screen).toBe('selection');
    expect(menu.visible).toBe(true);
  });

  it('matches direct mobile swipes against all eight fixed arrow directions', () => {
    const gestures = {
      [CutDirection.UP]: [0, -60],
      [CutDirection.DOWN]: [0, 60],
      [CutDirection.LEFT]: [-60, 0],
      [CutDirection.RIGHT]: [60, 0],
      [CutDirection.UP_LEFT]: [-60, -60],
      [CutDirection.UP_RIGHT]: [60, -60],
      [CutDirection.DOWN_LEFT]: [-60, 60],
      [CutDirection.DOWN_RIGHT]: [60, 60],
    };
    for (const [direction, [dx, dy]] of Object.entries(gestures)) {
      expect(evaluateTouchSwipe(direction, 100, 100, 100 + dx, 100 + dy)).toMatchObject({ ready: true, ok: true, direction });
      expect(evaluateTouchSwipe(direction, 100, 100, 100 - dx, 100 - dy).ok).toBe(false);
    }
    expect(evaluateTouchSwipe(CutDirection.ANY, 0, 0, 40, 10).ok).toBe(true);
    expect(evaluateTouchSwipe(CutDirection.RIGHT, 0, 0, 8, 0)).toMatchObject({ ready: false, reason: 'too-short' });
  });

  it('hits the touched note only after a correctly directed, in-time swipe', () => {
    const note = { id: 'touch-note', time: 5, lane: -0.5, row: 0, hand: Hand.LEFT, direction: CutDirection.UP };
    const game = new RhythmGame({ canvas: {}, music: { getTime: () => 5 } });
    game.phase = 'playing';
    game.mode = GAME_MODES.STANDARD;
    game.renderer = { xr: { isPresenting: false } };
    game.runtime.active = [note];
    game._pickTouchNote = vi.fn(() => ({ note, timing: 0 }));
    game._spawnTouchSlash = vi.fn();
    game._hitNote = vi.fn();

    expect(game.beginTouchSlice(7, 100, 120)).toMatchObject({ accepted: true, noteId: 'touch-note' });
    expect(game.updateTouchSlice(7, 100, 70)).toMatchObject({ accepted: true, hit: true, noteId: 'touch-note' });
    expect(game._spawnTouchSlash).toHaveBeenCalledWith(expect.any(Object), note, true);
    expect(game._hitNote).toHaveBeenCalledWith(note, expect.objectContaining({ reason: 'touch-swipe', source: 'touch-swipe' }));
    expect(game.touchSlices.size).toBe(0);
  });

  it('renders a bright themed 3D saber trail for a mobile direction swipe', () => {
    const game = new RhythmGame({ canvas: {} });
    game.scene = new THREE.Scene();
    game.lowPower = true;
    game._spawnTouchSlash(
      { startX: 100, startY: 120, lastX: 100, lastY: 50 },
      { lane: -0.5, row: 0, hand: Hand.LEFT, direction: CutDirection.UP },
      true,
    );

    const slash = game.scene.getObjectByName('touch-saber-slash');
    expect(slash?.getObjectByName('touch-saber-slash-aura')?.material?.blending).toBe(THREE.AdditiveBlending);
    expect(slash?.getObjectByName('touch-saber-slash-light')?.intensity).toBeGreaterThan(1);
    game._clearDamageEffects();
  });

  it('breaks the desktop AI trail when choreography hands off to another note', () => {
    let time = 4;
    const game = new RhythmGame({ canvas: {}, music: { getTime: () => time } });
    const controller = new THREE.Group();
    const trail = { reset: vi.fn() };
    controller.userData.hand = Hand.LEFT;
    controller.userData.saberTrail = trail;
    game.controllers = [controller];
    game.renderer = { xr: { isPresenting: false } };
    game.mode = GAME_MODES.AUTO;
    game.phase = 'playing';
    const first = { id: 'first', hand: Hand.LEFT, time: 4.05, lane: -0.5, row: 0, direction: CutDirection.UP };
    const second = { id: 'second', hand: Hand.LEFT, time: 4.2, lane: 0.5, row: 1, direction: CutDirection.DOWN };

    game.runtime.active = [first];
    game._updateDesktopSabers();
    game._updateDesktopSabers();
    expect(trail.reset).not.toHaveBeenCalled();

    time = 4.12;
    game.runtime.active = [second];
    game._updateDesktopSabers();
    expect(trail.reset).toHaveBeenCalledOnce();
    expect(trail.reset).toHaveBeenCalledWith(4.12);
  });

  it('spawns luminous obstacle walls and settles left-right dodges exactly once', () => {
    const eventTarget = new EventTarget();
    const obstacleEvents = [];
    eventTarget.addEventListener(GameplayEvent.OBSTACLE, (event) => obstacleEvents.push(event.detail));
    const game = new RhythmGame({ canvas: {}, eventTarget, music: { getTime: () => 0 } });
    game.scene = new THREE.Scene();
    game.scene.add(game.obstacleGroup);
    game.player = new THREE.Group();
    game.scene.add(game.player);
    game.renderer = { xr: { isPresenting: false } };
    game.phase = 'playing';
    game.track = { id: 'obstacle-qa', title: 'Obstacle QA', duration: 20 };
    game.obstacleRuntime.reset([{ id: 'wall-a', time: 1, blockedLane: -1, safeLane: 1, accent: true }]);

    game._updateObstacles(0);
    expect(game.obstacleGroup.getObjectByName('obstacle-wall')).toBeTruthy();
    expect(game.obstacleGroup.getObjectByName('obstacle-wall-aura')?.material?.blending).toBe(THREE.AdditiveBlending);
    expect(game.dodge(1)).toMatchObject({ accepted: true, lane: 1 });
    game._updateObstacles(1);

    expect(obstacleEvents).toHaveLength(1);
    expect(obstacleEvents[0]).toMatchObject({ id: 'wall-a', outcome: 'passed', playerLane: 1 });
    expect(game.obstacleMeshes.size).toBe(0);
  });

  it('always pauses desktop play and opens the interactive selector on XR session start', () => {
    const game = new RhythmGame({ canvas: {} });
    game.phase = 'playing';
    game.renderer = { setPixelRatio: vi.fn(), xr: { setFoveation: vi.fn() } };
    game.pause = vi.fn(() => { game.phase = 'paused'; });
    game.openVRMenu = vi.fn();

    game._boundSessionStart();

    expect(game.pause).toHaveBeenCalledOnce();
    expect(game.openVRMenu).toHaveBeenCalledWith('sessionstart');
    expect(game.renderer.xr.setFoveation).toHaveBeenCalled();
  });

  it('exposes one reusable immersive-vr request method for the Material UI CTA', async () => {
    const session = { end: vi.fn() };
    const xr = {
      isSessionSupported: vi.fn(async () => true),
      requestSession: vi.fn(async () => session),
    };
    vi.stubGlobal('navigator', { xr });
    const game = new RhythmGame({ canvas: {} });
    game.renderer = {
      xr: {
        isPresenting: false,
        setSession: vi.fn(async () => {}),
        getSession: vi.fn(() => null),
      },
    };

    await expect(game.enterVR()).resolves.toBe(session);
    expect(xr.requestSession).toHaveBeenCalledWith('immersive-vr', expect.objectContaining({ requiredFeatures: ['local-floor'] }));
    expect(game.renderer.xr.setSession).toHaveBeenCalledWith(session);
    vi.unstubAllGlobals();
  });
});
