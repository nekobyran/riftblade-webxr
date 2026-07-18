import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { createBeatmap, getTrack } from '../data/tracks.js';
import { CutDirection, GamePhase, GameplayEvent, Hand } from '../shared/contracts.js';
import {
  BeatmapRuntime,
  DEFAULT_RULES,
  NOTE_PLANE_Z,
  ScoreKeeper,
  createDesktopSweep,
  directionVector,
  judgeCut,
  laneToX,
  noteWorldPosition,
  rowToY,
} from './RhythmLogic.js';

const THEME_PRESETS = Object.freeze({
  neon: {
    key: 'neon',
    fog: 0x090018,
    floor: 0x16092f,
    grid: 0x44e7ff,
    sky: [0x070014, 0x11104a, 0x3f1d79],
    bloom: 0xff3df5,
  },
  magma: {
    key: 'magma',
    fog: 0x180500,
    floor: 0x291007,
    grid: 0xff8a20,
    sky: [0x110303, 0x5f1705, 0xff5a1f],
    bloom: 0xffc04d,
  },
  orbit: {
    key: 'orbit',
    fog: 0x031823,
    floor: 0x061a2a,
    grid: 0x8be9ff,
    sky: [0x02141f, 0x0c4366, 0xa1f7ff],
    bloom: 0x8be9ff,
  },
});

const DAMAGE_STYLES = Object.freeze({
  ember: { left: 0xff6033, right: 0xffd166, hurt: 0xff2a00 },
  voltaic: { left: 0x54f7ff, right: 0xc45cff, hurt: 0xf4ff5a },
  prism: { left: 0x7fffe5, right: 0xf0abfc, hurt: 0xffffff },
});

const TRACK_THEME = Object.freeze({
  'neon-tide-run': 'neon',
  'ember-circuit-choir': 'magma',
  'glass-orbit-monsoon': 'orbit',
});

const TRACK_DAMAGE = Object.freeze({
  'neon-tide-run': 'voltaic',
  'ember-circuit-choir': 'ember',
  'glass-orbit-monsoon': 'prism',
});

const HAND_COLORS = Object.freeze({
  [Hand.LEFT]: 0x43d9ff,
  [Hand.RIGHT]: 0xff4fd8,
});

export class RhythmGame {
  constructor({ canvas, eventTarget = new EventTarget(), music = null } = {}) {
    if (!canvas) throw new Error('RhythmGame requires a canvas');
    this.canvas = canvas;
    this.eventTarget = eventTarget;
    this.music = music;
    this.rules = DEFAULT_RULES;
    this.score = new ScoreKeeper(this.rules);
    this.track = null;
    this.beatmap = [];
    this.runtime = new BeatmapRuntime([], this.rules);
    this.phase = GamePhase.MENU;
    this.clock = new THREE.Clock(false);
    this.fallbackStart = 0;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.player = null;
    this.noteGroup = new THREE.Group();
    this.environmentGroup = new THREE.Group();
    this.sabers = new Map();
    this.controllers = [];
    this.grips = [];
    this.controllerState = new Map();
    this.sweepQueue = [];
    this.noteMeshes = new Map();
    this.damageEffects = [];
    this.vrButton = null;
    this.desktopPointer = { x: 0, y: 0, active: false };
    this.reducedMotion = false;
    this.disposed = false;
    this._boundFrame = (time, frame) => this._frame(time, frame);
    this._boundKeyDown = (event) => this._onKeyDown(event);
    this._boundPointerMove = (event) => this._onPointerMove(event);
    this._boundPointerDown = (event) => this._onPointerDown(event);
    this._boundContextMenu = (event) => event.preventDefault();
    this._boundSessionStart = () => this._emit(GameplayEvent.XR_CHANGE, { active: true, presenting: true, supported: true });
    this._boundSessionEnd = () => this._emit(GameplayEvent.XR_CHANGE, { active: false, presenting: false, supported: true });
  }

  async initialize() {
    if (this.renderer) return;
    this.reducedMotion = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x090018, 0.035);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
    this.camera.position.set(0, 1.65, 3.2);
    this.player = new THREE.Group();
    this.player.add(this.camera);
    this.scene.add(this.player);
    this.scene.add(this.environmentGroup);
    this.scene.add(this.noteGroup);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(0x050008, 1);

    this._buildLights();
    this._buildEnvironment('neon');
    this._setupControllers();
    this._setupDesktopControls();
    this._createEnterVrButton();
    this.resize();
    this.renderer.setAnimationLoop(this._boundFrame);
    this._setPhase(GamePhase.MENU);
  }

  loadTrack(track) {
    this.track = track || null;
    this.beatmap = createBeatmapFromTrack(track);
    this.runtime.reset(this.beatmap);
    this.score = new ScoreKeeper(this.rules);
    this._clearNotes();
    const themeKey = resolveTheme(track);
    this._buildEnvironment(themeKey);
    this._applySaberStyle(resolveDamageStyle(track));
    this._emitTick(0);
  }

  async start() {
    if (!this.renderer) await this.initialize();
    if (!this.track) this.loadTrack(createFallbackTrack());
    this._clearNotes();
    this.runtime.reset(this.beatmap);
    this.score = new ScoreKeeper(this.rules);
    this.fallbackStart = performance.now() / 1000;
    this.clock.start();
    await this.music?.start?.(this.track, 0);
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
    this.renderer?.xr?.removeEventListener?.('sessionstart', this._boundSessionStart);
    this.renderer?.xr?.removeEventListener?.('sessionend', this._boundSessionEnd);
    this.vrButton?.remove?.();
    this._clearNotes();
    this._clearDamageEffects();
    this.scene?.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose?.());
      else object.material?.dispose?.();
    });
    this.renderer?.dispose?.();
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xddeeff, 0x120014, 1.3);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 5, 3);
    const rim = new THREE.PointLight(0xff3df5, 10, 9);
    rim.position.set(-2.5, 2.8, -2);
    this.scene.add(hemi, key, rim);
  }

  _buildEnvironment(themeKey) {
    const theme = THEME_PRESETS[themeKey] || THEME_PRESETS.neon;
    clearGroup(this.environmentGroup);
    this.scene.fog = new THREE.FogExp2(theme.fog, 0.037);
    this.renderer?.setClearColor(theme.fog, 1);

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
    floor.userData.motion = theme.key === 'neon' ? 'floorPulse' : null;
    this.environmentGroup.add(floor);

    const grid = new THREE.GridHelper(18, 36, theme.grid, theme.grid);
    grid.position.set(0, 0.018, -14);
    grid.material.transparent = true;
    grid.material.opacity = theme.key === 'magma' ? 0.22 : 0.4;
    this.environmentGroup.add(grid);

    if (theme.key === 'magma') this._buildForgeCathedral(theme);
    else if (theme.key === 'orbit') this._buildOrbitGarden(theme);
    else this._buildNeonCauseway(theme);

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
    this.environmentGroup.add(createParticleField({ count: 180, color: theme.grid, rangeX: 11, minY: 0.2, maxY: 6, minZ: -34, maxZ: 2, size: 0.025, motion: 'neonRain' }));
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
    this.environmentGroup.add(createParticleField({ count: 150, color: theme.bloom, rangeX: 9, minY: 0.1, maxY: 5, minZ: -32, maxZ: 1, size: 0.045, motion: 'embers' }));
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
    this.environmentGroup.add(createParticleField({ count: 210, color: theme.grid, rangeX: 12, minY: 0.25, maxY: 7, minZ: -36, maxZ: 1, size: 0.032, motion: 'prismRain' }));
  }

  _setupControllers() {
    const controllerModelFactory = new XRControllerModelFactory();
    for (let i = 0; i < 2; i += 1) {
      const controller = this.renderer.xr.getController(i);
      const hand = i === 0 ? Hand.LEFT : Hand.RIGHT;
      controller.userData.hand = hand;
      controller.userData.saber = this._createSaber(hand);
      controller.add(controller.userData.saber);
      controller.addEventListener('connected', (event) => {
        const reportedHand = event.data?.handedness || controller.userData.hand;
        controller.userData.hand = reportedHand;
        controller.userData.inputSource = event.data;
        const state = this.controllerState.get(controller);
        if (state) state.hand = reportedHand;
        this.sabers.set(reportedHand, controller.userData.saber);
        this._applySaberStyle(this.damageStyle || 'voltaic');
      });
      controller.addEventListener('disconnected', () => {
        controller.userData.inputSource = null;
        const state = this.controllerState.get(controller);
        if (state) state.initialized = false;
      });
      controller.addEventListener('selectstart', () => this._queueControllerSwing(controller, hand));
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

  _createSaber(hand) {
    const group = new THREE.Group();
    const color = HAND_COLORS[hand];
    const blade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.045, 1.25, 18),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.4, transparent: true, opacity: 0.9 }),
    );
    blade.name = `${hand}-blade`;
    blade.position.y = 0.62;
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.016, 1.3, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
    );
    core.position.y = 0.64;
    const hilt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.07, 0.22, 16),
      new THREE.MeshStandardMaterial({ color: 0x11131d, metalness: 0.7, roughness: 0.28 }),
    );
    hilt.position.y = -0.05;
    group.rotation.x = -Math.PI / 2;
    group.add(blade, core, hilt);
    this.sabers.set(hand, group);
    return group;
  }

  _applySaberStyle(styleKey) {
    const style = DAMAGE_STYLES[styleKey] || DAMAGE_STYLES.voltaic;
    for (const hand of [Hand.LEFT, Hand.RIGHT]) {
      const saber = this.sabers.get(hand);
      const blade = saber?.getObjectByName(`${hand}-blade`);
      if (blade?.material) {
        const color = style[hand];
        blade.material.color.setHex(color);
        blade.material.emissive.setHex(color);
        blade.material.emissiveIntensity = styleKey === 'ember' ? 3.15 : styleKey === 'prism' ? 2.65 : 2.9;
        blade.material.opacity = styleKey === 'prism' ? 0.72 : 0.91;
        blade.material.roughness = styleKey === 'ember' ? 0.48 : 0.18;
      }
    }
    this.damageStyle = styleKey;
  }

  _createEnterVrButton() {
    if (!globalThis.navigator?.xr || !globalThis.document?.createElement) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'webxr-entry';
    button.textContent = 'ENTER VR';
    button.setAttribute('aria-label', 'Enter immersive VR');
    Object.assign(button.style, {
      position: 'fixed', left: '50%', top: '24px', transform: 'translateX(-50%)', zIndex: '20', padding: '12px 16px', borderRadius: '999px',
      border: '1px solid rgba(255,255,255,.35)', color: '#fff', background: 'rgba(10,8,24,.72)', backdropFilter: 'blur(12px)',
      font: '700 12px system-ui, sans-serif', letterSpacing: '.18em', cursor: 'pointer',
    });
    button.addEventListener('click', async () => {
      if (this.renderer.xr.isPresenting) {
        await this.renderer.xr.getSession()?.end?.();
        return;
      }
      const supported = await navigator.xr.isSessionSupported?.('immersive-vr').catch(() => false);
      if (!supported) {
        button.textContent = 'VR NOT FOUND';
        return;
      }
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
      await this.renderer.xr.setSession(session);
    });
    this.renderer.xr.addEventListener('sessionstart', this._boundSessionStart);
    this.renderer.xr.addEventListener('sessionend', this._boundSessionEnd);
    document.body.append(button);
    this.vrButton = button;
  }

  _setupDesktopControls() {
    globalThis.addEventListener?.('keydown', this._boundKeyDown);
    this.canvas.addEventListener?.('pointermove', this._boundPointerMove);
    this.canvas.addEventListener?.('pointerdown', this._boundPointerDown);
    this.canvas.addEventListener?.('contextmenu', this._boundContextMenu);
  }

  _onPointerMove(event) {
    const rect = this.canvas.getBoundingClientRect?.() || { left: 0, top: 0, width: 1, height: 1 };
    this.desktopPointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    this.desktopPointer.y = 1 - ((event.clientY - rect.top) / Math.max(1, rect.height)) * 2;
    this.desktopPointer.active = true;
  }

  _onPointerDown(event) {
    const hand = event.button === 2 || this.desktopPointer.x > 0 ? Hand.RIGHT : Hand.LEFT;
    this._desktopSwing(hand, this.desktopPointer.x > 0 ? 0.5 : -0.5, this.desktopPointer.y > 0.2 ? 1 : 0, CutDirection.DOWN);
  }

  _onKeyDown(event) {
    if (event.repeat) return;
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
      KeyQ: [Hand.LEFT, this.desktopPointer.x < 0 ? -1.5 : -0.5, this.desktopPointer.y > 0 ? 2 : 0, CutDirection.DOWN],
      KeyE: [Hand.RIGHT, this.desktopPointer.x > 0 ? 1.5 : 0.5, this.desktopPointer.y > 0 ? 2 : 0, CutDirection.DOWN],
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
    const state = this.controllerState.get(controller);
    if (!state) return;
    const hand = controller.userData.inputSource?.handedness || controller.userData.hand || fallbackHand;
    this.sweepQueue.push({ hand, start: state.previous.clone(), end: state.current.clone(), time: this._gameTime(), source: 'xr-select' });
  }

  _frame() {
    if (this.disposed) return;
    const elapsed = this._gameTime();
    this._updateDesktopSabers();
    if (this.phase === GamePhase.PLAYING) {
      this._updateControllers(elapsed);
      this._updateBeatmap(elapsed);
      this._processSweeps(elapsed);
      this._animateWorld(elapsed);
      this._emitTick(elapsed);
    }
    this._animateDamageEffects();
    this.renderer?.render(this.scene, this.camera);
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
      if (saber) state.current.copy(saber.localToWorld(new THREE.Vector3(0, 1.2, 0)));
      else controller.getWorldPosition(state.current);
      state.hand = hand;
      if (state.initialized && state.current.distanceToSquared(state.previous) > 0.012) {
        this.sweepQueue.push({ hand, start: state.previous.clone(), end: state.current.clone(), time: elapsed, source: 'xr-motion' });
      }
      state.initialized = true;
    }
  }

  _updateDesktopSabers() {
    if (this.renderer?.xr?.isPresenting) return;
    for (const [index, controller] of this.controllers.entries()) {
      const hand = controller.userData.hand || (index === 0 ? Hand.LEFT : Hand.RIGHT);
      const pointerHand = hand === Hand.RIGHT;
      const x = pointerHand && this.desktopPointer.active ? 0.62 + this.desktopPointer.x * 0.72 : -0.62;
      const y = pointerHand && this.desktopPointer.active ? 1.05 + this.desktopPointer.y * 0.42 : 1.02;
      controller.position.set(x, y, 2.15);
      controller.rotation.set(-0.16 + (pointerHand ? this.desktopPointer.y * 0.12 : 0.08), 0, pointerHand ? -0.12 : 0.12);
    }
  }

  _updateBeatmap(elapsed) {
    const update = this.runtime.update(elapsed);
    for (const note of update.spawned) this._spawnNoteMesh(note);
    for (const note of update.missed) this._missNote(note, 'miss');
    for (const note of update.active) this._updateNoteMesh(note, elapsed);
    if (update.complete && elapsed > 0.5) this._finish(false);
  }

  _processSweeps(elapsed) {
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
          this._flashSaber(sweep.hand, true);
          if (state.health <= 0) this._finish(true);
        }
      }
      if (best) this._hitNote(best.note, best.judgement);
    }
  }

  _spawnNoteMesh(note) {
    const color = note.hand === Hand.LEFT ? HAND_COLORS[Hand.LEFT] : HAND_COLORS[Hand.RIGHT];
    const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: note.accent ? 1.8 : 1.15, roughness: 0.32, metalness: 0.08 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.48, 0.28), material);
    mesh.name = `note-${note.id}`;
    mesh.userData.noteId = note.id;
    const arrow = this._createDirectionArrow(note.direction || CutDirection.ANY, note.accent);
    mesh.add(arrow);
    this.noteGroup.add(mesh);
    this.noteMeshes.set(note.id, mesh);
    this._updateNoteMesh(note, this._gameTime());
  }

  _createDirectionArrow(direction, accent) {
    const dir = directionVector(direction) || { x: 0, y: 1 };
    const group = new THREE.Group();
    const color = accent ? 0xffffff : 0x080510;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.32, 0.03), new THREE.MeshBasicMaterial({ color }));
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.2, 3), new THREE.MeshBasicMaterial({ color }));
    shaft.position.y = -0.05;
    head.position.y = 0.16;
    group.add(shaft, head);
    group.position.z = 0.16;
    group.rotation.z = Math.atan2(-dir.x, dir.y);
    return group;
  }

  _updateNoteMesh(note, elapsed) {
    const mesh = this.noteMeshes.get(note.id);
    if (!mesh) return;
    const pos = noteWorldPosition(note, elapsed, this.rules);
    mesh.position.set(pos.x, pos.y, pos.z);
    if (!this.reducedMotion) {
      mesh.rotation.z += 0.012 * (note.hand === Hand.LEFT ? 1 : -1);
      mesh.scale.setScalar(1 + Math.sin(elapsed * 9 + note.time) * 0.025);
    }
  }

  _hitNote(note, judgement) {
    this.runtime.resolve(note.id);
    this._removeNoteMesh(note.id);
    const result = this.score.hit(note, judgement);
    this._flashSaber(note.hand, false);
    this._emit(GameplayEvent.NOTE_HIT, { note: publicNote(note), judgement, noteScore: result.noteScore, state: result.state });
  }

  _missNote(note, reason) {
    this._removeNoteMesh(note.id);
    const state = this.score.miss(reason);
    this._emit(GameplayEvent.NOTE_MISS, { note: publicNote(note), reason, state });
    this._emit(GameplayEvent.DAMAGE, { reason, state });
    this._flashSaber(note.hand, true);
    if (state.health <= 0) this._finish(true);
  }

  _finish(failed) {
    if (this.phase === GamePhase.RESULTS) return;
    this.music?.stop?.();
    this.clock.stop();
    this._setPhase(GamePhase.RESULTS);
    const results = this.score.results(this.beatmap.length);
    this._emit(GameplayEvent.RESULTS, { ...results, failed });
  }

  _flashSaber(hand, hurt) {
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
      setTimeout(() => saber.scale.setScalar(1), 90);
    }
    this._pulseHaptics(hand, hurt ? 0.72 : 0.28, hurt ? 90 : 34);
    if (hurt) this._spawnDamageEffect(hand);
  }

  _animateWorld(elapsed) {
    const motionScale = this.reducedMotion ? 0.12 : 1;
    this.environmentGroup.children.forEach((object, index) => {
      const motion = object.userData?.motion;
      const phase = object.userData?.phase || index * 0.31;
      if (motion === 'warpGate') object.rotation.z = Math.sin(elapsed * 0.7 + phase) * 0.12 * motionScale;
      if (motion === 'equalizer') object.scale.y = 0.72 + (0.28 + Math.sin(elapsed * 5.5 + phase) * 0.18) * motionScale;
      if (motion === 'floorPulse' && object.material) object.material.emissiveIntensity = 0.12 + (0.1 + Math.sin(elapsed * 2.1) * 0.05) * motionScale;
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

  _spawnDamageEffect(hand) {
    if (!this.scene || this.reducedMotion) return;
    const styleKey = this.damageStyle || 'voltaic';
    const style = DAMAGE_STYLES[styleKey] || DAMAGE_STYLES.voltaic;
    const count = styleKey === 'ember' ? 26 : styleKey === 'prism' ? 22 : 18;
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
      const spread = styleKey === 'voltaic' ? 2.2 : styleKey === 'prism' ? 1.45 : 1.05;
      velocities.push(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() * 0.9 + 0.25) * spread, (Math.random() - 0.5) * spread));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: styleKey === 'ember' ? 0.07 : styleKey === 'prism' ? 0.09 : 0.055, vertexColors: true, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    points.userData = { born: performance.now() / 1000, last: performance.now() / 1000, velocities, styleKey };
    this.scene.add(points);
    this.damageEffects.push(points);
  }

  _animateDamageEffects() {
    const now = performance.now() / 1000;
    for (const effect of [...this.damageEffects]) {
      const age = now - effect.userData.born;
      const delta = Math.min(0.034, now - effect.userData.last);
      effect.userData.last = now;
      const positions = effect.geometry.attributes.position;
      for (let index = 0; index < effect.userData.velocities.length; index += 1) {
        const velocity = effect.userData.velocities[index];
        if (effect.userData.styleKey === 'ember') velocity.y -= 1.7 * delta;
        positions.array[index * 3] += velocity.x * delta;
        positions.array[index * 3 + 1] += velocity.y * delta;
        positions.array[index * 3 + 2] += velocity.z * delta;
      }
      positions.needsUpdate = true;
      effect.material.opacity = Math.max(0, 1 - age / 0.72);
      if (age >= 0.72) this._removeDamageEffect(effect);
    }
  }

  _removeDamageEffect(effect) {
    this.scene?.remove(effect);
    effect.geometry?.dispose?.();
    effect.material?.dispose?.();
    this.damageEffects = this.damageEffects.filter((candidate) => candidate !== effect);
  }

  _clearDamageEffects() {
    for (const effect of [...this.damageEffects]) this._removeDamageEffect(effect);
  }

  _setPhase(phase) {
    this.phase = phase;
    const state = this.score.setPhase(phase, this._gameTime());
    this._emit(GameplayEvent.PHASE, { phase, state });
  }

  _emitTick(time) {
    this._emit(GameplayEvent.TICK, { time, activeNotes: this.runtime.active.map(publicNote), state: this.score.snapshot(), trackId: this.track?.id || null });
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
      if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose?.());
      else object.material?.dispose?.();
    });
    this.noteMeshes.delete(noteId);
  }

  _clearNotes() {
    for (const id of [...this.noteMeshes.keys()]) this._removeNoteMesh(id);
    clearGroup(this.noteGroup);
  }
}

export function createBeatmapFromTrack(track) {
  if (Array.isArray(track?.beatmap)) return track.beatmap;
  if (Array.isArray(track?.notes)) return track.notes;
  if (track?.id && getTrack(track.id)) return createBeatmap(track);
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
      row: index % 3,
      hand,
      direction: directions[index % directions.length],
      accent: index % 8 === 0,
    });
    index += 1;
  }
  return notes;
}

function clearGroup(group) {
  while (group.children.length) {
    const object = group.children.pop();
    object.traverse?.((child) => {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
      else child.material?.dispose?.();
    });
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
  if (typeof track?.environment === 'string' && THEME_PRESETS[track.environment]) return track.environment;
  const biome = String(track?.environment?.biome || track?.environment?.name || '').toLowerCase();
  if (/forge|furnace|magma|熔|炉/.test(biome)) return 'magma';
  if (/orbit|glass|rain|crystal|轨|晶/.test(biome)) return 'orbit';
  if (/neon|causeway|tide|霓虹|星港/.test(biome)) return 'neon';
  return pickTheme(track?.id);
}

function resolveDamageStyle(track) {
  if (TRACK_DAMAGE[track?.id]) return TRACK_DAMAGE[track.id];
  if (typeof track?.damageStyle === 'string' && DAMAGE_STYLES[track.damageStyle]) return track.damageStyle;
  const name = String(track?.damageStyle?.name || '').toLowerCase();
  if (/molten|ember|heat|熔|烬/.test(name)) return 'ember';
  if (/crystal|prism|glass|晶|棱/.test(name)) return 'prism';
  if (/static|electric|surf|电|浪/.test(name)) return 'voltaic';
  return pickDamageStyle(track?.id);
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
    if (motion === 'embers') {
      attribute.array[offset + 1] += 0.012 * motionScale * (1 + (index % 5) * 0.1);
      attribute.array[offset] += Math.sin(index * 1.7 + attribute.array[offset + 1]) * 0.0018 * motionScale;
      if (attribute.array[offset + 1] > bounds.maxY) {
        attribute.array[offset + 1] = bounds.minY;
        attribute.array[offset + 2] = bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ);
      }
    } else {
      const speed = motion === 'prismRain' ? 0.038 : 0.052;
      attribute.array[offset + 1] -= speed * motionScale;
      attribute.array[offset + 2] += (motion === 'prismRain' ? 0.026 : 0.018) * motionScale;
      if (attribute.array[offset + 1] < bounds.minY || attribute.array[offset + 2] > bounds.maxZ) {
        attribute.array[offset + 1] = bounds.maxY;
        attribute.array[offset + 2] = bounds.minZ + Math.random() * 4;
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
