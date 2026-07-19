import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { createBeatmap, getTrack } from '../data/tracks.js';
import { trackTitleZh } from '../data/trackLocalization.js';
import { CutDirection, GamePhase, GameplayEvent, Hand } from '../shared/contracts.js';
import {
  BeatmapRuntime,
  DEFAULT_RULES,
  NOTE_PLANE_Z,
  NOTE_ROW_COUNT,
  ObstacleRuntime,
  SPAWN_Z,
  ScoreKeeper,
  createObstacleMap,
  createDesktopSweep,
  directionVector,
  judgeCut,
  laneToX,
  noteWorldPosition,
  rowToY,
} from './RhythmLogic.js';
import { VRMenu, VR_MENU_ACTIONS } from './VRMenu.js';
import { VRHud, VR_HUD_ACTIONS, createHapticProfile } from './VRHud.js';
import { CosmicBackdrop } from './CosmicBackdrop.js';
import { BlackHoleBackdrop } from './BlackHoleBackdrop.js';
import { SaberTrail } from './SaberTrail.js';

export const GAME_MODES = Object.freeze({ STANDARD: 'standard', AUTO: 'auto', ZEN: 'zen' });

export function normalizeGameMode(mode) {
  const value = String(mode || '').toLowerCase();
  if (['auto', 'automatic', 'autoplay'].includes(value)) return GAME_MODES.AUTO;
  if (['zen', 'pure', 'pure-enjoyment', 'visualizer'].includes(value)) return GAME_MODES.ZEN;
  return GAME_MODES.STANDARD;
}

const THEME_PRESETS = Object.freeze({
  neon: {
    key: 'neon',
    fog: 0x090018,
    floor: 0x16092f,
    grid: 0x44e7ff,
    sky: [0x070014, 0x11104a, 0x3f1d79],
    bloom: 0xff3df5,
    accent: 0x43d9ff,
    archetype: 'city',
  },
  magma: {
    key: 'magma',
    fog: 0x180500,
    floor: 0x291007,
    grid: 0xff8a20,
    sky: [0x110303, 0x5f1705, 0xff5a1f],
    bloom: 0xffc04d,
    accent: 0xff542e,
    archetype: 'forge',
  },
  orbit: {
    key: 'orbit',
    fog: 0x031823,
    floor: 0x061a2a,
    grid: 0x8be9ff,
    sky: [0x02141f, 0x0c4366, 0xa1f7ff],
    bloom: 0x8be9ff,
    accent: 0xd4a8ff,
    archetype: 'orbit',
  },
  sakura: { key: 'sakura', fog: 0x170b24, floor: 0x251230, grid: 0xff9fce, sky: [0x10051d, 0x5b1e58, 0xffb2d4], bloom: 0xff6fb7, accent: 0x9df4ff, archetype: 'petals' },
  abyss: { key: 'abyss', fog: 0x010916, floor: 0x020d18, grid: 0x176b99, sky: [0x00040b, 0x002945, 0x00d9d0], bloom: 0x00f5d4, accent: 0x258dff, archetype: 'depth' },
  solar: { key: 'solar', fog: 0x190805, floor: 0x241008, grid: 0xff9b38, sky: [0x160404, 0x8d2008, 0xffe063], bloom: 0xffb12e, accent: 0xfff1a6, archetype: 'sun' },
  ice: { key: 'ice', fog: 0x061424, floor: 0x0a2236, grid: 0x9be8ff, sky: [0x030d1d, 0x174b72, 0xd9fbff], bloom: 0xbceeff, accent: 0x7b8cff, archetype: 'crystal' },
  jungle: { key: 'jungle', fog: 0x06150c, floor: 0x092114, grid: 0x76e65e, sky: [0x031109, 0x145127, 0xb6ff6c], bloom: 0x8cff4f, accent: 0xffdc55, archetype: 'canopy' },
  desert: { key: 'desert', fog: 0x25120a, floor: 0x321a0d, grid: 0xffb85c, sky: [0x1c0808, 0x9b3c19, 0xffd080], bloom: 0xff8e3c, accent: 0x70e7ff, archetype: 'dunes' },
  void: { key: 'void', fog: 0x05020d, floor: 0x0e071b, grid: 0x914dff, sky: [0x010105, 0x18052f, 0xb044ff], bloom: 0xe854ff, accent: 0x59fff2, archetype: 'digital' },
});

const DAMAGE_STYLES = Object.freeze({
  ember: { left: 0xff6033, right: 0xffd166, hurt: 0xff2a00, motion: 'embers' },
  voltaic: { left: 0x54f7ff, right: 0xc45cff, hurt: 0xf4ff5a, motion: 'electric' },
  prism: { left: 0x7fffe5, right: 0xf0abfc, hurt: 0xffffff, motion: 'prism' },
  petal: { left: 0xff8ec8, right: 0xa3f2ff, hurt: 0xffd1e8, motion: 'petal' },
  abyss: { left: 0x18e0cb, right: 0x247bff, hurt: 0x85fff0, motion: 'bubble' },
  solar: { left: 0xff9b2f, right: 0xfff09d, hurt: 0xff4d1f, motion: 'flare' },
  frost: { left: 0xbff4ff, right: 0x7c8cff, hurt: 0xffffff, motion: 'shard' },
  jungle: { left: 0x7dff69, right: 0xffdc55, hurt: 0xd6ff92, motion: 'leaf' },
  sand: { left: 0xffb55c, right: 0x70e7ff, hurt: 0xfff0bd, motion: 'sand' },
  void: { left: 0xb26cff, right: 0x50ffe5, hurt: 0xff55ea, motion: 'glitch' },
});

const TRACK_THEME = Object.freeze({
  'neon-tide-run': 'neon',
  'ember-circuit-choir': 'magma',
  'glass-orbit-monsoon': 'orbit',
  'sakura-ion-reverie': 'sakura',
  'abyss-rail-frenzy': 'abyss',
  'helios-lift': 'solar',
  'cryo-cathedral-lullaby': 'ice',
  'jade-canopy-heartbeat': 'jungle',
  'dune-crown-overture': 'desert',
  'pixel-void-overdrive': 'void',
});

const TRACK_DAMAGE = Object.freeze({
  'neon-tide-run': 'voltaic',
  'ember-circuit-choir': 'ember',
  'glass-orbit-monsoon': 'prism',
  'sakura-ion-reverie': 'petal',
  'abyss-rail-frenzy': 'abyss',
  'helios-lift': 'solar',
  'cryo-cathedral-lullaby': 'frost',
  'jade-canopy-heartbeat': 'jungle',
  'dune-crown-overture': 'sand',
  'pixel-void-overdrive': 'void',
});

const THEME_DAMAGE = Object.freeze({ neon: 'voltaic', magma: 'ember', orbit: 'prism', sakura: 'petal', abyss: 'abyss', solar: 'solar', ice: 'frost', jungle: 'jungle', desert: 'sand', void: 'void' });

const HAND_COLORS = Object.freeze({
  [Hand.LEFT]: 0x43d9ff,
  [Hand.RIGHT]: 0xff4fd8,
});

const TOUCH_HIT_WINDOW = 0.32;
const DESKTOP_SABER_Z = -0.62;

export class RhythmGame {
  constructor({ canvas, eventTarget = new EventTarget(), music = null, tracks = [], mode = GAME_MODES.STANDARD, onVRSelection = null } = {}) {
    if (!canvas) throw new Error('RhythmGame requires a canvas');
    this.canvas = canvas;
    this.eventTarget = eventTarget;
    this.music = music;
    this.tracks = Array.isArray(tracks) ? tracks : [];
    this.mode = normalizeGameMode(mode);
    this.onVRSelection = onVRSelection;
    this.rules = DEFAULT_RULES;
    this.score = new ScoreKeeper(this.rules);
    this.track = null;
    this.beatmap = [];
    this.runtime = new BeatmapRuntime([], this.rules);
    this.obstacleMap = [];
    this.obstacleRuntime = new ObstacleRuntime([], this.rules);
    this.phase = GamePhase.MENU;
    this.clock = new THREE.Clock(false);
    this.fallbackStart = 0;
    this.renderer = null;
    this.composer = null;
    this.bloomPass = null;
    this.scene = null;
    this.camera = null;
    this.player = null;
    this.noteGroup = new THREE.Group();
    this.obstacleGroup = new THREE.Group();
    this.environmentGroup = new THREE.Group();
    this.cosmicBackdrop = null;
    this.blackHoleBackdrop = null;
    this.sabers = new Map();
    this.saberTrails = new Map();
    this.saberTrailSamples = new Map();
    this.controllers = [];
    this.grips = [];
    this.controllerState = new Map();
    this.sweepQueue = [];
    this.noteMeshes = new Map();
    this.obstacleMeshes = new Map();
    this.damageEffects = [];
    this.pendingTimers = new Set();
    this.vrButton = null;
    this.vrMenu = null;
    this.vrHud = null;
    this.desktopPointer = { x: 0, y: 0, active: false };
    this.touchSlices = new Map();
    this.touchRaycaster = new THREE.Raycaster();
    this.touchPointer = new THREE.Vector2();
    this.dodgeState = { lane: 0, targetLane: 0, visualX: 0 };
    this.viewRotation = { yaw: 0, pitch: 0 };
    this.reducedMotion = false;
    this.motionQuery = null;
    this.lowPower = false;
    this.disposed = false;
    this._boundFrame = (time, frame) => this._frame(time, frame);
    this._boundKeyDown = (event) => this._onKeyDown(event);
    this._boundPointerMove = (event) => this._onPointerMove(event);
    this._boundPointerDown = (event) => this._onPointerDown(event);
    this._boundContextMenu = (event) => event.preventDefault();
    this._boundMotionPreferenceChange = (event) => this._setReducedMotion(Boolean(event?.matches));
    this._boundSessionStart = () => {
      this.renderer?.setPixelRatio?.(1);
      this.renderer?.xr?.setFoveation?.(this.lowPower ? 1 : 0.65);
      this._resetDodge();
      // Entering a headset must never strand the player in a desktop-only
      // state. Pause an already-running desktop session and always surface the
      // ray-interactive selector at the start of the XR session.
      if (this.phase === GamePhase.PLAYING) this.pause();
      this.vrHud?.setPresenting?.(true);
      this.vrMenu?.showSelection?.();
      this.openVRMenu('sessionstart');
      if (this.vrButton) this.vrButton.textContent = '退出 VR';
      this._emit(GameplayEvent.XR_CHANGE, { active: true, presenting: true, supported: true });
    };
    this._boundSessionEnd = () => {
      this.closeVRMenu('sessionend');
      this._resetDodge();
      this.vrHud?.setPresenting?.(false);
      this.renderer?.setPixelRatio?.(Math.min(globalThis.devicePixelRatio || 1, this.lowPower ? 1.2 : 1.75));
      if (this.vrButton) this.vrButton.textContent = '进入 VR';
      this._emit(GameplayEvent.XR_CHANGE, { active: false, presenting: false, supported: true });
    };
  }

  async initialize() {
    if (this.renderer) return;
    this.motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
    this.reducedMotion = Boolean(this.motionQuery?.matches);
    if (this.motionQuery?.addEventListener) this.motionQuery.addEventListener('change', this._boundMotionPreferenceChange);
    else this.motionQuery?.addListener?.(this._boundMotionPreferenceChange);
    this.lowPower = Boolean(
      globalThis.matchMedia?.('(pointer: coarse)').matches
      || (Number(globalThis.navigator?.deviceMemory) > 0 && Number(globalThis.navigator?.deviceMemory) <= 4),
    );
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x090018, 0.035);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
    // Keep the desktop viewpoint on the same ergonomic origin as room-scale
    // XR. The judgement plane is now about one metre from the viewer rather
    // than several metres down the tunnel.
    this.camera.position.set(0, 1.65, 0.18);
    this.camera.rotation.order = 'YXZ';
    this.player = new THREE.Group();
    this.player.add(this.camera);
    this.scene.add(this.player);
    this.scene.add(this.environmentGroup);
    this.scene.add(this.noteGroup);
    this.scene.add(this.obstacleGroup);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    this.renderer.xr.setFramebufferScaleFactor?.(this.lowPower ? 0.78 : 0.92);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = !this.lowPower;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, this.lowPower ? 1.2 : 1.75));
    this.renderer.setClearColor(0x050008, 1);
    this.renderer.xr.addEventListener('sessionstart', this._boundSessionStart);
    this.renderer.xr.addEventListener('sessionend', this._boundSessionEnd);

    this._buildLights();
    this._buildEnvironment('neon');
    this._setupControllers();
    await this._setupPostProcessing();
    this._setupVRMenu();
    this._setupVRHud();
    this._setupDesktopControls();
    this._createEnterVrButton();
    this.resize();
    this.renderer.setAnimationLoop(this._boundFrame);
    this._setPhase(GamePhase.MENU);
  }

  async _setupPostProcessing() {
    if (!this.renderer || !this.scene || !this.camera || this.lowPower || this.reducedMotion) return;
    try {
      // XR bypasses post processing, so Quest/mobile never downloads this
      // desktop-only bloom chunk. Light bands and emissive materials remain.
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }] = await Promise.all([
        import('three/examples/jsm/postprocessing/EffectComposer.js'),
        import('three/examples/jsm/postprocessing/RenderPass.js'),
        import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
      ]);
      if (this.disposed || !this.renderer) return;
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      // Bright blades, trails and arrow halos intentionally spill into nearby
      // pixels on desktop. XR keeps explicit additive shells and real lights,
      // because headset render loops bypass EffectComposer.
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.92, 0.68, 0.82);
      this.composer.addPass(this.bloomPass);
    } catch {
      // Bloom is enhancement-only; direct Three.js rendering remains playable.
      this.composer = null;
      this.bloomPass = null;
    }
  }

  _setupVRMenu() {
    this.vrMenu = new VRMenu({
      tracks: this.tracks,
      selectedTrackId: this.track?.id,
      mode: this.mode,
      onAction: (action, state) => this._handleVRMenuAction(action, state),
    });
    this.scene.add(this.vrMenu.group);
  }

  _setupVRHud() {
    this.vrHud = new VRHud({
      lowPower: this.lowPower,
      reducedMotion: this.reducedMotion,
      onAction: (action, state) => this._handleVRHudAction(action, state),
    });
    this.vrHud.setPresenting(Boolean(this.renderer?.xr?.isPresenting));
    this.vrHud.setMenuVisible(Boolean(this.vrMenu?.visible));
    this.vrHud.setPhase(this.phase);
    this.scene.add(this.vrHud.group);
  }

  loadTrack(track) {
    this.track = track || null;
    this.beatmap = createBeatmapFromTrack(track);
    this.obstacleMap = createObstacleMap(track);
    this.runtime.reset(this.mode === GAME_MODES.ZEN ? [] : this.beatmap);
    this.obstacleRuntime.reset(this.mode === GAME_MODES.ZEN ? [] : this.obstacleMap);
    this.score = new ScoreKeeper(this.rules);
    this._clearNotes();
    this._clearObstacles();
    this._resetSaberTrails(0);
    this._resetDodge();
    const themeKey = resolveTheme(track);
    this._buildEnvironment(themeKey);
    this._applySaberStyle(resolveDamageStyle(track));
    this.vrMenu?.setTrack?.(track?.id);
    this.vrHud?.update?.({
      time: 0,
      duration: track?.duration,
      state: this.score.snapshot(),
      mode: this.mode,
      phase: this.phase,
      title: displayTrackTitle(track),
    }, { force: true });
    this._emitTick(0);
  }

  selectTrack(trackOrId, source = 'game') {
    const track = typeof trackOrId === 'string' ? this.tracks.find((candidate) => candidate.id === trackOrId) : trackOrId;
    if (!track) return false;
    this.loadTrack(track);
    this._emit(GameplayEvent.TRACK_SELECT, { track, trackId: track.id, mode: this.mode, source });
    return true;
  }

  setTracks(tracks) {
    this.tracks = Array.isArray(tracks) ? tracks : [];
    this.vrMenu?.setTracks?.(this.tracks, this.track?.id);
    return this.tracks;
  }

  setTrackCatalog(tracks) {
    return this.setTracks(tracks);
  }

  setMode(mode, { source = 'game', forceEvent = false } = {}) {
    const next = normalizeGameMode(mode);
    if (next === this.mode && !forceEvent) return this.mode;
    const changed = next !== this.mode;
    this.mode = next;
    this.vrMenu?.setMode?.(next);
    if (changed && this.phase === GamePhase.PLAYING) {
      this._clearNotes();
      this._clearObstacles();
      this.runtime.reset(next === GAME_MODES.ZEN ? [] : this.beatmap);
      this.obstacleRuntime.reset(next === GAME_MODES.ZEN ? [] : this.obstacleMap);
    }
    this._emit(GameplayEvent.MODE_CHANGE, { mode: next, trackId: this.track?.id || null, source, changed });
    return next;
  }

  getMode() {
    return this.mode;
  }

  openVRMenu(source = 'game') {
    if (!this.vrMenu) return false;
    this.vrMenu.setTracks(this.tracks, this.track?.id);
    this.vrMenu.setMode(this.mode);
    this.vrMenu.setVisible(true);
    this.vrHud?.setMenuVisible?.(true);
    this._emit(GameplayEvent.VR_MENU, {
      visible: true,
      source,
      action: { type: 'open' },
      state: { ...this.vrMenu.state },
      trackId: this.vrMenu.state.selectedTrackId,
      mode: this.vrMenu.state.mode,
    });
    return true;
  }

  closeVRMenu(source = 'game') {
    const wasVisible = Boolean(this.vrMenu?.visible);
    this.vrMenu?.setVisible?.(false);
    this.vrHud?.setMenuVisible?.(false);
    for (const controller of this.controllers) {
      const ray = controller.getObjectByName?.('rift-menu-ray');
      if (ray) ray.visible = false;
      const reticle = controller.getObjectByName?.('rift-menu-reticle');
      if (reticle) reticle.visible = false;
    }
    if (wasVisible) {
      this._emit(GameplayEvent.VR_MENU, {
        visible: false,
        source,
        action: { type: 'close' },
        state: this.vrMenu ? { ...this.vrMenu.state } : null,
        trackId: this.track?.id || null,
        mode: this.mode,
      });
    }
  }

  _handleVRMenuAction(action, state) {
    this._executeVRAction(action, state, 'vr-menu');
    const current = state || this.vrMenu?.snapshot?.() || {};
    const detail = {
      visible: this.vrMenu?.visible ?? false,
      source: 'vr',
      surface: 'menu',
      action,
      state: current,
      trackId: current.selectedTrackId || this.track?.id || null,
      mode: current.mode || this.mode,
    };
    this.onVRSelection?.(detail);
    this._emit(GameplayEvent.VR_MENU, detail);
  }

  _handleVRHudAction(action, state) {
    this._executeVRAction(action, state, 'vr-hud');
    const detail = {
      visible: this.vrMenu?.visible ?? false,
      source: 'vr',
      surface: 'hud',
      action,
      state,
      trackId: this.track?.id || null,
      mode: this.mode,
    };
    this.onVRSelection?.(detail);
    this._emit(GameplayEvent.VR_MENU, detail);
  }

  _executeVRAction(action = {}, state = {}, source = 'vr') {
    const type = action.type;
    if (type === VR_MENU_ACTIONS.TRACK) this.selectTrack(action.trackId, 'vr');
    else if (type === VR_MENU_ACTIONS.MODE) this.setMode(action.mode, { source: 'vr', forceEvent: true });
    else if (type === VR_MENU_ACTIONS.START) {
      const trackId = action.trackId || state?.selectedTrackId;
      if (trackId) this.selectTrack(trackId, 'vr');
      this.setMode(action.mode || state?.mode || this.mode, { source: 'vr', forceEvent: true });
      this.closeVRMenu(`${source}-start`);
      this._runVRTask(() => this.start(), source);
    } else if (type === VR_MENU_ACTIONS.PAUSE || type === VR_HUD_ACTIONS.PAUSE) {
      this.pause();
    } else if (type === VR_MENU_ACTIONS.RESUME || type === VR_HUD_ACTIONS.RESUME) {
      this.closeVRMenu(`${source}-resume`);
      this.resume();
    } else if ([VR_MENU_ACTIONS.RESTART, VR_MENU_ACTIONS.PLAY_AGAIN, VR_HUD_ACTIONS.RESTART, VR_HUD_ACTIONS.PLAY_AGAIN].includes(type)) {
      this.closeVRMenu(`${source}-restart`);
      this._runVRTask(() => this.restart(), source);
    } else if (type === VR_MENU_ACTIONS.RETURN_TO_SELECTION || type === VR_HUD_ACTIONS.RETURN_TO_SELECTION) {
      this.returnToMenu();
    }
  }

  _runVRTask(task, source) {
    try {
      const pending = task?.();
      pending?.catch?.((error) => this._emit('game:error', { source, message: error?.message || String(error) }));
      return pending;
    } catch (error) {
      this._emit('game:error', { source, message: error?.message || String(error) });
      return null;
    }
  }

  async start() {
    if (!this.renderer) await this.initialize();
    if (!this.track) this.loadTrack(createFallbackTrack());
    this._clearNotes();
    this._clearObstacles();
    this.runtime.reset(this.mode === GAME_MODES.ZEN ? [] : this.beatmap);
    this.obstacleRuntime.reset(this.mode === GAME_MODES.ZEN ? [] : this.obstacleMap);
    this.score = new ScoreKeeper(this.rules);
    this._resetDodge();
    this._resetSaberTrails(0);
    this.fallbackStart = performance.now() / 1000;
    this.clock.start();
    await this.music?.start?.(this.track, 0);
    this.closeVRMenu();
    this._setPhase(GamePhase.PLAYING);
  }

  pause() {
    if (this.phase !== GamePhase.PLAYING) return;
    this.music?.pause?.();
    this.clock.stop();
    this._setPhase(GamePhase.PAUSED);
  }

  resume() {
    if (this.phase !== GamePhase.PAUSED) return;
    this.music?.resume?.();
    this.clock.start();
    this._setPhase(GamePhase.PLAYING);
  }

  async restart() {
    this.music?.stop?.();
    await this.start();
  }

  returnToMenu() {
    this.music?.stop?.();
    this.clock.stop();
    this._clearNotes();
    this._clearObstacles();
    this._resetDodge();
    this._resetSaberTrails(0);
    this._setPhase(GamePhase.MENU);
  }

  resize() {
    if (!this.renderer || !this.camera) return;
    const rect = this.canvas.getBoundingClientRect?.() || { width: this.canvas.clientWidth || innerWidth, height: this.canvas.clientHeight || innerHeight };
    const width = Math.max(1, Math.floor(rect.width || this.canvas.clientWidth || innerWidth || 1));
    const height = Math.max(1, Math.floor(rect.height || this.canvas.clientHeight || innerHeight || 1));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer?.setSize?.(width, height);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.music?.stop?.();
    this.renderer?.setAnimationLoop(null);
    globalThis.removeEventListener?.('keydown', this._boundKeyDown);
    this.canvas.removeEventListener?.('pointermove', this._boundPointerMove);
    this.canvas.removeEventListener?.('pointerdown', this._boundPointerDown);
    this.canvas.removeEventListener?.('contextmenu', this._boundContextMenu);
    this.motionQuery?.removeEventListener?.('change', this._boundMotionPreferenceChange);
    this.motionQuery?.removeListener?.(this._boundMotionPreferenceChange);
    this.motionQuery = null;
    this.renderer?.xr?.removeEventListener?.('sessionstart', this._boundSessionStart);
    this.renderer?.xr?.removeEventListener?.('sessionend', this._boundSessionEnd);
    for (const controller of this.controllers) {
      const handlers = controller.userData?.riftHandlers;
      if (!handlers) continue;
      controller.removeEventListener('connected', handlers.connected);
      controller.removeEventListener('disconnected', handlers.disconnected);
      controller.removeEventListener('selectstart', handlers.selectstart);
      delete controller.userData.riftHandlers;
    }
    this.vrButton?.remove?.();
    for (const timer of this.pendingTimers) clearTimeout(timer);
    this.pendingTimers.clear();
    this.vrMenu?.dispose?.();
    this.vrHud?.dispose?.();
    for (const trail of new Set(this.saberTrails.values())) trail?.dispose?.();
    this.saberTrails.clear();
    this.saberTrailSamples.clear();
    this.cosmicBackdrop?.dispose?.();
    this.cosmicBackdrop = null;
    this.blackHoleBackdrop?.dispose?.();
    this.blackHoleBackdrop = null;
    this.touchSlices.clear();
    this._clearNotes();
    this._clearObstacles();
    this._clearDamageEffects();
    this.scene?.traverse((object) => {
      object.geometry?.dispose?.();
      disposeMaterial(object.material);
    });
    this.composer?.dispose?.();
    this.composer = null;
    this.bloomPass = null;
    this.renderer?.renderLists?.dispose?.();
    this.renderer?.dispose?.();
    this.sabers.clear();
    this.controllerState.clear();
    this.controllers.length = 0;
    this.grips.length = 0;
    this.damageEffects.length = 0;
    this.noteMeshes.clear();
    this.obstacleMeshes.clear();
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xddeeff, 0x120014, 0.92);
    const key = new THREE.DirectionalLight(0xffffff, 2.15);
    key.position.set(2, 5, 3);
    key.castShadow = !this.lowPower;
    key.shadow.mapSize.set(this.lowPower ? 512 : 1024, this.lowPower ? 512 : 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 30;
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -2;
    const leftRim = new THREE.PointLight(0x43d9ff, 18, 11, 1.65);
    leftRim.position.set(-2.7, 2.5, -1.4);
    const rightRim = new THREE.PointLight(0xff4fd8, 18, 11, 1.65);
    rightRim.position.set(2.7, 2.5, -1.4);
    const beatLight = new THREE.PointLight(0xffffff, 12, 16, 1.45);
    beatLight.position.set(0, 2.8, -4.5);
    this.scene.add(hemi, key, leftRim, rightRim, beatLight);
    this.worldLights = { hemi, key, leftRim, rightRim, beatLight };
  }

  _buildEnvironment(themeKey) {
    const theme = THEME_PRESETS[themeKey] || THEME_PRESETS.neon;
    this.activeTheme = theme;
    if (!this.cosmicBackdrop) {
      this.cosmicBackdrop = new CosmicBackdrop({ theme, lowPower: this.lowPower, reducedMotion: this.reducedMotion, seed: 0x51a7c05 });
      this.scene?.add(this.cosmicBackdrop.group);
    } else {
      this.cosmicBackdrop.setTheme(theme);
    }
    if (!this.blackHoleBackdrop) {
      this.blackHoleBackdrop = new BlackHoleBackdrop({ theme, lowPower: this.lowPower, reducedMotion: this.reducedMotion, seed: 0xb1ac401e });
      // Keep the singularity dominant but far enough behind the note corridor
      // to preserve depth judgement. It is geometry and procedural shaders,
      // not a sky texture or a flat billboard.
      this.blackHoleBackdrop.group.position.set(0, 5.4, -23.5);
      this.blackHoleBackdrop.group.scale.setScalar(this.lowPower ? 0.94 : 1.08);
      this.scene?.add(this.blackHoleBackdrop.group);
    } else {
      this.blackHoleBackdrop.setTheme(theme);
    }
    clearGroup(this.environmentGroup);
    this.scene.fog = new THREE.FogExp2(theme.fog, 0.037);
    this.scene.background = new THREE.Color(theme.fog);
    this.renderer?.setClearColor(theme.fog, 1);
    if (this.renderer) this.renderer.toneMappingExposure = this.lowPower ? 0.98 : 1.08;
    if (this.worldLights) {
      this.worldLights.leftRim.color.setHex(theme.grid);
      this.worldLights.rightRim.color.setHex(theme.bloom);
      this.worldLights.beatLight.color.setHex(theme.accent);
    }

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(42, this.lowPower ? 16 : 28, this.lowPower ? 10 : 18),
      new THREE.MeshBasicMaterial({ color: theme.sky[0], side: THREE.BackSide, fog: false }),
    );
    sky.position.set(0, 6, -12);
    sky.userData.motion = 'skyBreath';
    sky.userData.baseColor = new THREE.Color(theme.sky[0]);
    sky.userData.pulseColor = new THREE.Color(theme.sky[1]);
    this.environmentGroup.add(sky);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 52, 18, 52),
      new THREE.MeshStandardMaterial({
        color: theme.floor,
        metalness: theme.key === 'neon' ? 0.72 : 0.24,
        roughness: theme.key === 'orbit' ? 0.16 : 0.45,
        emissive: theme.floor,
        emissiveIntensity: 0.22,
        transparent: theme.key === 'orbit',
        opacity: theme.key === 'orbit' ? 0.7 : 1,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = -14;
    floor.receiveShadow = true;
    floor.userData.motion = theme.key === 'neon' ? 'floorPulse' : null;
    this.environmentGroup.add(floor);

    const grid = new THREE.GridHelper(18, 36, theme.grid, theme.grid);
    grid.position.set(0, 0.018, -14);
    grid.material.transparent = true;
    grid.material.opacity = theme.key === 'magma' ? 0.22 : 0.4;
    this.environmentGroup.add(grid);

    const laneMaterial = new THREE.MeshBasicMaterial({ color: theme.grid, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const lane of [-1.5, -0.5, 0.5, 1.5]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, 11.4), laneMaterial.clone());
      rail.position.set(laneToX(lane), 0.045, -6.25);
      rail.userData.motion = 'laneRail';
      rail.userData.phase = lane;
      this.environmentGroup.add(rail);
    }
    laneMaterial.dispose();

    const gateMaterial = new THREE.MeshBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false });
    const hitLine = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.028, 0.035), gateMaterial);
    hitLine.position.set(0, 0.055, NOTE_PLANE_Z);
    hitLine.userData.motion = 'hitGate';
    this.environmentGroup.add(hitLine);

    if (theme.key === 'magma') this._buildForgeCathedral(theme);
    else if (theme.key === 'orbit') this._buildOrbitGarden(theme);
    else if (theme.key === 'neon') this._buildNeonCauseway(theme);
    else this._buildSignatureWorld(theme);

    this.currentTheme = theme.key;
  }

  _buildNeonCauseway(theme) {
    for (let i = 0; i < 24; i += 1) {
      const side = i % 2 ? -1 : 1;
      const height = 1.2 + ((i * 7) % 9) * 0.36;
      const color = new THREE.Color(i % 3 === 0 ? theme.bloom : theme.grid);
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(0.18 + (i % 4) * 0.08, height, 0.22),
        new THREE.MeshStandardMaterial({ color: 0x07162a, emissive: color, emissiveIntensity: 1.45, metalness: 0.72, roughness: 0.24 }),
      );
      tower.position.set(side * (3.4 + (i % 4) * 0.62), height / 2, -2.4 - i * 1.08);
      tower.userData.motion = 'equalizer';
      tower.userData.baseHeight = height;
      tower.userData.phase = i * 0.61;
      this.environmentGroup.add(tower);
    }

    const gateMaterial = new THREE.MeshStandardMaterial({ color: theme.bloom, emissive: theme.bloom, emissiveIntensity: 2.2, metalness: 0.08, roughness: 0.18 });
    for (let i = 0; i < 8; i += 1) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.55 + (i % 2) * 0.14, 0.028, 8, 64), gateMaterial.clone());
      ring.position.set(0, 1.72, -4.5 - i * 3.45);
      ring.scale.y = 0.58;
      ring.userData.motion = 'warpGate';
      ring.userData.phase = i * 0.52;
      this.environmentGroup.add(ring);
    }
    gateMaterial.dispose();
    this.environmentGroup.add(createParticleField({ count: this.lowPower ? 70 : 180, color: theme.grid, rangeX: 11, minY: 0.2, maxY: 6, minZ: -34, maxZ: 2, size: 0.025, motion: 'neonRain' }));
  }

  _buildForgeCathedral(theme) {
    const hot = new THREE.MeshStandardMaterial({ color: 0x4a1305, emissive: theme.grid, emissiveIntensity: 2.4, metalness: 0.38, roughness: 0.48 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x140b08, emissive: 0x240800, emissiveIntensity: 0.45, metalness: 0.62, roughness: 0.4 });

    for (let i = 0; i < 7; i += 1) {
      const z = -4.5 - i * 4.1;
      for (const side of [-1, 1]) {
        const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 3.3, 12), dark.clone());
        piston.position.set(side * 3.65, 1.7, z);
        piston.userData.motion = 'piston';
        piston.userData.baseY = 1.7;
        piston.userData.phase = i * 0.9 + side;
        this.environmentGroup.add(piston);

        const furnace = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.52), hot.clone());
        furnace.position.set(side * 3.65, 0.45, z);
        furnace.userData.motion = 'furnace';
        furnace.userData.phase = i * 0.72;
        this.environmentGroup.add(furnace);
      }
      const arch = new THREE.Mesh(new THREE.TorusGeometry(3.65, 0.11, 10, 48, Math.PI), dark.clone());
      arch.rotation.z = Math.PI;
      arch.position.set(0, 1.75, z);
      this.environmentGroup.add(arch);
    }

    for (let i = 0; i < 12; i += 1) {
      const seam = new THREE.Mesh(new THREE.PlaneGeometry(0.055, 46), hot.clone());
      seam.rotation.x = -Math.PI / 2;
      seam.position.set(-2.75 + i * 0.5, 0.026, -13);
      seam.userData.motion = 'lavaSeam';
      seam.userData.phase = i * 0.37;
      this.environmentGroup.add(seam);
    }
    hot.dispose();
    dark.dispose();
    this.environmentGroup.add(createParticleField({ count: this.lowPower ? 64 : 150, color: theme.bloom, rangeX: 9, minY: 0.1, maxY: 5, minZ: -32, maxZ: 1, size: 0.045, motion: 'embers' }));
  }

  _buildOrbitGarden(theme) {
    const glass = new THREE.MeshStandardMaterial({ color: theme.grid, emissive: theme.grid, emissiveIntensity: 0.75, metalness: 0.15, roughness: 0.08, transparent: true, opacity: 0.36, side: THREE.DoubleSide });
    const violet = new THREE.MeshStandardMaterial({ color: theme.bloom, emissive: theme.bloom, emissiveIntensity: 1.55, metalness: 0.1, roughness: 0.12, transparent: true, opacity: 0.62 });

    for (let i = 0; i < 9; i += 1) {
      const halo = new THREE.Mesh(new THREE.TorusGeometry(2.7 + (i % 3) * 0.24, 0.035, 8, 6), i % 2 ? glass.clone() : violet.clone());
      halo.position.set(0, 1.6, -4 - i * 3.15);
      halo.rotation.z = i * 0.31;
      halo.scale.y = 0.72;
      halo.userData.motion = 'orbitHalo';
      halo.userData.phase = i * 0.58;
      this.environmentGroup.add(halo);
    }

    for (let i = 0; i < 34; i += 1) {
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.08 + (i % 5) * 0.035, 0), i % 2 ? glass.clone() : violet.clone());
      const angle = i * 2.39996;
      shard.position.set(Math.cos(angle) * (3.4 + (i % 4) * 0.52), 0.8 + (i % 7) * 0.56, -3 - (i % 17) * 1.7);
      shard.scale.y = 2.4 + (i % 3);
      shard.userData.motion = 'glassShard';
      shard.userData.phase = angle;
      shard.userData.baseY = shard.position.y;
      this.environmentGroup.add(shard);
    }
    glass.dispose();
    violet.dispose();
    this.environmentGroup.add(createParticleField({ count: this.lowPower ? 84 : 210, color: theme.grid, rangeX: 12, minY: 0.25, maxY: 7, minZ: -36, maxZ: 1, size: 0.032, motion: 'prismRain' }));
  }

  _buildSignatureWorld(theme) {
    const motifMaterial = new THREE.MeshStandardMaterial({
      color: theme.floor,
      emissive: theme.bloom,
      emissiveIntensity: 1.35,
      metalness: theme.key === 'desert' || theme.key === 'jungle' ? 0.16 : 0.58,
      roughness: theme.key === 'ice' ? 0.12 : 0.32,
      transparent: ['sakura', 'ice', 'void'].includes(theme.key),
      opacity: ['sakura', 'ice', 'void'].includes(theme.key) ? 0.72 : 1,
    });
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: theme.accent,
      emissive: theme.accent,
      emissiveIntensity: 1.9,
      metalness: 0.18,
      roughness: 0.2,
      transparent: true,
      opacity: 0.76,
    });

    for (let index = 0; index < (this.lowPower ? 12 : 20); index += 1) {
      const side = index % 2 ? -1 : 1;
      const depth = -3.2 - index * 1.45;
      const motif = new THREE.Mesh(createThemeGeometry(theme.archetype, index), index % 3 === 0 ? accentMaterial.clone() : motifMaterial.clone());
      motif.position.set(side * (3.25 + (index % 4) * 0.54), 0.7 + (index % 6) * 0.55, depth);
      motif.rotation.set(index * 0.17, index * 0.31, index * 0.11);
      motif.castShadow = index < 8;
      motif.userData.motion = 'signatureFloat';
      motif.userData.baseY = motif.position.y;
      motif.userData.phase = index * 0.73;
      motif.userData.spin = index % 2 ? -1 : 1;
      this.environmentGroup.add(motif);
    }

    const horizon = new THREE.Mesh(
      theme.key === 'solar'
        ? new THREE.SphereGeometry(3.2, 28, 18)
        : new THREE.TorusGeometry(3.5, theme.key === 'void' ? 0.32 : 0.09, 10, theme.key === 'void' ? 8 : 72),
      new THREE.MeshBasicMaterial({ color: theme.bloom, transparent: true, opacity: theme.key === 'solar' ? 0.7 : 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    horizon.position.set(0, theme.key === 'solar' ? 4.7 : 2.5, -30);
    horizon.userData.motion = 'horizonPulse';
    this.environmentGroup.add(horizon);

    if (theme.key === 'jungle') {
      for (let index = 0; index < 7; index += 1) {
        const arch = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.12, 8, 36, Math.PI), motifMaterial.clone());
        arch.rotation.z = Math.PI;
        arch.position.set(0, 1.3, -4.5 - index * 4);
        arch.userData.motion = 'canopyArch';
        arch.userData.phase = index * 0.62;
        this.environmentGroup.add(arch);
      }
    }

    motifMaterial.dispose();
    accentMaterial.dispose();

    const particleMotion = {
      sakura: 'petalDrift', abyss: 'bubbleRise', solar: 'flareFall', ice: 'snowFall', jungle: 'fireflyDrift', desert: 'sandDrift', void: 'glitchRain',
    }[theme.key] || 'themeDrift';
    this.environmentGroup.add(createParticleField({
      count: this.lowPower ? 80 : 230,
      color: theme.accent,
      rangeX: 12,
      minY: 0.15,
      maxY: 7,
      minZ: -36,
      maxZ: 1,
      size: ['sakura', 'jungle'].includes(theme.key) ? 0.052 : 0.032,
      motion: particleMotion,
    }));
  }

  _setupControllers() {
    const controllerModelFactory = new XRControllerModelFactory();
    for (let i = 0; i < 2; i += 1) {
      const controller = this.renderer.xr.getController(i);
      const hand = i === 0 ? Hand.LEFT : Hand.RIGHT;
      controller.userData.hand = hand;
      controller.userData.saber = this._createSaber(hand);
      controller.add(controller.userData.saber);
      const trail = this._createSaberTrail(hand);
      controller.userData.saberTrail = trail;
      const connected = (event) => {
        const reportedHand = event.data?.handedness || controller.userData.hand;
        controller.userData.hand = reportedHand;
        controller.userData.inputSource = event.data;
        const state = this.controllerState.get(controller);
        if (state) state.hand = reportedHand;
        this.sabers.set(reportedHand, controller.userData.saber);
        this.saberTrails.set(reportedHand, controller.userData.saberTrail);
        this._applySaberStyle(this.damageStyle || 'voltaic');
      };
      const disconnected = () => {
        controller.userData.inputSource = null;
        const state = this.controllerState.get(controller);
        if (state) state.initialized = false;
      };
      const selectstart = () => {
        if (this.vrMenu?.visible && this.vrMenu.select(controller)) {
          this._pulseHaptics(controller.userData.hand || hand, 0.18, 28);
          return;
        }
        if (this.vrHud?.select?.(controller)) {
          this._pulseHaptics(controller.userData.hand || hand, 0.2, 32);
          return;
        }
        this._queueControllerSwing(controller, hand);
      };
      controller.userData.riftHandlers = { connected, disconnected, selectstart };
      controller.addEventListener('connected', connected);
      controller.addEventListener('disconnected', disconnected);
      controller.addEventListener('selectstart', selectstart);
      this.player.add(controller);
      this.controllers.push(controller);

      const grip = this.renderer.xr.getControllerGrip(i);
      grip.add(controllerModelFactory.createControllerModel(grip));
      this.player.add(grip);
      this.grips.push(grip);
      this.controllerState.set(controller, { hand, previous: new THREE.Vector3(), current: new THREE.Vector3(), initialized: false });
    }
    this._applySaberStyle('voltaic');
  }

  _createSaberTrail(hand) {
    const trail = new SaberTrail({
      name: `${hand}-saber-trail`,
      color: HAND_COLORS[hand] || HAND_COLORS[Hand.RIGHT],
      lowPower: this.lowPower,
      reducedMotion: this.reducedMotion,
    });
    this.saberTrails.set(hand, trail);
    this.saberTrailSamples.set(trail, { base: new THREE.Vector3(), tip: new THREE.Vector3() });
    this.scene?.add(trail.group);
    return trail;
  }

  _createSaber(hand) {
    const group = new THREE.Group();
    const color = HAND_COLORS[hand];
    const blade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.045, 1.25, 18),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 5.8, roughness: 0.08, metalness: 0.04, transparent: true, opacity: 0.96 }),
    );
    blade.name = `${hand}-blade`;
    blade.position.y = 0.62;
    const aura = new THREE.Mesh(
      new THREE.CylinderGeometry(0.064, 0.098, 1.34, 16),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: this.lowPower ? 0.36 : 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
        toneMapped: false,
      }),
    );
    aura.name = `${hand}-blade-aura`;
    aura.position.y = 0.63;
    const bloomSpill = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.16, 1.43, 16),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(2.1),
        transparent: true,
        opacity: this.lowPower ? 0.12 : 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
        toneMapped: false,
      }),
    );
    bloomSpill.name = `${hand}-blade-bloom-spill`;
    bloomSpill.position.y = 0.64;
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.016, 1.3, 12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(2.8), transparent: true, opacity: 0.98, toneMapped: false }),
    );
    core.name = `${hand}-blade-core`;
    core.position.y = 0.64;
    // This is real scene illumination: nearby notes, floor and obstacles pick
    // up the blade hue instead of merely showing a painted glow shell.
    const light = new THREE.PointLight(color, this.lowPower ? 2.6 : 7.4, 5.8, 1.45);
    light.name = `${hand}-blade-light`;
    light.position.y = 0.76;
    light.userData.baseIntensity = light.intensity;
    light.userData.environmentSpill = true;
    const hilt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.07, 0.22, 16),
      new THREE.MeshStandardMaterial({ color: 0x11131d, metalness: 0.7, roughness: 0.28 }),
    );
    hilt.position.y = -0.05;
    group.rotation.x = -Math.PI / 2;
    group.userData.realLightEmitter = true;
    group.add(bloomSpill, aura, blade, core, light, hilt);
    this.sabers.set(hand, group);
    return group;
  }

  _applySaberStyle(styleKey) {
    const style = DAMAGE_STYLES[styleKey] || DAMAGE_STYLES.voltaic;
    for (const hand of [Hand.LEFT, Hand.RIGHT]) {
      const saber = this.sabers.get(hand);
      const blade = saber?.getObjectByName(`${hand}-blade`);
      const aura = saber?.getObjectByName(`${hand}-blade-aura`);
      const bloomSpill = saber?.getObjectByName(`${hand}-blade-bloom-spill`);
      const core = saber?.getObjectByName(`${hand}-blade-core`);
      const light = saber?.getObjectByName(`${hand}-blade-light`);
      const trail = this.saberTrails.get(hand);
      const color = style[hand];
      if (blade?.material) {
        blade.material.color.setHex(color);
        blade.material.emissive.setHex(color);
        blade.material.emissiveIntensity = styleKey === 'ember' ? 6.8 : styleKey === 'prism' ? 5.4 : 6.2;
        blade.material.opacity = styleKey === 'prism' ? 0.72 : 0.91;
        blade.material.roughness = styleKey === 'ember' ? 0.48 : 0.18;
      }
      if (aura?.material) {
        aura.material.color.setHex(color);
        aura.material.opacity = this.lowPower ? 0.3 : styleKey === 'prism' ? 0.42 : 0.54;
      }
      if (bloomSpill?.material) {
        bloomSpill.material.color.setHex(color).multiplyScalar(styleKey === 'ember' ? 2.6 : 2.2);
        bloomSpill.material.opacity = this.lowPower ? 0.14 : styleKey === 'prism' ? 0.18 : 0.24;
      }
      if (core?.material) {
        core.material.color.setRGB(2.8, 2.8, 2.8);
      }
      if (light) {
        light.color.setHex(color);
        light.intensity = this.lowPower ? 2.35 : styleKey === 'ember' ? 8.4 : 7.2;
        light.userData.baseIntensity = light.intensity;
      }
      trail?.setColor?.(color);
    }
    this.damageStyle = styleKey;
  }

  _createEnterVrButton() {
    if (!globalThis.navigator?.xr || !globalThis.document?.createElement) return;
    // The Material 3 shell owns the primary VR CTA. Only create this compact
    // fallback when RhythmGame is embedded without that application shell.
    if (document.querySelector('#app, [data-action="enter-vr"]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'webxr-entry';
    button.textContent = '进入 VR';
    button.setAttribute('aria-label', '进入沉浸式 VR');
    Object.assign(button.style, {
      position: 'fixed', left: '50%', top: '24px', transform: 'translateX(-50%)', zIndex: '20', padding: '12px 16px', borderRadius: '999px',
      border: '1px solid rgba(255,255,255,.35)', color: '#fff', background: 'rgba(10,8,24,.72)', backdropFilter: 'blur(12px)',
      font: '700 12px system-ui, sans-serif', letterSpacing: '.18em', cursor: 'pointer',
    });
    button.addEventListener('click', async () => {
      if (this.renderer.xr.isPresenting) {
        await this.exitVR();
        return;
      }
      try {
        await this.enterVR();
      } catch {
        button.textContent = '未检测到 VR';
      }
    });
    document.body.append(button);
    this.vrButton = button;
  }

  _setupDesktopControls() {
    globalThis.addEventListener?.('keydown', this._boundKeyDown);
    this.canvas.addEventListener?.('pointermove', this._boundPointerMove);
    this.canvas.addEventListener?.('pointerdown', this._boundPointerDown);
    this.canvas.addEventListener?.('contextmenu', this._boundContextMenu);
  }

  beginTouchSlice(pointerId, clientX, clientY) {
    if (this.phase !== GamePhase.PLAYING || this.mode !== GAME_MODES.STANDARD || this.renderer?.xr?.isPresenting) {
      return { accepted: false, reason: 'inactive' };
    }
    if (this.touchSlices.has(pointerId)) return { accepted: false, reason: 'pointer-busy' };
    const picked = this._pickTouchNote(clientX, clientY);
    if (!picked?.note) return { accepted: false, reason: picked?.reason || 'no-note' };
    const gesture = {
      pointerId,
      noteId: picked.note.id,
      startX: Number(clientX) || 0,
      startY: Number(clientY) || 0,
      lastX: Number(clientX) || 0,
      lastY: Number(clientY) || 0,
      startedAt: globalThis.performance?.now?.() ?? Date.now(),
    };
    this.touchSlices.set(pointerId, gesture);
    const mesh = this.noteMeshes.get(picked.note.id);
    if (mesh) mesh.userData.touchArmed = true;
    return { accepted: true, noteId: picked.note.id, hand: picked.note.hand, direction: picked.note.direction };
  }

  updateTouchSlice(pointerId, clientX, clientY) {
    const gesture = this.touchSlices.get(pointerId);
    if (!gesture) return { accepted: false, reason: 'no-gesture' };
    gesture.lastX = Number(clientX) || 0;
    gesture.lastY = Number(clientY) || 0;
    const note = this.runtime.active.find((candidate) => candidate.id === gesture.noteId);
    if (!note) {
      this.cancelTouchSlice(pointerId);
      return { accepted: false, reason: 'note-gone' };
    }
    const evaluation = evaluateTouchSwipe(note.direction, gesture.startX, gesture.startY, gesture.lastX, gesture.lastY);
    if (!evaluation.ready) return { accepted: true, pending: true, ...evaluation };

    const elapsed = this._gameTime();
    const timing = elapsed - note.time;
    if (Math.abs(timing) > Math.max(this.rules.hitWindow, TOUCH_HIT_WINDOW)) {
      this.cancelTouchSlice(pointerId);
      return { accepted: false, reason: timing < 0 ? 'early' : 'late', timing };
    }

    this._spawnTouchSlash(gesture, note, evaluation.ok);
    if (!evaluation.ok) {
      const state = this.score.wrongCut('wrong-direction');
      this.vrHud?.flashMiss?.('wrong-direction', { redraw: false });
      this._emit(GameplayEvent.DAMAGE, { reason: 'wrong-direction', source: 'touch-swipe', state });
      this._flashSaber(note.hand, true);
      this.cancelTouchSlice(pointerId);
      if (state.health <= 0) this._finish(true);
      return { accepted: false, reason: 'wrong-direction', ...evaluation };
    }

    const judgement = {
      ok: true,
      reason: 'touch-swipe',
      source: 'touch-swipe',
      timing,
      distance: 0,
      alignment: evaluation.alignment,
      quality: Math.abs(timing) <= 0.035 ? 'perfect' : Math.abs(timing) <= 0.09 ? 'great' : 'good',
    };
    this.touchSlices.delete(pointerId);
    this._hitNote(note, judgement);
    return { accepted: true, hit: true, noteId: note.id, judgement };
  }

  endTouchSlice(pointerId, clientX, clientY) {
    const result = this.updateTouchSlice(pointerId, clientX, clientY);
    if (this.touchSlices.has(pointerId)) this.cancelTouchSlice(pointerId);
    return result;
  }

  cancelTouchSlice(pointerId) {
    const gesture = this.touchSlices.get(pointerId);
    if (!gesture) return false;
    const mesh = this.noteMeshes.get(gesture.noteId);
    if (mesh) mesh.userData.touchArmed = false;
    this.touchSlices.delete(pointerId);
    return true;
  }

  dodge(direction, { source = 'touch' } = {}) {
    if (this.phase !== GamePhase.PLAYING || this.renderer?.xr?.isPresenting) return { accepted: false, lane: this.dodgeState.lane };
    const lane = Math.sign(Number(direction) || 0);
    if (!lane) return { accepted: false, lane: this.dodgeState.lane };
    const changed = lane !== this.dodgeState.targetLane;
    this.dodgeState.lane = lane;
    this.dodgeState.targetLane = lane;
    if (changed) this._emit(GameplayEvent.DODGE, { accepted: true, lane, direction: lane, source });
    return { accepted: true, lane, direction: lane, source };
  }

  _resetDodge() {
    this.dodgeState.lane = 0;
    this.dodgeState.targetLane = 0;
    this.dodgeState.visualX = 0;
    if (this.player) this.player.position.x = 0;
    this._emit?.(GameplayEvent.DODGE, { accepted: true, lane: 0, direction: 0, source: 'reset' });
  }

  _updateDodge() {
    if (!this.player || this.renderer?.xr?.isPresenting) return;
    const targetX = this.dodgeState.targetLane * 0.72;
    const easing = this.reducedMotion ? 1 : 0.24;
    this.dodgeState.visualX += (targetX - this.dodgeState.visualX) * easing;
    if (Math.abs(targetX - this.dodgeState.visualX) < 0.002) this.dodgeState.visualX = targetX;
    this.player.position.x = this.dodgeState.visualX;
  }

  _pickTouchNote(clientX, clientY) {
    if (!this.camera || !this.canvas || !this.noteGroup?.children?.length) return { note: null, reason: 'no-note' };
    const rect = this.canvas.getBoundingClientRect?.() || { left: 0, top: 0, width: 1, height: 1 };
    this.touchPointer.set(
      ((Number(clientX) - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      1 - ((Number(clientY) - rect.top) / Math.max(1, rect.height)) * 2,
    );
    this.camera.updateMatrixWorld?.(true);
    this.noteGroup.updateMatrixWorld?.(true);
    this.touchRaycaster.setFromCamera(this.touchPointer, this.camera);
    const intersections = this.touchRaycaster.intersectObjects(this.noteGroup.children, true);
    for (const intersection of intersections) {
      let object = intersection.object;
      while (object && object !== this.noteGroup && !object.userData?.noteId) object = object.parent;
      const noteId = object?.userData?.noteId;
      if (!noteId) continue;
      const note = this.runtime.active.find((candidate) => candidate.id === noteId);
      if (!note) continue;
      const timing = this._gameTime() - note.time;
      if (Math.abs(timing) <= Math.max(this.rules.hitWindow, TOUCH_HIT_WINDOW)) return { note, intersection, timing };
      return { note: null, reason: timing < 0 ? 'early' : 'late', timing };
    }
    return { note: null, reason: 'no-note' };
  }

  rotateView(deltaX = 0, deltaY = 0) {
    if (this.renderer?.xr?.isPresenting) return { ...this.viewRotation };
    this.viewRotation.yaw = wrapAngle(this.viewRotation.yaw - (Number(deltaX) || 0) * 0.0042);
    this.viewRotation.pitch = THREE.MathUtils.clamp(this.viewRotation.pitch - (Number(deltaY) || 0) * 0.0034, -0.62, 0.48);
    if (this.camera) {
      this.camera.rotation.y = this.viewRotation.yaw;
      this.camera.rotation.x = this.viewRotation.pitch;
    }
    return { ...this.viewRotation };
  }

  setViewRotation(yaw = 0, pitch = 0) {
    this.viewRotation.yaw = wrapAngle(Number(yaw) || 0);
    this.viewRotation.pitch = THREE.MathUtils.clamp(Number(pitch) || 0, -0.62, 0.48);
    if (this.camera && !this.renderer?.xr?.isPresenting) {
      this.camera.rotation.y = this.viewRotation.yaw;
      this.camera.rotation.x = this.viewRotation.pitch;
    }
    return { ...this.viewRotation };
  }

  resetView() {
    return this.setViewRotation(0, 0);
  }

  async requestVRSession() {
    if (!this.renderer) await this.initialize();
    if (this.renderer.xr.isPresenting) return this.renderer.xr.getSession();
    const xr = globalThis.navigator?.xr;
    if (!xr?.requestSession) throw new Error('当前浏览器未提供 WebXR immersive-vr。');
    const supported = await xr.isSessionSupported?.('immersive-vr').catch(() => false);
    if (supported === false) throw new Error('当前设备不支持 immersive-vr。');
    const session = await xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['bounded-floor', 'hand-tracking'],
    });
    await this.renderer.xr.setSession(session);
    return session;
  }

  async enterVR() {
    return this.requestVRSession();
  }

  async exitVR() {
    const session = this.renderer?.xr?.getSession?.();
    if (session) await session.end?.();
  }

  _onPointerMove(event) {
    if (event.pointerType === 'touch') return;
    const rect = this.canvas.getBoundingClientRect?.() || { left: 0, top: 0, width: 1, height: 1 };
    this.desktopPointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    this.desktopPointer.y = 1 - ((event.clientY - rect.top) / Math.max(1, rect.height)) * 2;
    this.desktopPointer.active = true;
  }

  _onPointerDown(event) {
    if (event.pointerType === 'touch') return;
    const hand = event.button === 2 || this.desktopPointer.x > 0 ? Hand.RIGHT : Hand.LEFT;
    this._desktopSwing(hand, this.desktopPointer.x > 0 ? 0.5 : -0.5, this.desktopPointer.y > 0.2 ? 1 : 0, CutDirection.DOWN);
  }

  _onKeyDown(event) {
    if (event.repeat) return;
    if (event.code === 'KeyZ') {
      this.dodge(-1, { source: 'keyboard' });
      return;
    }
    if (event.code === 'KeyC') {
      this.dodge(1, { source: 'keyboard' });
      return;
    }
    if (event.code === 'Space') {
      if (this.phase === GamePhase.PLAYING) this.pause();
      else if (this.phase === GamePhase.PAUSED) this.resume();
      return;
    }
    if (event.code === 'KeyR') {
      this.restart();
      return;
    }
    const bindings = {
      KeyQ: [Hand.LEFT, this.desktopPointer.x < 0 ? -1.5 : -0.5, this.desktopPointer.y > 0 ? 1 : 0, CutDirection.DOWN],
      KeyE: [Hand.RIGHT, this.desktopPointer.x > 0 ? 1.5 : 0.5, this.desktopPointer.y > 0 ? 1 : 0, CutDirection.DOWN],
      KeyA: [Hand.LEFT, -1.5, 1, CutDirection.RIGHT],
      KeyS: [Hand.LEFT, -0.5, 0, CutDirection.UP],
      KeyD: [Hand.LEFT, 0.5, 0, CutDirection.DOWN],
      KeyF: [Hand.LEFT, 1.5, 1, CutDirection.LEFT],
      KeyJ: [Hand.RIGHT, -1.5, 1, CutDirection.RIGHT],
      KeyK: [Hand.RIGHT, -0.5, 0, CutDirection.UP],
      KeyL: [Hand.RIGHT, 0.5, 0, CutDirection.DOWN],
      Semicolon: [Hand.RIGHT, 1.5, 1, CutDirection.LEFT],
      ArrowUp: [Hand.RIGHT, 0.5, 1, CutDirection.UP],
      ArrowDown: [Hand.RIGHT, 0.5, 0, CutDirection.DOWN],
      ArrowLeft: [Hand.LEFT, -0.5, 0, CutDirection.LEFT],
      ArrowRight: [Hand.RIGHT, 0.5, 0, CutDirection.RIGHT],
    };
    const binding = bindings[event.code];
    if (binding) this._desktopSwing(...binding);
  }

  _desktopSwing(hand, lane, row, direction) {
    if (this.phase !== GamePhase.PLAYING) return;
    this.sweepQueue.push(createDesktopSweep(hand, lane, row, direction, this._gameTime()));
    this._flashSaber(hand, false);
  }

  _queueControllerSwing(controller, fallbackHand) {
    if (this.phase !== GamePhase.PLAYING) return;
    const state = this.controllerState.get(controller);
    if (!state) return;
    const hand = controller.userData.inputSource?.handedness || controller.userData.hand || fallbackHand;
    this.sweepQueue.push({ hand, start: state.previous.clone(), end: state.current.clone(), time: this._gameTime(), source: 'xr-select' });
  }

  _frame() {
    if (this.disposed) return;
    const elapsed = this._gameTime();
    this._updateDodge(elapsed);
    this._updateDesktopSabers();
    if (this.vrMenu?.visible) this._updateVRMenu();
    for (const controller of this.controllers) this.vrHud?.updateController?.(controller);
    if (this.phase === GamePhase.PLAYING) {
      this._updateControllers(elapsed);
      this._updateObstacles(elapsed);
      if (this.phase === GamePhase.PLAYING) this._updateBeatmap(elapsed);
      if (this.phase === GamePhase.PLAYING) this._processSweeps(elapsed);
      this._emitTick(elapsed);
    }
    this._animateWorld(elapsed);
    this._animateDamageEffects();
    this.vrHud?.animate?.();
    if (this.renderer?.xr?.isPresenting || !this.composer) this.renderer?.render(this.scene, this.camera);
    else this.composer.render();
  }

  _updateVRMenu() {
    for (const controller of this.controllers) this.vrMenu.updateController(controller);
  }

  _gameTime() {
    const musicTime = this.music?.getTime?.();
    if (Number.isFinite(musicTime)) return musicTime;
    if (this.clock.running) return this.clock.getElapsedTime();
    return Math.max(0, performance.now() / 1000 - this.fallbackStart);
  }

  _updateControllers(elapsed) {
    for (const controller of this.controllers) {
      const state = this.controllerState.get(controller);
      if (!state) continue;
      state.previous.copy(state.current);
      const hand = controller.userData.inputSource?.handedness || controller.userData.hand || state.hand;
      const saber = controller.userData.saber;
      const trail = controller.userData.saberTrail || this.saberTrails.get(hand);
      const sample = trail ? this.saberTrailSamples.get(trail) : null;
      if (saber && sample) {
        controller.updateWorldMatrix?.(true, true);
        sample.base.set(0, 0, 0);
        sample.tip.set(0, 1.28, 0);
        saber.localToWorld(sample.base);
        saber.localToWorld(sample.tip);
        state.current.copy(sample.tip);
        trail.update(elapsed, sample.base, sample.tip);
      } else if (saber) {
        state.current.copy(saber.localToWorld(state.current.set(0, 1.2, 0)));
      } else controller.getWorldPosition(state.current);
      state.hand = hand;
      if (state.initialized && state.current.distanceToSquared(state.previous) > 0.012) {
        this.sweepQueue.push({ hand, start: state.previous.clone(), end: state.current.clone(), time: elapsed, source: 'xr-motion' });
      }
      state.initialized = true;
    }
  }

  _resetSaberTrails(time = 0) {
    for (const trail of new Set(this.saberTrails.values())) trail?.reset?.(time);
  }

  _setReducedMotion(reduced) {
    const next = Boolean(reduced);
    if (next === this.reducedMotion) return next;
    this.reducedMotion = next;
    if (this.vrHud) this.vrHud.reducedMotion = next;
    if (this.cosmicBackdrop) this.cosmicBackdrop.reducedMotion = next;
    if (this.blackHoleBackdrop) this.blackHoleBackdrop.reducedMotion = next;
    for (const trail of new Set(this.saberTrails.values())) trail.reducedMotion = next;
    this._resetSaberTrails(this._gameTime());
    if (next && this.composer) {
      this.composer.dispose?.();
      this.composer = null;
      this.bloomPass = null;
    } else if (!next && !this.lowPower && this.renderer && !this.composer) {
      void this._setupPostProcessing();
    }
    return next;
  }

  _updateDesktopSabers() {
    if (this.renderer?.xr?.isPresenting) return;
    const elapsed = this._gameTime();
    for (const [index, controller] of this.controllers.entries()) {
      const hand = controller.userData.hand || (index === 0 ? Hand.LEFT : Hand.RIGHT);
      const pointerHand = hand === Hand.RIGHT;
      let x = pointerHand && this.desktopPointer.active ? 0.62 + this.desktopPointer.x * 0.72 : hand === Hand.LEFT ? -0.62 : 0.62;
      let y = pointerHand && this.desktopPointer.active ? 1.05 + this.desktopPointer.y * 0.42 : 1.02;
      let autoRotation = null;
      let autoTarget = null;
      if (this.mode === GAME_MODES.AUTO && this.phase === GamePhase.PLAYING) {
        const target = [...this.runtime.active]
          .filter((note) => note.hand === hand && note.time >= elapsed - 0.08)
          .sort((first, second) => Math.abs(first.time - elapsed) - Math.abs(second.time - elapsed))[0];
        autoTarget = target || null;
        if (target) {
          const proximity = THREE.MathUtils.clamp(1 - Math.abs(target.time - elapsed) / 0.42, 0, 1);
          const strike = proximity * proximity * (3 - 2 * proximity);
          x = THREE.MathUtils.lerp(x, laneToX(target.lane), strike);
          y = THREE.MathUtils.lerp(y, rowToY(target.row), strike);
          autoRotation = directionRotationZ(target.direction) + Math.sin(proximity * Math.PI) * (hand === Hand.LEFT ? -0.32 : 0.32);
        }
      }
      const previousAutoTarget = controller.userData.desktopAutoTarget;
      const trail = controller.userData.saberTrail || this.saberTrails.get(hand);
      if (this.mode === GAME_MODES.AUTO && this.phase === GamePhase.PLAYING) {
        // A different note is a choreography cut, not one continuous physical
        // swing. Break history before moving to it so the trail cannot bridge
        // distant targets into a bright screen-sized polygon.
        if (previousAutoTarget !== undefined && previousAutoTarget !== autoTarget) trail?.reset?.(elapsed);
        controller.userData.desktopAutoTarget = autoTarget;
      } else if (previousAutoTarget !== undefined) {
        trail?.reset?.(elapsed);
        delete controller.userData.desktopAutoTarget;
      }
      // WebXR target rays start hidden with matrixAutoUpdate disabled until an
      // immersive input pose exists. Outside XR these nodes are our visible
      // stage sabers, so restore normal Three.js transforms explicitly.
      controller.visible = true;
      controller.matrixAutoUpdate = true;
      const rotationX = 0.58 + (pointerHand ? this.desktopPointer.y * 0.12 : 0);
      const rotationZ = autoRotation ?? (pointerHand ? -0.12 : 0.12);
      if (!controller.userData.desktopPoseInitialized || this.reducedMotion) {
        controller.position.set(x, y, DESKTOP_SABER_Z);
        controller.rotation.set(rotationX, 0, rotationZ);
        controller.userData.desktopPoseInitialized = true;
      } else {
        // Smooth target changes so an automatic hand-off between notes draws a
        // readable curved ribbon rather than one giant full-screen sheet.
        const easing = this.mode === GAME_MODES.AUTO ? 0.34 : 0.46;
        controller.position.x += (x - controller.position.x) * easing;
        controller.position.y += (y - controller.position.y) * easing;
        controller.position.z = DESKTOP_SABER_Z;
        controller.rotation.x += (rotationX - controller.rotation.x) * easing;
        controller.rotation.y = 0;
        controller.rotation.z = wrapAngle(controller.rotation.z + wrapAngle(rotationZ - controller.rotation.z) * easing);
      }
      controller.updateMatrix?.();
      controller.matrixWorldNeedsUpdate = true;
    }
  }

  _updateBeatmap(elapsed) {
    if (this.mode === GAME_MODES.ZEN) {
      this.sweepQueue.length = 0;
      if (shouldFinishMode({ mode: this.mode, elapsed, trackDuration: this.track?.duration, runtimeComplete: false })) this._finish(false);
      return;
    }
    const update = this.runtime.update(elapsed);
    for (const note of update.spawned) this._spawnNoteMesh(note);
    for (const note of update.missed) {
      if (this.mode === GAME_MODES.AUTO) this._hitNote(note, autoPerfectJudgement());
      else this._missNote(note, 'miss');
    }
    for (const note of update.active) this._updateNoteMesh(note, elapsed);
    if (this.mode === GAME_MODES.AUTO) {
      for (const note of [...this.runtime.active]) {
        if (isAutoPerfectMoment(note, elapsed)) this._hitNote(note, autoPerfectJudgement());
      }
    }
    if (shouldFinishMode({ mode: this.mode, elapsed, trackDuration: this.track?.duration, runtimeComplete: update.complete })) this._finish(false);
  }

  _updateObstacles(elapsed) {
    if (this.mode === GAME_MODES.ZEN) return;
    const incoming = [...this.obstacleRuntime.active]
      .filter((obstacle) => obstacle.time >= elapsed)
      .sort((first, second) => first.time - second.time)[0];
    if (this.mode === GAME_MODES.AUTO && incoming && incoming.time - elapsed <= 0.82) {
      this.dodge(incoming.safeLane, { source: 'auto' });
    }
    const playerLane = this.mode === GAME_MODES.AUTO && incoming?.time - elapsed <= 0.82
      ? incoming.safeLane
      : this._currentObstacleLane();
    const update = this.obstacleRuntime.update(elapsed, playerLane);
    for (const obstacle of update.spawned) this._spawnObstacleMesh(obstacle);
    for (const obstacle of update.active) this._updateObstacleMesh(obstacle, elapsed);
    for (const settlement of update.passed) {
      this._removeObstacleMesh(settlement.id);
      this._emit(GameplayEvent.OBSTACLE, { ...settlement, source: this.mode === GAME_MODES.AUTO ? 'auto' : 'player' });
    }
    for (const settlement of update.collided) {
      this._removeObstacleMesh(settlement.id);
      this._handleObstacleCollision(settlement);
    }
  }

  _currentObstacleLane() {
    if (!this.renderer?.xr?.isPresenting) return this.dodgeState.lane;
    const xrCamera = this.renderer.xr.getCamera?.(this.camera);
    if (!xrCamera) return 0;
    const position = xrCamera.getWorldPosition(new THREE.Vector3());
    return Math.abs(position.x) >= 0.28 ? Math.sign(position.x) : 0;
  }

  _spawnObstacleMesh(obstacle) {
    if (!obstacle || this.obstacleMeshes.has(obstacle.id)) return;
    const theme = this.activeTheme || THEME_PRESETS.neon;
    const style = DAMAGE_STYLES[this.damageStyle] || DAMAGE_STYLES.voltaic;
    const color = style.hurt || theme.bloom;
    const group = new THREE.Group();
    group.name = `obstacle-${obstacle.id}`;
    group.userData.obstacleId = obstacle.id;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.58, 3.05, 0.28),
      new THREE.MeshPhysicalMaterial({
        color,
        emissive: color,
        emissiveIntensity: this.lowPower ? 1.9 : 2.65,
        roughness: 0.2,
        metalness: 0.08,
        transparent: true,
        opacity: this.lowPower ? 0.46 : 0.5,
        transmission: this.lowPower ? 0 : 0.12,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    body.name = 'obstacle-wall';
    body.position.set(obstacle.blockedLane * 1.02, 1.52, 0);
    const aura = new THREE.Mesh(
      new THREE.BoxGeometry(1.78, 3.25, 0.38),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: this.lowPower ? 0.24 : 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide, toneMapped: false }),
    );
    aura.name = 'obstacle-wall-aura';
    aura.position.copy(body.position);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(body.geometry, 18),
      new THREE.LineBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.98, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    edges.name = 'obstacle-wall-rim';
    edges.position.copy(body.position);
    const safeArrow = this._createDirectionArrow(obstacle.safeLane < 0 ? CutDirection.LEFT : CutDirection.RIGHT, true);
    safeArrow.name = 'obstacle-safe-arrow';
    safeArrow.position.set(body.position.x, 1.55, 0.18);
    safeArrow.scale.setScalar(2.25);
    group.add(aura, body, edges, safeArrow);
    if (!this.lowPower) {
      const light = new THREE.PointLight(color, 8.5, 5.4, 1.55);
      light.name = 'obstacle-warning-light';
      light.position.set(body.position.x, 1.45, 0.55);
      group.add(light);
    }
    this.obstacleGroup.add(group);
    this.obstacleMeshes.set(obstacle.id, group);
    this._updateObstacleMesh(obstacle, this._gameTime());
  }

  _updateObstacleMesh(obstacle, elapsed) {
    const mesh = this.obstacleMeshes.get(obstacle.id);
    if (!mesh) return;
    const progress = 1 - THREE.MathUtils.clamp((obstacle.time - elapsed) / Math.max(0.01, this.rules.spawnAhead), 0, 1);
    mesh.position.z = SPAWN_Z + (NOTE_PLANE_Z - SPAWN_Z) * progress;
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * 11 + obstacle.time);
    const wall = mesh.getObjectByName('obstacle-wall');
    const aura = mesh.getObjectByName('obstacle-wall-aura');
    if (wall?.material) wall.material.emissiveIntensity = (this.lowPower ? 1.7 : 2.2) + progress * 1.35 + pulse * 0.42;
    if (aura?.material) aura.material.opacity = (this.lowPower ? 0.2 : 0.25) + progress * 0.18 + pulse * 0.06;
  }

  _handleObstacleCollision(settlement) {
    const damage = this.score.damage(this.rules.hazardDamage, 'obstacle', true);
    const state = damage.state;
    const impact = new THREE.Vector3(settlement.blockedLane * 0.65, 1.3, NOTE_PLANE_Z);
    this._spawnImpactRing(impact, settlement.blockedLane < 0 ? Hand.LEFT : Hand.RIGHT, true);
    this._spawnHitEffect(impact, settlement.blockedLane < 0 ? Hand.LEFT : Hand.RIGHT, true);
    this._flashSaber(Hand.LEFT, true);
    this._flashSaber(Hand.RIGHT, true);
    this.vrHud?.flashMiss?.('OBSTACLE', { redraw: false });
    this.vrHud?.update?.({ time: this._gameTime(), duration: this.track?.duration, state, mode: this.mode, phase: this.phase, title: displayTrackTitle(this.track) }, { force: true });
    this._emit(GameplayEvent.OBSTACLE, { ...settlement, outcome: 'collided', state });
    this._emit(GameplayEvent.DAMAGE, { reason: 'obstacle', obstacle: settlement, state });
    if (state.health <= 0) this._finish(true);
  }

  _processSweeps(elapsed) {
    if (this.mode !== GAME_MODES.STANDARD) {
      this.sweepQueue.length = 0;
      return;
    }
    const sweeps = this.sweepQueue.splice(0, this.sweepQueue.length);
    for (const sweep of sweeps) {
      let best = null;
      for (const note of this.runtime.active) {
        const judgement = judgeCut(note, sweep, elapsed, this.rules);
        if (judgement.ok) {
          if (!best || Math.abs(judgement.timing) < Math.abs(best.judgement.timing)) best = { note, judgement };
        } else if (['wrong-hand', 'wrong-direction'].includes(judgement.reason) && judgement.distance !== undefined && judgement.distance < this.rules.saberRadius) {
          const state = this.score.wrongCut(judgement.reason);
          this._emit(GameplayEvent.DAMAGE, { reason: judgement.reason, state });
          this.vrHud?.flashMiss?.(judgement.reason, { redraw: false });
          this.vrHud?.update?.({
            time: this._gameTime(),
            duration: this.track?.duration,
            state,
            mode: this.mode,
            phase: this.phase,
            title: displayTrackTitle(this.track),
          }, { force: true });
          this._flashSaber(sweep.hand, true);
          if (state.health <= 0) this._finish(true);
        }
      }
      if (best) this._hitNote(best.note, best.judgement);
    }
  }

  _spawnNoteMesh(note) {
    if (this.mode === GAME_MODES.ZEN) return;
    const style = DAMAGE_STYLES[this.damageStyle] || DAMAGE_STYLES.voltaic;
    const color = style[note.hand] || (note.hand === Hand.LEFT ? HAND_COLORS[Hand.LEFT] : HAND_COLORS[Hand.RIGHT]);
    const mesh = new THREE.Group();
    mesh.name = `note-${note.id}`;
    mesh.userData.noteId = note.id;
    mesh.userData.stableRotation = true;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.32),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        // Preserve hand colour and arrow readability under desktop bloom.
        emissiveIntensity: note.accent ? 1.08 : 0.74,
        roughness: 0.28,
        metalness: 0.12,
      }),
    );
    body.name = 'note-body';
    body.castShadow = true;
    const rim = new THREE.LineSegments(
      new THREE.EdgesGeometry(body.geometry, 24),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.92, toneMapped: false }),
    );
    rim.name = 'note-light-rim';
    rim.scale.setScalar(1.018);
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(0.54, 0.54, 0.35),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: note.accent ? 0.25 : 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide, toneMapped: false }),
    );
    glow.name = 'note-glow';
    const arrow = this._createDirectionArrow(note.direction || CutDirection.ANY, note.accent, color);
    mesh.add(body, rim, glow, arrow);
    this.noteGroup.add(mesh);
    this.noteMeshes.set(note.id, mesh);
    this._updateNoteMesh(note, this._gameTime());
  }

  _createDirectionArrow(direction, accent, glowColor = 0x7defff) {
    const dir = directionVector(direction) || { x: 0, y: 1 };
    const group = new THREE.Group();
    group.name = 'cut-direction';
    group.userData.direction = direction;
    // Beat Saber-style blocks use a high-contrast, flat symbol on the face.
    // Only this child rotates for direction; its parent block stays perfectly
    // front-facing for the entire approach.
    const faceMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: accent ? 1 : 0.94,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const outlineMaterial = new THREE.MeshBasicMaterial({
      color: 0x070914,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.88,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    // Keep the cut instruction crisp and readable without competing with the
    // saber trails or the black-hole accretion light. The additive layer is a
    // narrow edge whisper, not another HDR light source.
    const arrowGlow = new THREE.Color(glowColor).multiplyScalar(accent ? 1.05 : 0.78);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: arrowGlow,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: this.lowPower ? 0.07 : accent ? 0.18 : 0.12,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -0.5,
    });
    if (direction === CutDirection.ANY) {
      const glow = new THREE.Mesh(new THREE.CircleGeometry(accent ? 0.15 : 0.142, 24), glowMaterial);
      glow.position.z = -0.006;
      glow.name = 'any-direction-glow';
      const outline = new THREE.Mesh(new THREE.CircleGeometry(0.13, 24), outlineMaterial);
      outline.position.z = -0.002;
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.095, 24), faceMaterial);
      dot.position.z = 0.002;
      dot.name = 'any-direction-dot';
      group.add(glow, outline, dot);
    } else {
      const geometry = createCutArrowGeometry();
      const glow = new THREE.Mesh(geometry.clone(), glowMaterial);
      glow.scale.setScalar(accent ? 1.34 : 1.28);
      glow.position.z = -0.006;
      glow.name = 'direction-arrow-glow';
      const outline = new THREE.Mesh(geometry, outlineMaterial);
      outline.scale.setScalar(1.24);
      outline.position.z = -0.002;
      const arrow = new THREE.Mesh(geometry, faceMaterial);
      arrow.scale.setScalar(0.92);
      arrow.position.z = 0.002;
      arrow.name = 'direction-arrow-face';
      group.add(glow, outline, arrow);
    }
    group.userData.glowProfile = 'restrained';
    group.userData.hdrGlow = Boolean(accent);
    group.userData.glowColor = new THREE.Color(glowColor).getHex();
    group.position.z = 0.172;
    group.rotation.z = directionRotationZ(direction, dir);
    return group;
  }

  _updateNoteMesh(note, elapsed) {
    const mesh = this.noteMeshes.get(note.id);
    if (!mesh) return;
    const { position: pos, rotation } = noteVisualTransform(note, elapsed, this.rules);
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.rotation.set(rotation.x, rotation.y, rotation.z);
    if (!this.reducedMotion) {
      mesh.scale.setScalar((mesh.userData.touchArmed ? 1.1 : 1) + Math.sin(elapsed * 9 + note.time) * 0.025);
    } else {
      mesh.scale.setScalar(mesh.userData.touchArmed ? 1.08 : 1);
    }
  }

  _hitNote(note, judgement) {
    const hitPosition = this.noteMeshes.get(note.id)?.position?.clone?.() || new THREE.Vector3(laneToX(note.lane), rowToY(note.row), NOTE_PLANE_Z);
    this.runtime.resolve(note.id);
    this._removeNoteMesh(note.id);
    const result = this.score.hit(note, judgement);
    this._spawnHitEffect(hitPosition, note.hand, Boolean(note.accent || judgement?.automatic));
    this._spawnImpactRing(hitPosition, note.hand, Boolean(note.accent || judgement?.automatic));
    this._spawnSplitShards(hitPosition, note.hand, Boolean(note.accent || judgement?.automatic));
    const style = DAMAGE_STYLES[this.damageStyle] || DAMAGE_STYLES.voltaic;
    this.vrHud?.flashHit?.({ noteScore: result.noteScore, judgement, hand: note.hand, color: style[note.hand] }, { redraw: false });
    this.vrHud?.update?.({
      time: this._gameTime(),
      duration: this.track?.duration,
      state: result.state,
      mode: this.mode,
      phase: this.phase,
      title: displayTrackTitle(this.track),
    });
    this._flashSaber(note.hand, false, { accent: Boolean(note.accent), automatic: Boolean(judgement?.automatic) });
    this._emit(GameplayEvent.NOTE_HIT, { note: publicNote(note), judgement, noteScore: result.noteScore, state: result.state });
  }

  _missNote(note, reason) {
    this._removeNoteMesh(note.id);
    const state = this.score.miss(reason);
    this.vrHud?.flashMiss?.(reason, { redraw: false });
    this.vrHud?.update?.({
      time: this._gameTime(),
      duration: this.track?.duration,
      state,
      mode: this.mode,
      phase: this.phase,
      title: displayTrackTitle(this.track),
    }, { force: true });
    this._emit(GameplayEvent.NOTE_MISS, { note: publicNote(note), reason, state });
    this._emit(GameplayEvent.DAMAGE, { reason, state });
    this._flashSaber(note.hand, true);
    if (state.health <= 0) this._finish(true);
  }

  _finish(failed) {
    if (this.phase === GamePhase.RESULTS) return;
    const finalTime = this._gameTime();
    this.music?.stop?.();
    this.clock.stop();
    const results = this.score.results(this.mode === GAME_MODES.ZEN ? 0 : this.beatmap.length);
    this._setPhase(GamePhase.RESULTS, finalTime, results);
    this._emit(GameplayEvent.RESULTS, { ...results, failed, mode: this.mode });
  }

  _flashSaber(hand, hurt, { accent = false, automatic = false } = {}) {
    const saber = this.sabers.get(hand);
    if (!saber) return;
    const style = DAMAGE_STYLES[this.damageStyle] || DAMAGE_STYLES.voltaic;
    const blade = saber.getObjectByName(`${hand}-blade`);
    if (!blade?.material) return;
    const color = hurt ? style.hurt : style[hand];
    blade.material.color.setHex(color);
    blade.material.emissive.setHex(color);
    if (!this.reducedMotion) {
      saber.scale.setScalar(hurt ? 1.16 : 1.08);
      const timer = setTimeout(() => {
        this.pendingTimers.delete(timer);
        if (!this.disposed) saber.scale.setScalar(1);
      }, 90);
      this.pendingTimers.add(timer);
    }
    const haptics = createHapticProfile({ hurt, accent, automatic, lowPower: this.lowPower });
    this._pulseHaptics(hand, haptics.intensity, haptics.duration);
    if (hurt) this._spawnDamageEffect(hand);
  }

  _animateWorld(elapsed) {
    const motionScale = this.reducedMotion ? 0.12 : 1;
    const bpm = Math.max(60, Number(this.track?.bpm) || 120);
    const beatPhase = (elapsed * bpm) / 60;
    const beatFraction = beatPhase - Math.floor(beatPhase);
    const beatPulse = Math.exp(-beatFraction * 7.2);
    const barWave = 0.5 + 0.5 * Math.sin((beatPhase / 4) * Math.PI * 2);
    this.cosmicBackdrop?.update?.(elapsed, beatPulse);
    this.blackHoleBackdrop?.update?.(elapsed, beatPulse);
    if (this.worldLights) {
      this.worldLights.leftRim.intensity = 11 + beatPulse * 15 * motionScale;
      this.worldLights.rightRim.intensity = 11 + (beatPulse * 12 + barWave * 3) * motionScale;
      this.worldLights.beatLight.intensity += (8 + beatPulse * 17 - this.worldLights.beatLight.intensity) * 0.16;
      this.worldLights.key.intensity = 1.7 + beatPulse * 0.9 * motionScale;
    }
    if (this.scene?.fog?.isFogExp2) this.scene.fog.density = 0.032 + (1 - beatPulse) * 0.006;
    if (this.bloomPass) this.bloomPass.strength = 0.88 + beatPulse * 0.38 * motionScale;
    for (const hand of [Hand.LEFT, Hand.RIGHT]) {
      const light = this.sabers.get(hand)?.getObjectByName(`${hand}-blade-light`);
      const trail = this.saberTrails.get(hand);
      if (!light) continue;
      const motionBoost = Math.min(0.42, (trail?.currentIntensity || 0) * 0.075);
      light.intensity = (light.userData.baseIntensity || light.intensity || 1) * (1 + beatPulse * 0.12 * motionScale + motionBoost);
    }
    this.environmentGroup.children.forEach((object, index) => {
      const motion = object.userData?.motion;
      const phase = object.userData?.phase || index * 0.31;
      if (motion === 'warpGate') object.rotation.z = Math.sin(elapsed * 0.7 + phase) * 0.12 * motionScale;
      if (motion === 'equalizer') object.scale.y = 0.72 + (0.28 + Math.sin(elapsed * 5.5 + phase) * 0.18) * motionScale;
      if (motion === 'floorPulse' && object.material) object.material.emissiveIntensity = 0.12 + (0.1 + Math.sin(elapsed * 2.1) * 0.05) * motionScale;
      if (motion === 'skyBreath' && object.material?.color) object.material.color.copy(object.userData.baseColor).lerp(object.userData.pulseColor, (0.08 + beatPulse * 0.1) * motionScale);
      if (motion === 'laneRail' && object.material) object.material.opacity = 0.38 + beatPulse * 0.5 * motionScale;
      if (motion === 'hitGate') {
        object.scale.x = 1 + beatPulse * 0.07 * motionScale;
        if (object.material) object.material.opacity = 0.42 + beatPulse * 0.48 * motionScale;
      }
      if (motion === 'piston') object.position.y = object.userData.baseY + Math.sin(elapsed * 1.8 + phase) * 0.58 * motionScale;
      if (motion === 'furnace' && object.material) object.material.emissiveIntensity = 1.5 + (0.9 + Math.sin(elapsed * 4.2 + phase) * 0.55) * motionScale;
      if (motion === 'lavaSeam' && object.material) object.material.emissiveIntensity = 1.2 + (1.1 + Math.sin(elapsed * 3.4 + phase) * 0.7) * motionScale;
      if (motion === 'orbitHalo') {
        object.rotation.z += 0.0028 * motionScale * (index % 2 ? -1 : 1);
        object.rotation.y = Math.sin(elapsed * 0.35 + phase) * 0.14 * motionScale;
      }
      if (motion === 'glassShard') {
        object.rotation.x += 0.005 * motionScale;
        object.rotation.y -= 0.007 * motionScale;
        object.position.y = object.userData.baseY + Math.sin(elapsed * 1.2 + phase) * 0.32 * motionScale;
      }
      if (motion === 'signatureFloat') {
        object.position.y = object.userData.baseY + Math.sin(elapsed * 0.72 + phase) * 0.26 * motionScale;
        object.rotation.y += 0.0022 * object.userData.spin * motionScale;
        object.rotation.z += 0.0011 * object.userData.spin * motionScale;
        if (object.material) object.material.emissiveIntensity = 0.85 + beatPulse * 1.15 * motionScale;
      }
      if (motion === 'horizonPulse') {
        const scale = 1 + beatPulse * 0.045 * motionScale;
        object.scale.setScalar(scale);
        if (object.material) object.material.opacity = 0.38 + beatPulse * 0.4 * motionScale;
      }
      if (motion === 'canopyArch') {
        object.rotation.y = Math.sin(elapsed * 0.32 + phase) * 0.08 * motionScale;
        if (object.material) object.material.emissiveIntensity = 0.7 + beatPulse * 0.85 * motionScale;
      }
      if (object.isPoints) animateParticleField(object, motion, motionScale);
    });
  }

  _pulseHaptics(hand, intensity, duration) {
    const controller = this.controllers.find((candidate) => (candidate.userData.hand || candidate.userData.inputSource?.handedness) === hand);
    const gamepad = controller?.userData.inputSource?.gamepad;
    const actuator = gamepad?.hapticActuators?.[0] || gamepad?.vibrationActuator;
    try {
      if (typeof actuator?.pulse === 'function') actuator.pulse(intensity, duration);
      else actuator?.playEffect?.('dual-rumble', { duration, strongMagnitude: intensity, weakMagnitude: intensity * 0.55 });
    } catch {
      // Haptics are optional and vary by WebXR runtime.
    }
  }

  _screenPointToWorld(clientX, clientY, z = NOTE_PLANE_Z + 0.08) {
    if (!this.camera || !this.canvas) return null;
    const rect = this.canvas.getBoundingClientRect?.() || { left: 0, top: 0, width: 1, height: 1 };
    this.touchPointer.set(
      ((Number(clientX) - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      1 - ((Number(clientY) - rect.top) / Math.max(1, rect.height)) * 2,
    );
    this.camera.updateMatrixWorld?.(true);
    this.touchRaycaster.setFromCamera(this.touchPointer, this.camera);
    return this.touchRaycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), new THREE.Vector3());
  }

  _spawnTouchSlash(gesture, note, success = true) {
    if (!this.scene) return;
    const style = DAMAGE_STYLES[this.damageStyle] || DAMAGE_STYLES.voltaic;
    const color = success ? (style[note.hand] || HAND_COLORS[note.hand]) : style.hurt;
    const expected = directionVector(note.direction) || directionVector(vectorToCutDirection(gesture.lastX - gesture.startX, -(gesture.lastY - gesture.startY))) || { x: 0, y: 1 };
    let start = this._screenPointToWorld(gesture.startX, gesture.startY);
    let end = this._screenPointToWorld(gesture.lastX, gesture.lastY);
    const center = new THREE.Vector3(laneToX(note.lane), rowToY(note.row), NOTE_PLANE_Z + 0.1);
    if (!start) start = center.clone().add(new THREE.Vector3(-expected.x * 0.45, -expected.y * 0.45, 0));
    if (!end) end = center.clone().add(new THREE.Vector3(expected.x * 0.45, expected.y * 0.45, 0));
    let delta = end.clone().sub(start);
    if (delta.length() < 0.32) {
      start = center.clone().add(new THREE.Vector3(-expected.x * 0.52, -expected.y * 0.52, 0));
      end = center.clone().add(new THREE.Vector3(expected.x * 0.52, expected.y * 0.52, 0));
      delta = end.clone().sub(start);
    }
    if (delta.length() > 1.7) {
      delta.setLength(1.7);
      end = start.clone().add(delta);
    }
    const length = delta.length();
    const midpoint = start.clone().add(end).multiplyScalar(0.5);
    const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
    const group = new THREE.Group();
    group.name = success ? 'touch-saber-slash' : 'touch-saber-error';
    const aura = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.075, length, this.lowPower ? 8 : 14, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: this.lowPower ? 0.44 : 0.64, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    );
    aura.name = 'touch-saber-slash-aura';
    aura.position.copy(midpoint);
    aura.quaternion.copy(orientation);
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.026, length * 1.02, this.lowPower ? 8 : 12),
      new THREE.MeshBasicMaterial({ color: success ? 0xffffff : color, transparent: true, opacity: 0.98, depthWrite: false, toneMapped: false }),
    );
    core.name = 'touch-saber-slash-core';
    core.position.copy(midpoint);
    core.quaternion.copy(orientation);
    const light = new THREE.PointLight(color, this.lowPower ? 2.2 : 5.4, 4.6, 1.7);
    light.name = 'touch-saber-slash-light';
    light.position.copy(midpoint);
    group.add(aura, core, light);
    const now = performance.now() / 1000;
    group.userData = { born: now, last: now, kind: 'touch-slash', lifetime: this.reducedMotion ? 0.18 : success ? 0.38 : 0.3 };
    this.scene.add(group);
    this.damageEffects.push(group);
  }

  _spawnHitEffect(base, hand, accent = false) {
    if (!this.scene || this.reducedMotion) return;
    const style = DAMAGE_STYLES[this.damageStyle] || DAMAGE_STYLES.voltaic;
    const count = this.lowPower ? 8 : accent ? 34 : 20;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = [];
    const colorA = new THREE.Color(style[hand]);
    const colorB = new THREE.Color(accent ? 0xffffff : style.hurt);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = base.x;
      positions[index * 3 + 1] = base.y;
      positions[index * 3 + 2] = base.z;
      const color = index % 3 ? colorA : colorB;
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      const angle = (index / count) * Math.PI * 2 + Math.random() * 0.3;
      const speed = (accent ? 2.7 : 1.8) * (0.65 + Math.random() * 0.5);
      velocities.push(new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, (Math.random() - 0.5) * 1.7));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: accent ? 0.08 : 0.055, vertexColors: true, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    const now = performance.now() / 1000;
    points.userData = { born: now, last: now, velocities, styleKey: this.damageStyle || 'voltaic', motion: style.motion, kind: 'hit', lifetime: accent ? 0.54 : 0.4 };
    this.scene.add(points);
    this.damageEffects.push(points);
    if (this.worldLights?.beatLight) this.worldLights.beatLight.intensity += accent ? 18 : 8;
  }

  _spawnImpactRing(base, hand, accent = false) {
    if (!this.scene || this.reducedMotion) return;
    const style = DAMAGE_STYLES[this.damageStyle] || DAMAGE_STYLES.voltaic;
    const color = style[hand] || HAND_COLORS[hand] || 0xffffff;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(accent ? 0.22 : 0.18, accent ? 0.285 : 0.235, this.lowPower ? 24 : 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: accent ? 0.96 : 0.78,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    ring.name = 'hit-impact-ring';
    ring.position.copy(base);
    ring.position.z += 0.055;
    ring.renderOrder = 20;
    const now = performance.now() / 1000;
    ring.userData = { born: now, last: now, kind: 'impact-ring', lifetime: accent ? 0.46 : 0.34, accent };
    this.scene.add(ring);
    this.damageEffects.push(ring);
  }

  _spawnSplitShards(base, hand, accent = false) {
    if (!this.scene || this.reducedMotion) return;
    const style = DAMAGE_STYLES[this.damageStyle] || DAMAGE_STYLES.voltaic;
    const color = style[hand] || HAND_COLORS[hand] || 0xffffff;
    const count = this.lowPower ? 2 : accent ? 6 : 4;
    const group = new THREE.Group();
    group.name = 'hit-split-shards';
    group.position.copy(base);
    group.position.z += 0.035;
    const geometry = new THREE.TetrahedronGeometry(accent ? 0.15 : 0.115, 0);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: accent ? 0.9 : 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + (hand === Hand.LEFT ? 0.18 : -0.18);
      const speed = (accent ? 2.15 : 1.55) * (0.82 + (index % 3) * 0.12);
      const shard = new THREE.Mesh(geometry, material);
      shard.position.set(Math.cos(angle) * 0.08, Math.sin(angle) * 0.08, index % 2 ? 0.025 : -0.015);
      shard.rotation.set(angle * 0.35, angle * 0.65, angle);
      shard.userData.velocity = new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, (index % 2 ? 1 : -1) * 0.34);
      shard.userData.spin = new THREE.Vector3(4.2 + index * 0.25, 3.5 + index * 0.18, (index % 2 ? -1 : 1) * 5.4);
      group.add(shard);
    }
    const now = performance.now() / 1000;
    group.userData = { born: now, last: now, kind: 'split-shards', lifetime: accent ? 0.52 : 0.4 };
    this.scene.add(group);
    this.damageEffects.push(group);
  }

  _spawnDamageEffect(hand) {
    if (!this.scene || this.reducedMotion) return;
    const styleKey = this.damageStyle || 'voltaic';
    const style = DAMAGE_STYLES[styleKey] || DAMAGE_STYLES.voltaic;
    const count = this.lowPower ? 10 : ['embers', 'sand', 'petal'].includes(style.motion) ? 28 : 22;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = [];
    const base = new THREE.Vector3(hand === Hand.LEFT ? -0.55 : 0.55, 1.15, 1.1);
    const saber = this.sabers.get(hand);
    if (this.renderer?.xr?.isPresenting && saber) saber.getWorldPosition(base);
    const colorA = new THREE.Color(style.hurt);
    const colorB = new THREE.Color(style[hand]);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = base.x;
      positions[index * 3 + 1] = base.y;
      positions[index * 3 + 2] = base.z;
      const color = index % 2 ? colorA : colorB;
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      const spread = ['electric', 'glitch', 'flare'].includes(style.motion) ? 2.2 : ['prism', 'shard'].includes(style.motion) ? 1.5 : 1.08;
      velocities.push(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() * 0.9 + 0.25) * spread, (Math.random() - 0.5) * spread));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: ['embers', 'sand', 'petal'].includes(style.motion) ? 0.07 : ['prism', 'shard'].includes(style.motion) ? 0.09 : 0.055, vertexColors: true, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    const now = performance.now() / 1000;
    points.userData = { born: now, last: now, velocities, styleKey, motion: style.motion, kind: 'damage', lifetime: 0.72 };
    this.scene.add(points);
    this.damageEffects.push(points);
  }

  _animateDamageEffects() {
    const now = performance.now() / 1000;
    for (const effect of [...this.damageEffects]) {
      const age = now - effect.userData.born;
      const delta = Math.min(0.034, now - effect.userData.last);
      effect.userData.last = now;
      const lifetime = effect.userData.lifetime || 0.72;
      const progress = THREE.MathUtils.clamp(age / lifetime, 0, 1);
      if (effect.userData.kind === 'impact-ring') {
        const scale = 0.78 + progress * (effect.userData.accent ? 3.4 : 2.7);
        effect.scale.setScalar(scale);
        effect.rotation.z += delta * (effect.userData.accent ? 2.8 : 1.8);
        effect.material.opacity = Math.max(0, (effect.userData.accent ? 0.96 : 0.78) * (1 - progress));
        if (age >= lifetime) this._removeDamageEffect(effect);
        continue;
      }
      if (effect.userData.kind === 'split-shards') {
        for (const shard of effect.children) {
          shard.position.addScaledVector(shard.userData.velocity, delta);
          shard.userData.velocity.y -= 1.15 * delta;
          shard.rotation.x += shard.userData.spin.x * delta;
          shard.rotation.y += shard.userData.spin.y * delta;
          shard.rotation.z += shard.userData.spin.z * delta;
          shard.scale.setScalar(Math.max(0.05, 1 - progress * 0.72));
          shard.material.opacity = Math.max(0, 0.82 * (1 - progress));
        }
        if (age >= lifetime) this._removeDamageEffect(effect);
        continue;
      }
      if (effect.userData.kind === 'touch-slash') {
        for (const object of effect.children) {
          if (object.material) object.material.opacity = Math.max(0, (object.name.includes('aura') ? 0.64 : 0.98) * (1 - progress));
          if (object.isPointLight) object.intensity = Math.max(0, object.intensity * (1 - delta * 8));
        }
        effect.scale.setScalar(1 + progress * 0.14);
        if (age >= lifetime) this._removeDamageEffect(effect);
        continue;
      }
      const positions = effect.geometry.attributes.position;
      for (let index = 0; index < effect.userData.velocities.length; index += 1) {
        const velocity = effect.userData.velocities[index];
        if (['embers', 'sand', 'leaf', 'petal'].includes(effect.userData.motion)) velocity.y -= 1.7 * delta;
        if (effect.userData.motion === 'bubble') velocity.y += 0.55 * delta;
        if (effect.userData.motion === 'glitch' && index % 3 === 0) velocity.x *= -1;
        positions.array[index * 3] += velocity.x * delta;
        positions.array[index * 3 + 1] += velocity.y * delta;
        positions.array[index * 3 + 2] += velocity.z * delta;
      }
      positions.needsUpdate = true;
      effect.material.opacity = Math.max(0, 1 - age / lifetime);
      if (age >= lifetime) this._removeDamageEffect(effect);
    }
  }

  _removeDamageEffect(effect) {
    this.scene?.remove(effect);
    const geometries = new Set();
    const materials = new Set();
    effect.traverse?.((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material));
      else if (object.material) materials.add(object.material);
    });
    geometries.forEach((geometry) => geometry.dispose?.());
    materials.forEach((material) => material.dispose?.());
    this.damageEffects = this.damageEffects.filter((candidate) => candidate !== effect);
  }

  _clearDamageEffects() {
    for (const effect of [...this.damageEffects]) this._removeDamageEffect(effect);
  }

  _setPhase(phase, at = this._gameTime(), results = null) {
    this.phase = phase;
    const state = this.score.setPhase(phase, at);
    if (phase !== GamePhase.PLAYING) this._resetSaberTrails(at);
    this.vrHud?.update?.({
      time: at,
      duration: this.track?.duration,
      state,
      mode: this.mode,
      phase,
      title: displayTrackTitle(this.track),
    }, { force: true });
    this.vrMenu?.setPhase?.(phase, results || state);
    if (this.renderer?.xr?.isPresenting) {
      if (phase === GamePhase.PLAYING) this.closeVRMenu(`phase-${phase}`);
      else if ([GamePhase.MENU, GamePhase.PAUSED, GamePhase.RESULTS].includes(phase)) this.openVRMenu(`phase-${phase}`);
    }
    this._emit(GameplayEvent.PHASE, { phase, state, mode: this.mode });
  }

  _emitTick(time) {
    const state = this.score.snapshot();
    this.vrHud?.update?.({
      time,
      duration: this.track?.duration,
      state,
      mode: this.mode,
      phase: this.phase,
      title: displayTrackTitle(this.track),
    });
    this._emit(GameplayEvent.TICK, {
      time,
      activeNotes: this.mode === GAME_MODES.ZEN ? [] : this.runtime.active.map(publicNote),
      state,
      trackId: this.track?.id || null,
      mode: this.mode,
    });
  }

  _emit(type, detail) {
    this.eventTarget?.dispatchEvent?.(new CustomEvent(type, { detail }));
  }

  _removeNoteMesh(noteId) {
    const mesh = this.noteMeshes.get(noteId);
    if (!mesh) return;
    this.noteGroup.remove(mesh);
    mesh.traverse((object) => {
      object.geometry?.dispose?.();
      disposeMaterial(object.material);
    });
    this.noteMeshes.delete(noteId);
  }

  _clearNotes() {
    this.touchSlices.clear();
    for (const id of [...this.noteMeshes.keys()]) this._removeNoteMesh(id);
    clearGroup(this.noteGroup);
  }

  _removeObstacleMesh(obstacleId) {
    const mesh = this.obstacleMeshes.get(obstacleId);
    if (!mesh) return;
    this.obstacleGroup.remove(mesh);
    mesh.traverse((object) => {
      object.geometry?.dispose?.();
      disposeMaterial(object.material);
    });
    this.obstacleMeshes.delete(obstacleId);
  }

  _clearObstacles() {
    for (const id of [...this.obstacleMeshes.keys()]) this._removeObstacleMesh(id);
    clearGroup(this.obstacleGroup);
  }
}

export function displayTrackTitle(track) {
  return trackTitleZh(track);
}

export function createBeatmapFromTrack(track) {
  if (Array.isArray(track?.beatmap)) return track.beatmap.map((note, index) => normalizeGameNote(note, index, track?.id));
  if (Array.isArray(track?.notes)) return track.notes.map((note, index) => normalizeGameNote(note, index, track?.id));
  if (track?.id && getTrack(track.id)) return createBeatmap(track).map((note, index) => normalizeGameNote(note, index, track.id));
  const bpm = Number(track?.bpm) || 120;
  const duration = Math.max(20, Math.min(Number(track?.duration) || 72, 240));
  const beat = 60 / bpm;
  const directions = [CutDirection.DOWN, CutDirection.UP, CutDirection.LEFT, CutDirection.RIGHT, CutDirection.DOWN_LEFT, CutDirection.DOWN_RIGHT];
  const notes = [];
  let index = 0;
  for (let time = beat * 4; time < duration - beat * 2; time += beat) {
    if (index % 7 === 6) {
      index += 1;
      continue;
    }
    const hand = index % 2 === 0 ? Hand.LEFT : Hand.RIGHT;
    const lane = hand === Hand.LEFT ? [-1.5, -0.5][index % 2] : [0.5, 1.5][index % 2];
    notes.push({
      id: `${track?.id || 'track'}-${index}`,
      time: Number(time.toFixed(3)),
      lane,
      row: index % NOTE_ROW_COUNT,
      hand,
      direction: directions[index % directions.length],
      accent: index % 8 === 0,
    });
    index += 1;
  }
  return notes;
}

export function normalizeGameNote(note, index = 0, trackId = 'track') {
  const lanes = [-1.5, -0.5, 0.5, 1.5];
  const laneValue = Number(note?.lane);
  const lane = lanes.reduce((closest, candidate) => (Math.abs(candidate - laneValue) < Math.abs(closest - laneValue) ? candidate : closest), lanes[0]);
  const row = Math.max(0, Math.min(NOTE_ROW_COUNT - 1, Math.round(Number(note?.row) || 0)));
  const direction = note?.direction === CutDirection.ANY || directionVector(note?.direction) ? note?.direction : CutDirection.ANY;
  const normalized = {
    ...note,
    id: note?.id || `${trackId || 'track'}-${index}`,
    lane,
    row,
    hand: note?.hand === Hand.RIGHT ? Hand.RIGHT : Hand.LEFT,
    direction,
  };
  // Preserve authored object shape for deterministic track integration. A
  // missing accent and an explicit false accent behave identically at runtime.
  if (Object.prototype.hasOwnProperty.call(note || {}, 'accent')) normalized.accent = Boolean(note.accent);
  return normalized;
}

export function directionRotationZ(direction, vector = directionVector(direction) || { x: 0, y: 1 }) {
  if (direction === CutDirection.ANY) return 0;
  return Math.atan2(-vector.x, vector.y);
}

export function noteVisualTransform(note, elapsed, rules = DEFAULT_RULES) {
  const normalized = normalizeGameNote(note);
  return {
    position: noteWorldPosition(normalized, elapsed, rules),
    // Direction is encoded exclusively by the front-face arrow. Flying notes do
    // not roll, yaw, or spin, so the instruction remains readable at all times.
    rotation: { x: 0, y: 0, z: 0 },
    arrowRotationZ: directionRotationZ(normalized.direction),
  };
}

export function approachDistanceFromViewer(viewerZ = 0) {
  return Math.abs((Number(viewerZ) || 0) - NOTE_PLANE_Z);
}

export function vectorToCutDirection(x, y) {
  const angle = Math.atan2(Number(y) || 0, Number(x) || 0);
  const octant = Math.round(angle / (Math.PI / 4));
  return ({
    0: CutDirection.RIGHT,
    1: CutDirection.UP_RIGHT,
    2: CutDirection.UP,
    3: CutDirection.UP_LEFT,
    4: CutDirection.LEFT,
    '-4': CutDirection.LEFT,
    '-3': CutDirection.DOWN_LEFT,
    '-2': CutDirection.DOWN,
    '-1': CutDirection.DOWN_RIGHT,
  })[octant] || CutDirection.UP;
}

export function evaluateTouchSwipe(direction, startX, startY, endX, endY, { minDistance = 28, minAlignment = 0.58 } = {}) {
  const dx = (Number(endX) || 0) - (Number(startX) || 0);
  // Screen-space Y grows downwards while beatmap directions grow upwards.
  const dy = -((Number(endY) || 0) - (Number(startY) || 0));
  const distance = Math.hypot(dx, dy);
  if (distance < Math.max(8, Number(minDistance) || 28)) {
    return { ready: false, ok: false, reason: 'too-short', distance, alignment: 0, direction: vectorToCutDirection(dx, dy) };
  }
  const actualDirection = vectorToCutDirection(dx, dy);
  if (direction === CutDirection.ANY) return { ready: true, ok: true, reason: 'match', distance, alignment: 1, direction: actualDirection };
  const expected = directionVector(direction);
  if (!expected) return { ready: true, ok: false, reason: 'invalid-direction', distance, alignment: 0, direction: actualDirection };
  const alignment = (dx * expected.x + dy * expected.y) / Math.max(0.0001, distance);
  return {
    ready: true,
    ok: alignment >= THREE.MathUtils.clamp(Number(minAlignment) || 0.58, 0, 1),
    reason: alignment >= THREE.MathUtils.clamp(Number(minAlignment) || 0.58, 0, 1) ? 'match' : 'wrong-direction',
    distance,
    alignment,
    direction: actualDirection,
  };
}

export function autoPerfectJudgement() {
  return { ok: true, reason: 'auto-perfect', timing: 0, distance: 0, alignment: 1, automatic: true, quality: 'perfect' };
}

export function isAutoPerfectMoment(note, elapsed) {
  return Number.isFinite(Number(note?.time)) && Number(elapsed) >= Number(note.time);
}

export function shouldFinishMode({ mode, elapsed, trackDuration, runtimeComplete } = {}) {
  const normalizedMode = normalizeGameMode(mode);
  const time = Math.max(0, Number(elapsed) || 0);
  if (normalizedMode === GAME_MODES.ZEN) {
    // Pure-enjoyment mode is driven by the full audio duration rather than an
    // intentionally empty BeatmapRuntime, so it can never end after 0.5 s.
    return time >= Math.max(1, Number(trackDuration) || 72);
  }
  return Boolean(runtimeComplete) && time > 0.5;
}

function createCutArrowGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.055, -0.17);
  shape.lineTo(0.055, -0.17);
  shape.lineTo(0.055, 0.025);
  shape.lineTo(0.14, 0.025);
  shape.lineTo(0, 0.19);
  shape.lineTo(-0.14, 0.025);
  shape.lineTo(-0.055, 0.025);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.computeVertexNormals();
  return geometry;
}

function wrapAngle(value) {
  const twoPi = Math.PI * 2;
  return ((value + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
}

function createThemeGeometry(archetype, index) {
  const size = 0.16 + (index % 5) * 0.045;
  if (archetype === 'petals') {
    const geometry = new THREE.CircleGeometry(size * 1.6, 5);
    geometry.scale(0.55, 1.5, 1);
    return geometry;
  }
  if (archetype === 'depth') return new THREE.TorusGeometry(size * 1.6, 0.035, 6, 24);
  if (archetype === 'sun') return index % 3 === 0 ? new THREE.TorusGeometry(size * 2, 0.045, 7, 28) : new THREE.IcosahedronGeometry(size, 0);
  if (archetype === 'crystal') {
    const geometry = new THREE.OctahedronGeometry(size, 0);
    geometry.scale(0.72, 2.4, 0.72);
    return geometry;
  }
  if (archetype === 'canopy') return index % 2 ? new THREE.IcosahedronGeometry(size * 1.4, 0) : new THREE.TorusGeometry(size * 1.5, 0.055, 6, 18);
  if (archetype === 'dunes') {
    const geometry = new THREE.ConeGeometry(size * 1.5, size * 3.4, 4);
    geometry.rotateZ(Math.PI / 2);
    return geometry;
  }
  if (archetype === 'digital') return index % 2 ? new THREE.BoxGeometry(size, size * 2.6, size) : new THREE.TetrahedronGeometry(size * 1.3, 0);
  return new THREE.DodecahedronGeometry(size, 0);
}

function clearGroup(group) {
  while (group.children.length) {
    const object = group.children[group.children.length - 1];
    group.remove(object);
    object.traverse?.((child) => {
      child.geometry?.dispose?.();
      disposeMaterial(child.material);
    });
  }
}

function disposeMaterial(material) {
  const materials = Array.isArray(material) ? material : material ? [material] : [];
  for (const candidate of materials) {
    for (const value of Object.values(candidate)) {
      if (value?.isTexture) value.dispose?.();
    }
    candidate.dispose?.();
  }
}

function publicNote(note) {
  return { id: note.id, time: note.time, lane: note.lane, row: note.row, hand: note.hand, direction: note.direction, accent: Boolean(note.accent) };
}

function pickTheme(seed = '') {
  const keys = Object.keys(THEME_PRESETS);
  return keys[Math.abs(hashString(seed)) % keys.length];
}

function pickDamageStyle(seed = '') {
  const keys = Object.keys(DAMAGE_STYLES);
  return keys[Math.abs(hashString(seed || 'damage')) % keys.length];
}

function resolveTheme(track) {
  if (TRACK_THEME[track?.id]) return TRACK_THEME[track.id];
  const aliases = { 'neon-ocean': 'neon', 'ember-forge': 'magma', 'glass-orbit': 'orbit', forge: 'magma', glacier: 'ice' };
  const declared = typeof track?.environment === 'string'
    ? track.environment
    : track?.environment?.theme || track?.environment?.key || track?.environment?.biome || track?.environment?.name;
  const declaredKey = String(declared || '').toLowerCase();
  if (THEME_PRESETS[declaredKey]) return declaredKey;
  if (aliases[declaredKey]) return aliases[declaredKey];
  const biome = String(track?.environment?.biome || track?.environment?.name || declared || '').toLowerCase();
  if (/forge|furnace|magma|熔|炉/.test(biome)) return 'magma';
  if (/orbit|glass|rain|crystal|轨|晶/.test(biome)) return 'orbit';
  if (/neon|causeway|tide|霓虹|星港/.test(biome)) return 'neon';
  if (/sakura|cherry|petal|樱/.test(biome)) return 'sakura';
  if (/abyss|deep|trench|深渊|海沟/.test(biome)) return 'abyss';
  if (/solar|sun|helios|日曜|太阳/.test(biome)) return 'solar';
  if (/ice|cryo|frost|glacier|冰|霜/.test(biome)) return 'ice';
  if (/jungle|jade|canopy|forest|雨林|翡翠/.test(biome)) return 'jungle';
  if (/desert|dune|sand|沙|荒漠/.test(biome)) return 'desert';
  if (/void|pixel|digital|虚空|像素/.test(biome)) return 'void';
  return pickTheme(track?.id);
}

function resolveDamageStyle(track) {
  if (TRACK_DAMAGE[track?.id]) return TRACK_DAMAGE[track.id];
  if (typeof track?.damageStyle === 'string' && DAMAGE_STYLES[track.damageStyle]) return track.damageStyle;
  const declared = String(track?.damageStyle?.key || track?.damageStyle?.theme || '').toLowerCase();
  if (DAMAGE_STYLES[declared]) return declared;
  const name = String(track?.damageStyle?.name || '').toLowerCase();
  if (/molten|ember|heat|熔|烬/.test(name)) return 'ember';
  if (/crystal|prism|glass|晶|棱/.test(name)) return 'prism';
  if (/static|electric|surf|电|浪/.test(name)) return 'voltaic';
  return THEME_DAMAGE[resolveTheme(track)] || pickDamageStyle(track?.id);
}

function createParticleField({ count, color, rangeX, minY, maxY, minZ, maxZ, size, motion }) {
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (Math.random() - 0.5) * rangeX;
    positions[index * 3 + 1] = minY + Math.random() * (maxY - minY);
    positions[index * 3 + 2] = minZ + Math.random() * (maxZ - minZ);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particles = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.72, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  particles.userData.motion = motion;
  particles.userData.bounds = { rangeX, minY, maxY, minZ, maxZ };
  return particles;
}

function animateParticleField(points, motion, motionScale) {
  if (!motion || !points.geometry?.attributes?.position) return;
  const attribute = points.geometry.attributes.position;
  const bounds = points.userData.bounds;
  if (!bounds) return;
  for (let index = 0; index < attribute.count; index += 1) {
    const offset = index * 3;
    const phase = index * 1.618 + attribute.array[offset + 2] * 0.12;
    if (['embers', 'bubbleRise', 'fireflyDrift'].includes(motion)) {
      const speed = motion === 'bubbleRise' ? 0.008 : motion === 'fireflyDrift' ? 0.004 : 0.012;
      attribute.array[offset + 1] += speed * motionScale * (1 + (index % 5) * 0.1);
      attribute.array[offset] += Math.sin(phase + attribute.array[offset + 1]) * (motion === 'fireflyDrift' ? 0.006 : 0.0018) * motionScale;
      if (motion === 'fireflyDrift') attribute.array[offset + 2] += Math.cos(phase) * 0.003 * motionScale;
      if (attribute.array[offset + 1] > bounds.maxY) {
        attribute.array[offset + 1] = bounds.minY;
        attribute.array[offset + 2] = bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ);
      }
    } else {
      const speeds = { prismRain: 0.038, petalDrift: 0.014, snowFall: 0.012, sandDrift: 0.008, glitchRain: 0.07, flareFall: 0.024 };
      const speed = speeds[motion] || 0.052;
      attribute.array[offset + 1] -= speed * motionScale;
      attribute.array[offset + 2] += (motion === 'prismRain' ? 0.026 : motion === 'glitchRain' ? 0.045 : 0.018) * motionScale;
      if (motion === 'petalDrift') attribute.array[offset] += Math.sin(phase + attribute.array[offset + 1]) * 0.008 * motionScale;
      if (motion === 'snowFall') attribute.array[offset] += Math.cos(phase + attribute.array[offset + 1]) * 0.0022 * motionScale;
      if (motion === 'sandDrift') attribute.array[offset] += 0.018 * motionScale;
      if (motion === 'glitchRain' && index % 5 === 0) attribute.array[offset] += (index % 2 ? -0.018 : 0.018) * motionScale;
      if (attribute.array[offset + 1] < bounds.minY || attribute.array[offset + 2] > bounds.maxZ) {
        attribute.array[offset + 1] = bounds.maxY;
        attribute.array[offset + 2] = bounds.minZ + Math.random() * 4;
        if (motion === 'sandDrift') attribute.array[offset] = -bounds.rangeX / 2;
      }
    }
  }
  attribute.needsUpdate = true;
}

function hashString(value) {
  return [...String(value)].reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0);
}

function createFallbackTrack() {
  return { id: 'fallback-rift', title: 'Fallback Rift', bpm: 126, duration: 72, environment: 'neon', damageStyle: 'voltaic' };
}
