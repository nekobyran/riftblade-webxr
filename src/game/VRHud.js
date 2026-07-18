import * as THREE from 'three';

export const VR_HUD_REFRESH_MS = 100;

const HUD_PHASES = new Set(['playing', 'paused', 'results']);
const MODE_LABELS = Object.freeze({ standard: 'STANDARD', auto: 'AI AUTO', zen: 'PURE' });

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
    multiplier: Math.max(1, Math.round(Number(state.multiplier) || 1)),
    accuracy,
    hits: Math.max(0, Math.round(Number(state.hits) || 0)),
    misses: Math.max(0, Math.round(Number(state.misses) || 0)),
    health: THREE.MathUtils.clamp(Number(state.health ?? 100) || 0, 0, 100),
    mode: MODE_LABELS[mode] ? mode : 'standard',
    phase: HUD_PHASES.has(phase) ? phase : 'menu',
    title: String(title || 'RIFT BLADE').slice(0, 42),
  };
}

export function createHapticProfile({ hurt = false, accent = false, automatic = false, lowPower = false } = {}) {
  if (hurt) return { intensity: lowPower ? 0.6 : 0.68, duration: 78 };
  const intensity = accent ? 0.54 : automatic ? 0.44 : 0.4;
  return { intensity: Math.max(0.28, intensity - (lowPower ? 0.04 : 0)), duration: accent ? 54 : 42 };
}

/**
 * A low, non-blocking Three.js HUD for immersive sessions. The CanvasTexture
 * is deliberately redrawn at no more than 10 Hz; the small hit banner is
 * composited into the same texture so Quest does not allocate one texture per
 * note.
 */
export class VRHud {
  constructor({ lowPower = false, reducedMotion = false } = {}) {
    this.lowPower = Boolean(lowPower);
    this.reducedMotion = Boolean(reducedMotion);
    this.group = new THREE.Group();
    this.group.name = 'rift-vr-hud';
    // Lower than both gameplay rows (0.82 m / 1.68 m) and slightly behind the
    // hit plane, so the four-lane note corridor remains completely readable.
    // Keep the panel below the lower note row but inside the straight-ahead
    // vertical field of view for an average standing Quest player.
    this.group.position.set(0, 0.68, -1.5);
    this.group.visible = false;
    this.presenting = false;
    this.menuVisible = false;
    this.phase = 'menu';
    this.lastDrawAt = Number.NaN;
    this.lastData = normalizeVRHudData();
    this.feedback = null;
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
    this.phase = phase;
    this._syncVisibility();
  }

  update(data = {}, { force = false, now = globalThis.performance?.now?.() ?? Date.now() } = {}) {
    const state = data.state || {
      score: this.lastData.score,
      combo: this.lastData.combo,
      multiplier: this.lastData.multiplier,
      accuracy: this.lastData.accuracy,
      hits: this.lastData.hits,
      misses: this.lastData.misses,
      health: this.lastData.health,
    };
    this.lastData = normalizeVRHudData({ ...this.lastData, ...data, state });
    this.phase = this.lastData.phase;
    this._syncVisibility();
    if (!shouldRefreshVRHud(this.lastDrawAt, now, force)) return false;
    this.lastDrawAt = now;
    this._draw();
    return true;
  }

  flashHit({ noteScore = 0, judgement = {}, hand = 'right', color = 0xffffff } = {}, { redraw = true } = {}) {
    const quality = judgement.automatic ? 'AI PERFECT' : qualityLabel(judgement);
    this.feedback = {
      label: quality,
      score: `+${Math.max(0, Math.round(Number(noteScore) || 0)).toLocaleString('en-US')}`,
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
      label: String(reason || 'MISS').replaceAll('-', ' ').toUpperCase(),
      score: 'COMBO RESET',
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
    // 10 Hz redraw still gives a readable fade without driving a Quest canvas
    // upload on every XR frame.
    this.update({}, { now });
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((material) => material?.dispose?.());
      else object.material?.dispose?.();
    });
    this._texture?.dispose?.();
    this.feedback = null;
  }

  _syncVisibility() {
    this.group.visible = shouldShowVRHud({ presenting: this.presenting, phase: this.phase, menuVisible: this.menuVisible });
  }

  _build() {
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(2.74, 0.56),
      new THREE.MeshBasicMaterial({ color: 0x38dfff, transparent: true, opacity: this.lowPower ? 0.055 : 0.09, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    halo.name = 'vr-hud-halo';
    halo.position.z = -0.014;
    const backing = new THREE.Mesh(
      new THREE.PlaneGeometry(2.62, 0.49),
      new THREE.MeshPhysicalMaterial({
        color: 0x081127,
        emissive: 0x09152f,
        emissiveIntensity: 0.82,
        metalness: 0.08,
        roughness: 0.2,
        transparent: true,
        opacity: 0.82,
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
      new THREE.PlaneGeometry(2.58, 0.46),
      new THREE.MeshBasicMaterial({ map: this._texture, color: this._texture ? 0xffffff : 0x10254c, transparent: true, opacity: 0.98, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    );
    display.name = 'vr-hud-display';
    display.renderOrder = 25;
    this.group.add(halo, backing, display);
  }

  _draw() {
    const ctx = this._context;
    if (!ctx) return;
    const data = this.lastData;
    const { width, height } = this._canvas;
    ctx.clearRect(0, 0, width, height);

    const glass = ctx.createLinearGradient(0, 0, width, 0);
    glass.addColorStop(0, 'rgba(10, 27, 57, .92)');
    glass.addColorStop(0.5, 'rgba(8, 14, 35, .9)');
    glass.addColorStop(1, 'rgba(38, 11, 52, .92)');
    roundedRect(ctx, 8, 8, width - 16, height - 16, 40);
    ctx.fillStyle = glass;
    ctx.fill();
    ctx.strokeStyle = 'rgba(125, 232, 255, .55)';
    ctx.lineWidth = 3;
    ctx.stroke();

    drawMetric(ctx, 72, 62, 'SCORE', data.score.toLocaleString('en-US'), '#ffffff', 'left');
    drawMetric(ctx, 420, 62, 'COMBO', `${data.combo} ×${data.multiplier}`, '#ff73d7', 'left');
    drawMetric(ctx, width - 430, 62, 'ACCURACY', `${(data.accuracy * 100).toFixed(1)}%`, '#83f4ff', 'left');
    drawMetric(ctx, width - 72, 62, 'HIT / MISS', `${data.hits} / ${data.misses}`, data.misses ? '#ffd2dd' : '#dffeff', 'right');

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f6fbff';
    ctx.font = '900 48px system-ui, sans-serif';
    ctx.fillText(`${formatHudTime(data.time)}  /  ${formatHudTime(data.duration)}`, width / 2, 132);
    ctx.fillStyle = 'rgba(218, 234, 255, .63)';
    ctx.font = '650 20px system-ui, sans-serif';
    ctx.fillText(`${MODE_LABELS[data.mode]}  ·  ${data.phase.toUpperCase()}  ·  ${data.title}`, width / 2, 166, 710);

    roundedRect(ctx, 68, 202, width - 136, 26, 13);
    ctx.fillStyle = 'rgba(255,255,255,.1)';
    ctx.fill();
    const progress = Math.max(8, (width - 136) * data.progress);
    const progressGradient = ctx.createLinearGradient(68, 0, width - 68, 0);
    progressGradient.addColorStop(0, '#35ddff');
    progressGradient.addColorStop(1, '#ff45c8');
    roundedRect(ctx, 68, 202, progress, 26, 13);
    ctx.fillStyle = progressGradient;
    ctx.shadowColor = '#49e5ff';
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.shadowBlur = 0;

    if (this.feedback) drawFeedback(ctx, width, height, this.feedback, globalThis.performance?.now?.() ?? Date.now(), this.reducedMotion);
    this._texture.needsUpdate = true;
  }
}

function qualityLabel(judgement = {}) {
  const timing = Math.abs(Number(judgement.timing) || 0);
  if (judgement.quality) return String(judgement.quality).toUpperCase();
  if (timing <= 0.035) return 'PERFECT';
  if (timing <= 0.09) return 'GREAT';
  return 'GOOD';
}

function createHudCanvas() {
  if (!globalThis.document?.createElement && !globalThis.OffscreenCanvas) return null;
  const canvas = globalThis.document?.createElement ? document.createElement('canvas') : new globalThis.OffscreenCanvas(1536, 288);
  canvas.width = 1536;
  canvas.height = 288;
  return canvas;
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect?.(x, y, width, height, radius);
  if (!ctx.roundRect) ctx.rect(x, y, width, height);
}

function drawMetric(ctx, x, y, label, value, color, align) {
  ctx.textAlign = align;
  ctx.fillStyle = 'rgba(206, 225, 250, .56)';
  ctx.font = '650 17px system-ui, sans-serif';
  ctx.fillText(label, x, y);
  ctx.fillStyle = color;
  ctx.font = '850 34px system-ui, sans-serif';
  ctx.fillText(value, x, y + 39);
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
  ctx.font = '900 25px system-ui, sans-serif';
  ctx.fillText(`${feedback.label}  ${feedback.score}`, 0, 0);
  ctx.restore();
}
