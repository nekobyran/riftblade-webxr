import * as THREE from 'three';

export const VR_HUD_REFRESH_MS = 100;
export const VR_HUD_ACTIONS = Object.freeze({
  PAUSE: 'pause',
  RESUME: 'resume',
  RESTART: 'restart',
  RETURN_TO_SELECTION: 'return-to-selection',
  PLAY_AGAIN: 'play-again',
});
export const VR_HUD_TEXT = Object.freeze({
  score: '得分',
  combo: '连击',
  accuracy: '准度',
  hitMiss: '命中 / 失误',
  pause: '暂停',
  resume: '继续',
  restart: '重新开始',
  returnToSelection: '返回选曲',
  playAgain: '再来一次',
  comboReset: '连击中断',
  perfect: '完美',
  great: '优秀',
  good: '不错',
  aiPerfect: 'AI 完美',
});
export const VR_HUD_MODE_LABELS = Object.freeze({ standard: '标准模式', auto: 'AI 自动', zen: '纯享模式' });
export const VR_HUD_PHASE_LABELS = Object.freeze({ playing: '游戏中', paused: '已暂停', results: '关卡完成' });

const HUD_PHASES = new Set(Object.keys(VR_HUD_PHASE_LABELS));
const HUD_CANVAS_WIDTH = 1536;
const HUD_CANVAS_HEIGHT = 288;
const HUD_PANEL_WIDTH = 2.58;
const HUD_PANEL_HEIGHT = 0.46;
const MISS_LABELS = Object.freeze({
  MISS: '未命中',
  miss: '未命中',
  'wrong-direction': '方向错误',
  'wrong-hand': '光剑错误',
  obstacle: '撞上障碍',
  OBSTACLE: '撞上障碍',
  late: '太晚了',
});

export function formatHudTime(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

export function shouldShowVRHud({ presenting = false, phase = 'menu', menuVisible = false } = {}) {
  return Boolean(presenting && !menuVisible && HUD_PHASES.has(phase));
}

export function shouldRefreshVRHud(lastDrawAt, now, force = false, interval = VR_HUD_REFRESH_MS) {
  if (force || !Number.isFinite(lastDrawAt)) return true;
  return Math.max(0, Number(now) || 0) - lastDrawAt >= Math.max(16, Number(interval) || VR_HUD_REFRESH_MS);
}

export function normalizeVRHudData({ time = 0, duration = 0, state = {}, mode = 'standard', phase = 'menu', title = '' } = {}) {
  const elapsed = Math.max(0, Number(time) || 0);
  const total = Math.max(elapsed, Number(duration) || 0);
  const accuracy = THREE.MathUtils.clamp(Number(state.accuracy ?? 1) || 0, 0, 1);
  return {
    time: elapsed,
    duration: total,
    progress: total > 0 ? THREE.MathUtils.clamp(elapsed / total, 0, 1) : 0,
    score: Math.max(0, Math.round(Number(state.score) || 0)),
    combo: Math.max(0, Math.round(Number(state.combo) || 0)),
    maxCombo: Math.max(0, Math.round(Number(state.maxCombo ?? state.bestCombo) || 0)),
    multiplier: Math.max(1, Math.round(Number(state.multiplier) || 1)),
    accuracy,
    hits: Math.max(0, Math.round(Number(state.hits) || 0)),
    misses: Math.max(0, Math.round(Number(state.misses) || 0)),
    health: THREE.MathUtils.clamp(Number(state.health ?? 100) || 0, 0, 100),
    mode: VR_HUD_MODE_LABELS[mode] ? mode : 'standard',
    phase: HUD_PHASES.has(phase) ? phase : 'menu',
    title: String(title || '节奏光剑').slice(0, 42),
  };
}

/** Visible in-headset controls and their CanvasTexture bounds. */
export function getVRHudControls(phase = 'playing') {
  if (phase === 'paused') {
    return [
      hudControl(VR_HUD_TEXT.resume, { type: VR_HUD_ACTIONS.RESUME }, 458, 184, 190, 62),
      hudControl(VR_HUD_TEXT.restart, { type: VR_HUD_ACTIONS.RESTART }, 673, 184, 190, 62),
      hudControl(VR_HUD_TEXT.returnToSelection, { type: VR_HUD_ACTIONS.RETURN_TO_SELECTION }, 888, 184, 220, 62),
    ];
  }
  if (phase === 'results') {
    return [
      hudControl(VR_HUD_TEXT.playAgain, { type: VR_HUD_ACTIONS.PLAY_AGAIN }, 566, 184, 190, 62),
      hudControl(VR_HUD_TEXT.returnToSelection, { type: VR_HUD_ACTIONS.RETURN_TO_SELECTION }, 781, 184, 220, 62),
    ];
  }
  if (phase === 'playing') return [hudControl(VR_HUD_TEXT.pause, { type: VR_HUD_ACTIONS.PAUSE }, 1278, 184, 190, 62)];
  return [];
}

export function localizeVRHudMiss(reason = 'MISS') {
  const raw = String(reason || 'MISS');
  if (MISS_LABELS[raw]) return MISS_LABELS[raw];
  return /[\u3400-\u9fff]/u.test(raw) ? raw : '未命中';
}

export function createHapticProfile({ hurt = false, accent = false, automatic = false, lowPower = false } = {}) {
  if (hurt) return { intensity: lowPower ? 0.76 : 0.84, duration: 96 };
  const intensity = accent ? 0.72 : automatic ? 0.58 : 0.52;
  return { intensity: Math.max(0.4, intensity - (lowPower ? 0.04 : 0)), duration: accent ? 64 : automatic ? 54 : 48 };
}

/**
 * A low, non-blocking Three.js HUD for immersive sessions. It owns real ray
 * targets, so pause, retry and return actions work without any webpage DOM.
 */
export class VRHud {
  constructor({ lowPower = false, reducedMotion = false, onAction = null } = {}) {
    this.lowPower = Boolean(lowPower);
    this.reducedMotion = Boolean(reducedMotion);
    this.onAction = onAction;
    this.group = new THREE.Group();
    this.group.name = 'rift-vr-hud';
    this.group.position.set(0, 0.68, -1.5);
    this.group.visible = false;
    this.presenting = false;
    this.menuVisible = false;
    this.phase = 'menu';
    this.lastDrawAt = Number.NaN;
    this.lastData = normalizeVRHudData();
    this.feedback = null;
    this.hitTargets = [];
    this.hovered = null;
    this._controllers = new Set();
    this._raycaster = new THREE.Raycaster();
    this._rotationMatrix = new THREE.Matrix4();
    this._canvas = createHudCanvas();
    this._context = this._canvas?.getContext?.('2d') || null;
    this._texture = this._canvas ? new THREE.CanvasTexture(this._canvas) : null;
    if (this._texture) {
      this._texture.colorSpace = THREE.SRGBColorSpace;
      this._texture.minFilter = THREE.LinearFilter;
      this._texture.magFilter = THREE.LinearFilter;
      this._texture.generateMipmaps = false;
    }
    this._build();
    this._rebuildTargets();
    this.update({}, { force: true, now: 0 });
  }

  setPresenting(presenting) {
    this.presenting = Boolean(presenting);
    this._syncVisibility();
  }

  setMenuVisible(visible) {
    this.menuVisible = Boolean(visible);
    this._syncVisibility();
  }

  setPhase(phase) {
    const changed = phase !== this.phase;
    this.phase = phase;
    if (changed) {
      this.lastData = { ...this.lastData, phase: HUD_PHASES.has(phase) ? phase : 'menu' };
      this.hovered = null;
      this._rebuildTargets();
      this._draw();
    }
    this._syncVisibility();
  }

  snapshot() {
    return {
      visible: this.group.visible,
      presenting: this.presenting,
      menuVisible: this.menuVisible,
      phase: this.phase,
      data: { ...this.lastData },
      actions: getVRHudControls(this.phase).map((control) => ({ ...control.action })),
    };
  }

  update(data = {}, { force = false, now = globalThis.performance?.now?.() ?? Date.now() } = {}) {
    const state = data.state || {
      score: this.lastData.score,
      combo: this.lastData.combo,
      maxCombo: this.lastData.maxCombo,
      multiplier: this.lastData.multiplier,
      accuracy: this.lastData.accuracy,
      hits: this.lastData.hits,
      misses: this.lastData.misses,
      health: this.lastData.health,
    };
    const previousPhase = this.phase;
    this.lastData = normalizeVRHudData({ ...this.lastData, ...data, state });
    this.phase = this.lastData.phase;
    if (previousPhase !== this.phase) {
      this.hovered = null;
      this._rebuildTargets();
    }
    this._syncVisibility();
    if (!shouldRefreshVRHud(this.lastDrawAt, now, force)) return false;
    this.lastDrawAt = now;
    this._draw();
    return true;
  }

  updateController(controller) {
    if (!controller) return null;
    this._controllers.add(controller);
    if (!this.group.visible) {
      this._updateRay(controller, 0, false, false);
      return null;
    }
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
      this._draw();
    }
    this._updateRay(controller, hit ? Math.min(3.5, intersection.distance) : 2.2, Boolean(hit), true);
    return hit?.userData?.hudAction || null;
  }

  select(controller) {
    const action = this.updateController(controller);
    if (!action) return false;
    this.activate(action);
    return true;
  }

  activate(action) {
    if (!getVRHudControls(this.phase).some((control) => sameAction(control.action, action))) return false;
    const output = { ...action };
    this.onAction?.(output, this.snapshot());
    return output;
  }

  flashHit({ noteScore = 0, judgement = {}, hand = 'right', color = 0xffffff } = {}, { redraw = true } = {}) {
    const quality = judgement.automatic ? VR_HUD_TEXT.aiPerfect : qualityLabel(judgement);
    this.feedback = {
      label: quality,
      score: `+${Math.max(0, Math.round(Number(noteScore) || 0)).toLocaleString('zh-CN')}`,
      color: new THREE.Color(color).getStyle(),
      side: hand === 'left' ? -1 : 1,
      born: globalThis.performance?.now?.() ?? Date.now(),
      lifetime: this.reducedMotion ? 420 : 720,
      miss: false,
    };
    if (redraw) this.update({}, { force: true, now: this.feedback.born });
  }

  flashMiss(reason = 'MISS', { redraw = true } = {}) {
    const now = globalThis.performance?.now?.() ?? Date.now();
    this.feedback = {
      label: localizeVRHudMiss(reason),
      score: VR_HUD_TEXT.comboReset,
      color: 'rgb(255, 95, 126)',
      side: 0,
      born: now,
      lifetime: this.reducedMotion ? 420 : 680,
      miss: true,
    };
    if (redraw) this.update({}, { force: true, now });
  }

  animate(now = globalThis.performance?.now?.() ?? Date.now()) {
    if (!this.feedback) return;
    if (now - this.feedback.born >= this.feedback.lifetime) {
      this.feedback = null;
      this.update({}, { force: true, now });
      return;
    }
    this.update({}, { now });
  }

  dispose() {
    this.group.parent?.remove(this.group);
    for (const controller of this._controllers) this._updateRay(controller, 0, false, false);
    this._controllers.clear();
    this.group.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((material) => material?.dispose?.());
      else object.material?.dispose?.();
    });
    this._texture?.dispose?.();
    this.feedback = null;
    this.hitTargets.length = 0;
  }

  _syncVisibility() {
    this.group.visible = shouldShowVRHud({ presenting: this.presenting, phase: this.phase, menuVisible: this.menuVisible });
    if (!this.group.visible) {
      this.hovered = null;
      for (const controller of this._controllers) this._updateRay(controller, 0, false, false);
    }
  }

  _build() {
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(2.78, 0.59),
      new THREE.MeshBasicMaterial({ color: 0x38dfff, transparent: true, opacity: this.lowPower ? 0.085 : 0.15, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    halo.name = 'vr-hud-halo';
    halo.position.z = -0.014;
    const backing = new THREE.Mesh(
      new THREE.PlaneGeometry(2.62, 0.49),
      new THREE.MeshPhysicalMaterial({
        color: 0x081127,
        emissive: 0x09152f,
        emissiveIntensity: 0.92,
        metalness: 0.08,
        roughness: 0.2,
        transparent: true,
        opacity: 0.84,
        transmission: this.lowPower ? 0 : 0.12,
        thickness: 0.06,
        clearcoat: this.lowPower ? 0 : 0.65,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    backing.name = 'vr-hud-acrylic';
    backing.position.z = -0.008;
    const display = new THREE.Mesh(
      new THREE.PlaneGeometry(HUD_PANEL_WIDTH, HUD_PANEL_HEIGHT),
      new THREE.MeshBasicMaterial({ map: this._texture, color: this._texture ? 0xffffff : 0x10254c, transparent: true, opacity: 0.98, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    );
    display.name = 'vr-hud-display';
    display.renderOrder = 25;
    this.group.add(halo, backing, display);
  }

  _rebuildTargets() {
    for (const target of this.hitTargets) {
      this.group.remove(target);
      target.geometry?.dispose?.();
      target.material?.dispose?.();
    }
    this.hitTargets.length = 0;
    for (const control of getVRHudControls(this.phase)) {
      const bounds = hudCanvasBoundsToLocal(control.bounds);
      const target = new THREE.Mesh(
        new THREE.PlaneGeometry(bounds.width, bounds.height),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, side: THREE.DoubleSide }),
      );
      target.position.set(bounds.x, bounds.y, 0.024);
      target.userData.hudAction = control.action;
      target.userData.label = control.label;
      this.group.add(target);
      this.hitTargets.push(target);
    }
  }

  _draw() {
    const ctx = this._context;
    if (!ctx) return;
    const data = this.lastData;
    const { width, height } = this._canvas;
    ctx.clearRect(0, 0, width, height);

    const glass = ctx.createLinearGradient(0, 0, width, 0);
    glass.addColorStop(0, 'rgba(10, 27, 57, .94)');
    glass.addColorStop(0.5, 'rgba(8, 14, 35, .92)');
    glass.addColorStop(1, 'rgba(38, 11, 52, .94)');
    roundedRect(ctx, 8, 8, width - 16, height - 16, 40);
    ctx.fillStyle = glass;
    ctx.fill();
    ctx.strokeStyle = 'rgba(125, 232, 255, .68)';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#41e7ff';
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;

    drawMetric(ctx, 72, 62, VR_HUD_TEXT.score, data.score.toLocaleString('zh-CN'), '#ffffff', 'left');
    drawMetric(ctx, 420, 62, VR_HUD_TEXT.combo, `${data.combo} ×${data.multiplier}`, '#ff73d7', 'left');
    drawMetric(ctx, width - 430, 62, VR_HUD_TEXT.accuracy, `${(data.accuracy * 100).toFixed(1)}%`, '#83f4ff', 'left');
    drawMetric(ctx, width - 72, 62, VR_HUD_TEXT.hitMiss, `${data.hits} / ${data.misses}`, data.misses ? '#ffd2dd' : '#dffeff', 'right');

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f6fbff';
    ctx.font = chineseFont(48, 900);
    ctx.fillText(`${formatHudTime(data.time)}  /  ${formatHudTime(data.duration)}`, width / 2, 132);
    ctx.fillStyle = 'rgba(218, 234, 255, .68)';
    ctx.font = chineseFont(20, 650);
    ctx.fillText(`${VR_HUD_MODE_LABELS[data.mode]}  ·  ${VR_HUD_PHASE_LABELS[data.phase] || ''}  ·  ${data.title}`, width / 2, 166, 850);

    for (const control of getVRHudControls(this.phase)) drawHudControl(ctx, control, isHudHovered(this.hovered, control.action));

    roundedRect(ctx, 68, 258, width - 136, 16, 8);
    ctx.fillStyle = 'rgba(255,255,255,.1)';
    ctx.fill();
    const progress = Math.max(8, (width - 136) * data.progress);
    const progressGradient = ctx.createLinearGradient(68, 0, width - 68, 0);
    progressGradient.addColorStop(0, '#35ddff');
    progressGradient.addColorStop(1, '#ff45c8');
    roundedRect(ctx, 68, 258, progress, 16, 8);
    ctx.fillStyle = progressGradient;
    ctx.shadowColor = '#49e5ff';
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.shadowBlur = 0;

    if (this.feedback) drawFeedback(ctx, width, height, this.feedback, globalThis.performance?.now?.() ?? Date.now(), this.reducedMotion);
    if (this._texture) this._texture.needsUpdate = true;
  }

  _updateRay(controller, distance, active, visible = this.group.visible) {
    let line = controller.getObjectByName?.('rift-hud-ray');
    if (!line && !visible) return;
    if (!line) {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
      line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x79eaff, transparent: true, opacity: 0.56, toneMapped: false }));
      line.name = 'rift-hud-ray';
      controller.add(line);
    }
    let reticle = controller.getObjectByName?.('rift-hud-reticle');
    if (!reticle && visible) {
      reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.008, 0.018, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.96, depthTest: false, depthWrite: false, toneMapped: false }),
      );
      reticle.name = 'rift-hud-reticle';
      reticle.renderOrder = 31;
      controller.add(reticle);
    }
    line.visible = Boolean(visible);
    line.scale.z = Math.max(0.15, distance || 0.15);
    line.material.color.setHex(active ? 0xffffff : 0x79eaff);
    line.material.opacity = active ? 1 : 0.42;
    if (reticle) {
      reticle.visible = Boolean(visible && active);
      reticle.position.set(0, 0, -Math.max(0.15, distance || 0.15));
    }
  }
}

function qualityLabel(judgement = {}) {
  const timing = Math.abs(Number(judgement.timing) || 0);
  if (judgement.quality) {
    const quality = String(judgement.quality).toLowerCase();
    if (quality === 'perfect') return VR_HUD_TEXT.perfect;
    if (quality === 'great') return VR_HUD_TEXT.great;
    if (quality === 'good') return VR_HUD_TEXT.good;
    return String(judgement.quality);
  }
  if (timing <= 0.035) return VR_HUD_TEXT.perfect;
  if (timing <= 0.09) return VR_HUD_TEXT.great;
  return VR_HUD_TEXT.good;
}

function hudControl(label, action, x, y, width, height) {
  return { label, action, bounds: { x, y, width, height } };
}

function hudCanvasBoundsToLocal({ x, y, width, height }) {
  return {
    x: ((x + width / 2) / HUD_CANVAS_WIDTH - 0.5) * HUD_PANEL_WIDTH,
    y: (0.5 - (y + height / 2) / HUD_CANVAS_HEIGHT) * HUD_PANEL_HEIGHT,
    width: width / HUD_CANVAS_WIDTH * HUD_PANEL_WIDTH,
    height: height / HUD_CANVAS_HEIGHT * HUD_PANEL_HEIGHT,
  };
}

function sameAction(left, right) {
  return Boolean(left?.type && left.type === right?.type);
}

function isHudHovered(target, action) {
  return sameAction(target?.userData?.hudAction, action);
}

function createHudCanvas() {
  if (!globalThis.document?.createElement && !globalThis.OffscreenCanvas) return null;
  const canvas = globalThis.document?.createElement ? document.createElement('canvas') : new globalThis.OffscreenCanvas(HUD_CANVAS_WIDTH, HUD_CANVAS_HEIGHT);
  canvas.width = HUD_CANVAS_WIDTH;
  canvas.height = HUD_CANVAS_HEIGHT;
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

function drawMetric(ctx, x, y, label, value, color, align) {
  ctx.textAlign = align;
  ctx.fillStyle = 'rgba(206, 225, 250, .62)';
  ctx.font = chineseFont(17, 650);
  ctx.fillText(label, x, y);
  ctx.fillStyle = color;
  ctx.font = chineseFont(34, 850);
  ctx.fillText(value, x, y + 39);
}

function drawHudControl(ctx, control, hovered) {
  const { x, y, width, height } = control.bounds;
  roundedRect(ctx, x, y, width, height, 20);
  ctx.fillStyle = hovered ? 'rgba(103,236,255,.9)' : 'rgba(105,226,255,.18)';
  ctx.fill();
  ctx.strokeStyle = hovered ? '#ffffff' : 'rgba(126,235,255,.65)';
  ctx.lineWidth = hovered ? 3 : 2;
  ctx.shadowColor = '#51eaff';
  ctx.shadowBlur = hovered ? 22 : 8;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = hovered ? '#07111e' : '#f7fbff';
  ctx.font = chineseFont(21, 800);
  ctx.textAlign = 'center';
  ctx.fillText(control.label, x + width / 2, y + height / 2 + 8, width - 18);
}

function drawFeedback(ctx, width, height, feedback, now, reducedMotion) {
  const progress = THREE.MathUtils.clamp((now - feedback.born) / feedback.lifetime, 0, 1);
  const alpha = progress < 0.65 ? 1 : 1 - (progress - 0.65) / 0.35;
  const bump = reducedMotion ? 1 : 1 + Math.sin(Math.min(1, progress * 4) * Math.PI) * 0.09;
  const x = width / 2 + feedback.side * 330;
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.translate(x, height - 25);
  ctx.scale(bump, bump);
  ctx.textAlign = 'center';
  ctx.shadowColor = feedback.color;
  ctx.shadowBlur = feedback.miss ? 16 : 28;
  ctx.fillStyle = feedback.color;
  ctx.font = chineseFont(25, 900);
  ctx.fillText(`${feedback.label}  ${feedback.score}`, 0, 0);
  ctx.restore();
}
