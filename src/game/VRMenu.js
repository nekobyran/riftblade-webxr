import * as THREE from 'three';
import { trackStyleZh, trackTitleZh } from '../data/trackLocalization.js';

export const VR_MENU_PAGE_SIZE = 5;
export const VR_MENU_MODES = Object.freeze(['standard', 'auto', 'zen']);
export const VR_MENU_SCREENS = Object.freeze({
  SELECTION: 'selection',
  PAUSE: 'pause',
  RESULTS: 'results',
});
export const VR_MENU_ACTIONS = Object.freeze({
  PAGE: 'page',
  TRACK: 'track',
  MODE: 'mode',
  START: 'start',
  PAUSE: 'pause',
  RESUME: 'resume',
  RESTART: 'restart',
  RETURN_TO_SELECTION: 'return-to-selection',
  PLAY_AGAIN: 'play-again',
});
export const VR_MENU_TEXT = Object.freeze({
  selectionTitle: '选择曲目',
  selectionHint: '移动手柄瞄准，按扳机选择',
  previousPage: '‹  上一页',
  nextPage: '下一页  ›',
  modeTitle: '游戏模式',
  start: '开始游戏',
  pauseTitle: '游戏已暂停',
  pauseHint: '选择继续、重新开始或返回选曲',
  resume: '继续游戏',
  restart: '重新开始',
  returnToSelection: '返回选曲',
  resultsTitle: '关卡完成',
  resultsHint: '干得漂亮！选择下一步操作',
  totalScore: '总分',
  hits: '命中',
  maxCombo: '最高连击',
  accuracy: '准度',
  playAgain: '再来一次',
});
export const VR_MENU_MODE_LABELS = Object.freeze({
  standard: '标准模式',
  auto: 'AI 自动',
  zen: '纯享模式',
});

const SCREEN_VALUES = new Set(Object.values(VR_MENU_SCREENS));
const OPERATION_ACTIONS = new Set([
  VR_MENU_ACTIONS.START,
  VR_MENU_ACTIONS.RESTART,
  VR_MENU_ACTIONS.PLAY_AGAIN,
]);
const MENU_CANVAS_WIDTH = 1024;
const MENU_CANVAS_HEIGHT = 1280;
const MENU_PANEL_WIDTH = 1.84;
const MENU_PANEL_HEIGHT = 2.3;
export function vrTrackTitle(track, fallbackIndex = 0) {
  return trackTitleZh(track, fallbackIndex);
}

export function vrTrackStyle(track) {
  return trackStyleZh(track);
}

export function normalizeVRMenuResults(results = {}) {
  const accuracy = THREE.MathUtils.clamp(Number(results.accuracy) || 0, 0, 1);
  return {
    score: Math.max(0, Math.round(Number(results.score) || 0)),
    hits: Math.max(0, Math.round(Number(results.hits) || 0)),
    maxCombo: Math.max(0, Math.round(Number(results.maxCombo ?? results.bestCombo) || 0)),
    accuracy,
  };
}

export function createVRMenuState({
  tracks = [],
  selectedTrackId = null,
  mode = 'standard',
  page = 0,
  screen = VR_MENU_SCREENS.SELECTION,
  results = {},
} = {}) {
  const safeTracks = Array.isArray(tracks) ? tracks : [];
  const pages = Math.max(1, Math.ceil(safeTracks.length / VR_MENU_PAGE_SIZE));
  const selected = safeTracks.some((track) => track.id === selectedTrackId) ? selectedTrackId : safeTracks[0]?.id || null;
  return {
    page: Math.max(0, Math.min(pages - 1, Number(page) || 0)),
    pages,
    selectedTrackId: selected,
    mode: VR_MENU_MODES.includes(mode) ? mode : 'standard',
    screen: SCREEN_VALUES.has(screen) ? screen : VR_MENU_SCREENS.SELECTION,
    results: normalizeVRMenuResults(results),
  };
}

export function reduceVRMenuAction(state, action, tracks = []) {
  const current = createVRMenuState({ tracks, ...state });
  if (!action?.type) return current;
  if (action.type === VR_MENU_ACTIONS.PAGE) {
    return createVRMenuState({ tracks, ...current, page: current.page + (Number(action.delta) || 0) });
  }
  if (action.type === VR_MENU_ACTIONS.TRACK && tracks.some((track) => track.id === action.trackId)) {
    return createVRMenuState({ tracks, ...current, selectedTrackId: action.trackId });
  }
  if (action.type === VR_MENU_ACTIONS.MODE && VR_MENU_MODES.includes(action.mode)) return { ...current, mode: action.mode };
  if (action.type === VR_MENU_ACTIONS.RETURN_TO_SELECTION) return { ...current, screen: VR_MENU_SCREENS.SELECTION };
  return current;
}

/**
 * Returns every visible, ray-interactable control. Bounds are canvas pixels so
 * drawing and controller hit targets always stay aligned.
 */
export function getVRMenuControls(state, tracks = []) {
  const safeTracks = Array.isArray(tracks) ? tracks : [];
  const current = createVRMenuState({ tracks: safeTracks, ...state });
  if (current.screen === VR_MENU_SCREENS.PAUSE) {
    return [
      menuControl(VR_MENU_TEXT.resume, { type: VR_MENU_ACTIONS.RESUME }, 110, 430, 804, 126),
      menuControl(VR_MENU_TEXT.restart, { type: VR_MENU_ACTIONS.RESTART }, 110, 600, 804, 126),
      menuControl(VR_MENU_TEXT.returnToSelection, { type: VR_MENU_ACTIONS.RETURN_TO_SELECTION }, 110, 770, 804, 126),
    ];
  }
  if (current.screen === VR_MENU_SCREENS.RESULTS) {
    return [
      menuControl(VR_MENU_TEXT.playAgain, { type: VR_MENU_ACTIONS.PLAY_AGAIN }, 110, 810, 804, 126),
      menuControl(VR_MENU_TEXT.returnToSelection, { type: VR_MENU_ACTIONS.RETURN_TO_SELECTION }, 110, 980, 804, 126),
    ];
  }

  const offset = current.page * VR_MENU_PAGE_SIZE;
  const visibleTracks = safeTracks.slice(offset, offset + VR_MENU_PAGE_SIZE);
  const controls = visibleTracks.map((track, index) => menuControl(
    vrTrackTitle(track, offset + index),
    { type: VR_MENU_ACTIONS.TRACK, trackId: track.id },
    58,
    154 + index * 145,
    MENU_CANVAS_WIDTH - 116,
    116,
  ));
  controls.push(
    menuControl(VR_MENU_TEXT.previousPage, { type: VR_MENU_ACTIONS.PAGE, delta: -1 }, 58, 892, 190, 70, current.page <= 0),
    menuControl(VR_MENU_TEXT.nextPage, { type: VR_MENU_ACTIONS.PAGE, delta: 1 }, MENU_CANVAS_WIDTH - 248, 892, 190, 70, current.page >= current.pages - 1),
  );
  VR_MENU_MODES.forEach((mode, index) => controls.push(menuControl(
    VR_MENU_MODE_LABELS[mode],
    { type: VR_MENU_ACTIONS.MODE, mode },
    58 + index * 304,
    1044,
    278,
    76,
  )));
  controls.push(menuControl(
    VR_MENU_TEXT.start,
    { type: VR_MENU_ACTIONS.START },
    58,
    1154,
    MENU_CANVAS_WIDTH - 116,
    96,
    !current.selectedTrackId,
  ));
  return controls;
}

/**
 * A dependency-free in-headset menu. CanvasTexture keeps Chinese labels crisp
 * while separate invisible hit planes provide stable controller ray targets.
 */
export class VRMenu {
  constructor({ tracks = [], selectedTrackId = null, mode = 'standard', onAction = null } = {}) {
    this.tracks = Array.isArray(tracks) ? tracks : [];
    this.state = createVRMenuState({ tracks: this.tracks, selectedTrackId, mode });
    this.onAction = onAction;
    this.group = new THREE.Group();
    this.group.name = 'rift-vr-menu';
    this.group.position.set(0, 1.55, -1.86);
    this.group.visible = false;
    this.hitTargets = [];
    this.hovered = null;
    this._raycaster = new THREE.Raycaster();
    this._rotationMatrix = new THREE.Matrix4();
    this._canvas = createMenuCanvas();
    this._context = this._canvas?.getContext?.('2d') || null;
    this._texture = this._canvas ? new THREE.CanvasTexture(this._canvas) : null;
    if (this._texture) {
      this._texture.colorSpace = THREE.SRGBColorSpace;
      this._texture.minFilter = THREE.LinearFilter;
    }
    this._buildPanel();
    this._rebuildTargets();
    this.redraw();
  }

  get visible() {
    return this.group.visible;
  }

  setVisible(visible) {
    this.group.visible = Boolean(visible);
    this.hovered = null;
    this.redraw();
  }

  snapshot() {
    return { ...this.state, results: { ...this.state.results } };
  }

  setTracks(tracks, selectedTrackId = this.state.selectedTrackId) {
    this.tracks = Array.isArray(tracks) ? tracks : [];
    const selectedIndex = this.tracks.findIndex((track) => track.id === selectedTrackId);
    const page = selectedIndex >= 0 ? Math.floor(selectedIndex / VR_MENU_PAGE_SIZE) : this.state.page;
    this.state = createVRMenuState({ tracks: this.tracks, ...this.state, selectedTrackId, page });
    this._rebuildTargets();
    this.redraw();
  }

  setMode(mode) {
    this.state = reduceVRMenuAction(this.state, { type: VR_MENU_ACTIONS.MODE, mode }, this.tracks);
    this.redraw();
  }

  setTrack(trackId) {
    this.state = reduceVRMenuAction(this.state, { type: VR_MENU_ACTIONS.TRACK, trackId }, this.tracks);
    const index = this.tracks.findIndex((track) => track.id === this.state.selectedTrackId);
    if (index >= 0) this.state = createVRMenuState({ tracks: this.tracks, ...this.state, page: Math.floor(index / VR_MENU_PAGE_SIZE) });
    this._rebuildTargets();
    this.redraw();
  }

  setScreen(screen, results = this.state.results) {
    this.state = createVRMenuState({ tracks: this.tracks, ...this.state, screen, results });
    this.hovered = null;
    this._rebuildTargets();
    this.redraw();
    return this.snapshot();
  }

  showSelection() {
    return this.setScreen(VR_MENU_SCREENS.SELECTION);
  }

  showPause() {
    return this.setScreen(VR_MENU_SCREENS.PAUSE);
  }

  showResults(results = {}) {
    return this.setScreen(VR_MENU_SCREENS.RESULTS, results);
  }

  setPhase(phase, results = this.state.results) {
    if (phase === 'paused') return this.showPause();
    if (phase === 'results') return this.showResults(results);
    if (phase === 'menu' || phase === 'selection') return this.showSelection();
    return this.snapshot();
  }

  updateController(controller) {
    if (!this.visible || !controller) return null;
    this.group.updateWorldMatrix?.(true, true);
    controller.updateWorldMatrix?.(true, true);
    this._rotationMatrix.identity().extractRotation(controller.matrixWorld);
    this._raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this._raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._rotationMatrix).normalize();
    this._raycaster.far = 8;
    const intersection = this._raycaster.intersectObjects(this.hitTargets, false)[0] || null;
    const hit = intersection?.object || null;
    if (hit !== this.hovered) {
      this.hovered = hit;
      this.redraw();
    }
    this._updateRay(controller, hit ? Math.min(3.5, intersection.distance) : 2.4, Boolean(hit));
    return hit?.userData?.menuAction || null;
  }

  select(controller) {
    const action = this.updateController(controller);
    if (!action) return false;
    this.activate(action);
    return true;
  }

  activate(inputAction) {
    if (!inputAction?.type) return false;
    const previous = this.snapshot();
    let action = { ...inputAction };
    this.state = reduceVRMenuAction(this.state, action, this.tracks);
    if (action.type === VR_MENU_ACTIONS.PAGE || action.type === VR_MENU_ACTIONS.RETURN_TO_SELECTION) this._rebuildTargets();
    if (OPERATION_ACTIONS.has(action.type)) {
      action = { ...action, trackId: this.state.selectedTrackId, mode: this.state.mode };
    }
    this.redraw();
    this.onAction?.(action, this.snapshot(), previous);
    return action;
  }

  redraw() {
    const ctx = this._context;
    if (!ctx) return;
    const { width, height } = this._canvas;
    ctx.clearRect(0, 0, width, height);
    drawGlass(ctx, width, height);

    if (this.state.screen === VR_MENU_SCREENS.PAUSE) this._drawPause(ctx);
    else if (this.state.screen === VR_MENU_SCREENS.RESULTS) this._drawResults(ctx);
    else this._drawSelection(ctx);
    if (this._texture) this._texture.needsUpdate = true;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
      else object.material?.dispose?.();
    });
    this._texture?.dispose?.();
    this.hitTargets.length = 0;
  }

  _visibleTracks() {
    const offset = this.state.page * VR_MENU_PAGE_SIZE;
    return this.tracks.slice(offset, offset + VR_MENU_PAGE_SIZE);
  }

  _drawSelection(ctx) {
    drawHeading(ctx, VR_MENU_TEXT.selectionTitle, `${VR_MENU_TEXT.selectionHint}  ·  第 ${this.state.page + 1} / ${this.state.pages} 页`);
    this._visibleTracks().forEach((track, index) => {
      const y = 154 + index * 145;
      const selected = track.id === this.state.selectedTrackId;
      const hovered = isHovered(this.hovered, { type: VR_MENU_ACTIONS.TRACK, trackId: track.id });
      drawTrack(ctx, 58, y, MENU_CANVAS_WIDTH - 116, 116, {
        selected,
        hovered,
        label: vrTrackTitle(track, this.state.page * VR_MENU_PAGE_SIZE + index),
        meta: `${track.bpm || '—'} 拍/分  ·  ${vrTrackStyle(track)}`,
      });
    });

    const navY = 892;
    drawCompact(ctx, 58, navY, 190, 70, VR_MENU_TEXT.previousPage, isHovered(this.hovered, { type: VR_MENU_ACTIONS.PAGE, delta: -1 }), this.state.page <= 0);
    drawCompact(ctx, MENU_CANVAS_WIDTH - 248, navY, 190, 70, VR_MENU_TEXT.nextPage, isHovered(this.hovered, { type: VR_MENU_ACTIONS.PAGE, delta: 1 }), this.state.page >= this.state.pages - 1);
    ctx.fillStyle = 'rgba(235,244,255,.72)';
    ctx.font = chineseFont(18, 650);
    ctx.fillText(VR_MENU_TEXT.modeTitle, 58, 1020);
    VR_MENU_MODES.forEach((mode, index) => {
      const x = 58 + index * 304;
      const hovered = isHovered(this.hovered, { type: VR_MENU_ACTIONS.MODE, mode });
      drawCompact(ctx, x, 1044, 278, 76, VR_MENU_MODE_LABELS[mode], hovered || this.state.mode === mode, false, this.state.mode === mode);
    });
    drawPrimary(ctx, 58, 1154, MENU_CANVAS_WIDTH - 116, 96, VR_MENU_TEXT.start, isHovered(this.hovered, { type: VR_MENU_ACTIONS.START }), Boolean(this.state.selectedTrackId));
  }

  _drawPause(ctx) {
    drawHeading(ctx, VR_MENU_TEXT.pauseTitle, VR_MENU_TEXT.pauseHint);
    const track = this.tracks.find((candidate) => candidate.id === this.state.selectedTrackId);
    drawSummaryCard(ctx, 110, 190, 804, 170, track ? vrTrackTitle(track) : '当前曲目', VR_MENU_MODE_LABELS[this.state.mode]);
    const controls = getVRMenuControls(this.state, this.tracks);
    controls.forEach((control, index) => drawAction(ctx, control, isHovered(this.hovered, control.action), index === 0));
  }

  _drawResults(ctx) {
    drawHeading(ctx, VR_MENU_TEXT.resultsTitle, VR_MENU_TEXT.resultsHint);
    const result = this.state.results;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(217,234,255,.68)';
    ctx.font = chineseFont(24, 700);
    ctx.fillText(VR_MENU_TEXT.totalScore, MENU_CANVAS_WIDTH / 2, 218);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#6cecff';
    ctx.shadowBlur = 34;
    ctx.font = chineseFont(82, 900);
    ctx.fillText(result.score.toLocaleString('zh-CN'), MENU_CANVAS_WIDTH / 2, 310);
    ctx.shadowBlur = 0;
    const metrics = [
      [VR_MENU_TEXT.hits, result.hits.toLocaleString('zh-CN')],
      [VR_MENU_TEXT.maxCombo, result.maxCombo.toLocaleString('zh-CN')],
      [VR_MENU_TEXT.accuracy, `${(result.accuracy * 100).toFixed(1)}%`],
    ];
    metrics.forEach(([label, value], index) => drawResultMetric(ctx, 74 + index * 298, 390, 278, 210, label, value));
    const track = this.tracks.find((candidate) => candidate.id === this.state.selectedTrackId);
    ctx.fillStyle = 'rgba(224,238,255,.68)';
    ctx.font = chineseFont(22, 650);
    ctx.fillText(`${track ? vrTrackTitle(track) : '当前曲目'}  ·  ${VR_MENU_MODE_LABELS[this.state.mode]}`, MENU_CANVAS_WIDTH / 2, 690, 850);
    getVRMenuControls(this.state, this.tracks).forEach((control, index) => drawAction(ctx, control, isHovered(this.hovered, control.action), index === 0));
    ctx.textAlign = 'left';
  }

  _buildPanel() {
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(1.98, 2.48),
      new THREE.MeshBasicMaterial({ color: 0x4ee9ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    halo.name = 'rift-vr-menu-halo';
    halo.position.z = -0.018;
    const backing = new THREE.Mesh(
      new THREE.PlaneGeometry(1.88, 2.38),
      new THREE.MeshPhysicalMaterial({
        color: 0x17213e,
        emissive: 0x091126,
        emissiveIntensity: 0.62,
        metalness: 0.08,
        roughness: 0.18,
        transparent: true,
        opacity: 0.82,
        transmission: 0.14,
        thickness: 0.16,
        clearcoat: 0.8,
        clearcoatRoughness: 0.2,
        side: THREE.DoubleSide,
      }),
    );
    backing.position.z = -0.008;
    const display = new THREE.Mesh(
      new THREE.PlaneGeometry(MENU_PANEL_WIDTH, MENU_PANEL_HEIGHT),
      new THREE.MeshBasicMaterial({ map: this._texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    display.name = 'rift-vr-menu-display';
    display.renderOrder = 8;
    this.group.add(halo, backing, display);
  }

  _rebuildTargets() {
    for (const target of this.hitTargets) {
      this.group.remove(target);
      target.geometry?.dispose?.();
      target.material?.dispose?.();
    }
    this.hitTargets.length = 0;
    for (const control of getVRMenuControls(this.state, this.tracks)) {
      if (control.disabled) continue;
      const bounds = canvasBoundsToLocal(control.bounds);
      const target = new THREE.Mesh(
        new THREE.PlaneGeometry(bounds.width, bounds.height),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, side: THREE.DoubleSide }),
      );
      target.position.set(bounds.x, bounds.y, 0.02);
      target.userData.menuAction = control.action;
      target.userData.label = control.label;
      this.group.add(target);
      this.hitTargets.push(target);
    }
  }

  _updateRay(controller, distance, active) {
    let line = controller.getObjectByName?.('rift-menu-ray');
    if (!line) {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
      line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x7de8ff, transparent: true, opacity: 0.72, toneMapped: false }));
      line.name = 'rift-menu-ray';
      controller.add(line);
    }
    let reticle = controller.getObjectByName?.('rift-menu-reticle');
    if (!reticle) {
      reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.008, 0.018, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.94, depthTest: false, depthWrite: false, toneMapped: false }),
      );
      reticle.name = 'rift-menu-reticle';
      reticle.renderOrder = 30;
      controller.add(reticle);
    }
    line.visible = this.visible;
    line.scale.z = Math.max(0.15, distance);
    line.material.color.setHex(active ? 0xffffff : 0x7de8ff);
    line.material.opacity = active ? 1 : 0.5;
    reticle.visible = this.visible && active;
    reticle.position.set(0, 0, -Math.max(0.15, distance));
  }
}

function menuControl(label, action, x, y, width, height, disabled = false) {
  return { label, action, bounds: { x, y, width, height }, disabled: Boolean(disabled) };
}

function canvasBoundsToLocal({ x, y, width, height }) {
  return {
    x: ((x + width / 2) / MENU_CANVAS_WIDTH - 0.5) * MENU_PANEL_WIDTH,
    y: (0.5 - (y + height / 2) / MENU_CANVAS_HEIGHT) * MENU_PANEL_HEIGHT,
    width: width / MENU_CANVAS_WIDTH * MENU_PANEL_WIDTH,
    height: height / MENU_CANVAS_HEIGHT * MENU_PANEL_HEIGHT,
  };
}

function isHovered(target, action) {
  const hovered = target?.userData?.menuAction;
  if (!hovered || hovered.type !== action.type) return false;
  if (action.trackId != null) return hovered.trackId === action.trackId;
  if (action.mode != null) return hovered.mode === action.mode;
  if (action.delta != null) return hovered.delta === action.delta;
  return true;
}

function createMenuCanvas() {
  if (!globalThis.document?.createElement && !globalThis.OffscreenCanvas) return null;
  const canvas = globalThis.document?.createElement ? document.createElement('canvas') : new globalThis.OffscreenCanvas(MENU_CANVAS_WIDTH, MENU_CANVAS_HEIGHT);
  canvas.width = MENU_CANVAS_WIDTH;
  canvas.height = MENU_CANVAS_HEIGHT;
  return canvas;
}

function chineseFont(size, weight = 600) {
  return `${weight} ${size}px system-ui, "Microsoft YaHei", "PingFang SC", sans-serif`;
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect?.(x, y, width, height, radius);
  if (!ctx.roundRect) ctx.rect(x, y, width, height);
}

function drawGlass(ctx, width, height) {
  const glass = ctx.createLinearGradient(0, 0, width, height);
  glass.addColorStop(0, 'rgba(15, 25, 54, .95)');
  glass.addColorStop(0.55, 'rgba(8, 13, 32, .9)');
  glass.addColorStop(1, 'rgba(42, 9, 55, .94)');
  roundedRect(ctx, 12, 12, width - 24, height - 24, 54);
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.strokeStyle = 'rgba(151, 222, 255, .7)';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#3ce8ff';
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawHeading(ctx, title, hint) {
  ctx.textAlign = 'left';
  ctx.fillStyle = '#a8f4ff';
  ctx.font = chineseFont(34, 800);
  ctx.fillText(title, 68, 82);
  ctx.fillStyle = 'rgba(235,244,255,.74)';
  ctx.font = chineseFont(18, 500);
  ctx.fillText(hint, 68, 118, 888);
}

function drawTrack(ctx, x, y, width, height, { selected, hovered, label, meta }) {
  roundedRect(ctx, x, y, width, height, 28);
  ctx.fillStyle = selected ? 'rgba(52, 225, 255, .24)' : hovered ? 'rgba(255,255,255,.17)' : 'rgba(255,255,255,.07)';
  ctx.fill();
  ctx.strokeStyle = selected ? '#70efff' : hovered ? 'rgba(255,255,255,.65)' : 'rgba(255,255,255,.13)';
  ctx.lineWidth = selected ? 3 : 2;
  ctx.stroke();
  ctx.fillStyle = selected ? '#ffffff' : '#eef3ff';
  ctx.font = chineseFont(30, 700);
  ctx.fillText(label, x + 34, y + 47, width - 68);
  ctx.fillStyle = selected ? '#a8f4ff' : 'rgba(226,236,255,.62)';
  ctx.font = chineseFont(18, 500);
  ctx.fillText(meta, x + 34, y + 82, width - 68);
}

function drawCompact(ctx, x, y, width, height, label, hovered, disabled, selected = false) {
  roundedRect(ctx, x, y, width, height, 23);
  ctx.fillStyle = disabled ? 'rgba(255,255,255,.025)' : selected ? 'rgba(255,70,203,.28)' : hovered ? 'rgba(112,239,255,.22)' : 'rgba(255,255,255,.075)';
  ctx.fill();
  ctx.strokeStyle = disabled ? 'rgba(255,255,255,.06)' : selected ? '#ff77db' : hovered ? '#70efff' : 'rgba(255,255,255,.15)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = disabled ? 'rgba(255,255,255,.2)' : '#f5f7ff';
  ctx.font = chineseFont(20, 700);
  ctx.textAlign = 'center';
  ctx.fillText(label, x + width / 2, y + height / 2 + 7);
  ctx.textAlign = 'left';
}

function drawPrimary(ctx, x, y, width, height, label, hovered, enabled) {
  const gradient = ctx.createLinearGradient(x, y, x + width, y);
  gradient.addColorStop(0, enabled ? '#16d9ff' : 'rgba(255,255,255,.15)');
  gradient.addColorStop(1, enabled ? '#ff45cc' : 'rgba(255,255,255,.08)');
  roundedRect(ctx, x, y, width, height, 30);
  ctx.fillStyle = gradient;
  ctx.globalAlpha = hovered ? 1 : 0.84;
  ctx.shadowColor = hovered ? '#77efff' : 'transparent';
  ctx.shadowBlur = hovered ? 28 : 0;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.fillStyle = enabled ? '#06101d' : 'rgba(255,255,255,.35)';
  ctx.font = chineseFont(30, 900);
  ctx.textAlign = 'center';
  ctx.fillText(label, x + width / 2, y + height / 2 + 11);
  ctx.textAlign = 'left';
}

function drawSummaryCard(ctx, x, y, width, height, title, mode) {
  roundedRect(ctx, x, y, width, height, 34);
  ctx.fillStyle = 'rgba(91, 222, 255, .1)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(118, 236, 255, .36)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = chineseFont(36, 800);
  ctx.fillText(title, x + width / 2, y + 72, width - 80);
  ctx.fillStyle = '#a8f4ff';
  ctx.font = chineseFont(22, 650);
  ctx.fillText(mode, x + width / 2, y + 120);
  ctx.textAlign = 'left';
}

function drawAction(ctx, control, hovered, primary) {
  const { x, y, width, height } = control.bounds;
  const gradient = ctx.createLinearGradient(x, y, x + width, y);
  gradient.addColorStop(0, primary ? 'rgba(25,218,255,.9)' : 'rgba(255,255,255,.1)');
  gradient.addColorStop(1, primary ? 'rgba(255,69,204,.86)' : 'rgba(112,239,255,.12)');
  roundedRect(ctx, x, y, width, height, 34);
  ctx.fillStyle = gradient;
  ctx.globalAlpha = hovered ? 1 : 0.86;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = hovered ? '#ffffff' : primary ? 'rgba(136,242,255,.68)' : 'rgba(255,255,255,.2)';
  ctx.lineWidth = hovered ? 4 : 2;
  ctx.shadowColor = hovered ? '#70efff' : 'transparent';
  ctx.shadowBlur = hovered ? 30 : 0;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = primary ? '#06101d' : '#f4f8ff';
  ctx.font = chineseFont(34, 850);
  ctx.textAlign = 'center';
  ctx.fillText(control.label, x + width / 2, y + height / 2 + 12);
  ctx.textAlign = 'left';
}

function drawResultMetric(ctx, x, y, width, height, label, value) {
  roundedRect(ctx, x, y, width, height, 28);
  ctx.fillStyle = 'rgba(255,255,255,.065)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,232,255,.2)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(222,236,255,.66)';
  ctx.font = chineseFont(21, 650);
  ctx.fillText(label, x + width / 2, y + 72);
  ctx.fillStyle = '#ffffff';
  ctx.font = chineseFont(42, 850);
  ctx.fillText(value, x + width / 2, y + 138, width - 30);
}
