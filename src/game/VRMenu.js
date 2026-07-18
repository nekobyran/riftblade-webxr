import * as THREE from 'three';

export const VR_MENU_PAGE_SIZE = 5;
export const VR_MENU_MODES = Object.freeze(['standard', 'auto', 'zen']);

export function createVRMenuState({ tracks = [], selectedTrackId = null, mode = 'standard', page = 0 } = {}) {
  const safeTracks = Array.isArray(tracks) ? tracks : [];
  const pages = Math.max(1, Math.ceil(safeTracks.length / VR_MENU_PAGE_SIZE));
  const selected = safeTracks.some((track) => track.id === selectedTrackId) ? selectedTrackId : safeTracks[0]?.id || null;
  return {
    page: Math.max(0, Math.min(pages - 1, Number(page) || 0)),
    pages,
    selectedTrackId: selected,
    mode: VR_MENU_MODES.includes(mode) ? mode : 'standard',
  };
}

export function reduceVRMenuAction(state, action, tracks = []) {
  const current = createVRMenuState({ tracks, ...state });
  if (!action?.type) return current;
  if (action.type === 'page') return createVRMenuState({ tracks, ...current, page: current.page + (Number(action.delta) || 0) });
  if (action.type === 'track' && tracks.some((track) => track.id === action.trackId)) {
    return createVRMenuState({ tracks, ...current, selectedTrackId: action.trackId });
  }
  if (action.type === 'mode' && VR_MENU_MODES.includes(action.mode)) return { ...current, mode: action.mode };
  return current;
}

/**
 * A dependency-free in-headset menu. CanvasTexture keeps the labels crisp while
 * separate invisible hit planes provide stable controller ray targets.
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
    return { ...this.state };
  }

  setTracks(tracks, selectedTrackId = this.state.selectedTrackId) {
    this.tracks = Array.isArray(tracks) ? tracks : [];
    const selectedIndex = this.tracks.findIndex((track) => track.id === selectedTrackId);
    const page = selectedIndex >= 0 ? Math.floor(selectedIndex / VR_MENU_PAGE_SIZE) : this.state.page;
    this.state = createVRMenuState({ tracks: this.tracks, selectedTrackId, mode: this.state.mode, page });
    this._rebuildTargets();
    this.redraw();
  }

  setMode(mode) {
    this.state = reduceVRMenuAction(this.state, { type: 'mode', mode }, this.tracks);
    this.redraw();
  }

  setTrack(trackId) {
    this.state = reduceVRMenuAction(this.state, { type: 'track', trackId }, this.tracks);
    const index = this.tracks.findIndex((track) => track.id === this.state.selectedTrackId);
    if (index >= 0) this.state = createVRMenuState({ tracks: this.tracks, ...this.state, page: Math.floor(index / VR_MENU_PAGE_SIZE) });
    this._rebuildTargets();
    this.redraw();
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

  activate(action) {
    const previous = this.state;
    this.state = reduceVRMenuAction(this.state, action, this.tracks);
    if (action.type === 'page') this._rebuildTargets();
    if (action.type === 'start') {
      action = { ...action, trackId: this.state.selectedTrackId, mode: this.state.mode };
    }
    this.redraw();
    this.onAction?.(action, { ...this.state }, previous);
  }

  redraw() {
    const ctx = this._context;
    if (!ctx) return;
    const { width, height } = this._canvas;
    ctx.clearRect(0, 0, width, height);

    const glass = ctx.createLinearGradient(0, 0, width, height);
    glass.addColorStop(0, 'rgba(15, 25, 54, .94)');
    glass.addColorStop(0.55, 'rgba(12, 15, 35, .88)');
    glass.addColorStop(1, 'rgba(37, 12, 53, .92)');
    roundedRect(ctx, 12, 12, width - 24, height - 24, 54);
    ctx.fillStyle = glass;
    ctx.fill();
    ctx.strokeStyle = 'rgba(151, 222, 255, .62)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#a8f4ff';
    ctx.font = '700 30px system-ui, sans-serif';
    ctx.fillText('RIFT / SELECT', 68, 82);
    ctx.fillStyle = 'rgba(235,244,255,.72)';
    ctx.font = '500 18px system-ui, sans-serif';
    ctx.fillText(`PAGE ${this.state.page + 1} / ${this.state.pages}  ·  TRIGGER TO SELECT`, 68, 116);

    const visibleTracks = this._visibleTracks();
    visibleTracks.forEach((track, index) => {
      const y = 154 + index * 145;
      const selected = track.id === this.state.selectedTrackId;
      const hovered = this.hovered?.userData?.menuAction?.trackId === track.id;
      drawButton(ctx, 58, y, width - 116, 116, {
        selected,
        hovered,
        label: track.title || track.name || `TRACK ${index + 1}`,
        meta: `${track.bpm || '—'} BPM  ·  ${track.metadata?.style || track.genre || 'ORIGINAL RIFT'}`,
      });
    });

    const navY = 892;
    drawCompact(ctx, 58, navY, 190, 70, '‹  PREV', this.hovered?.userData?.menuAction?.delta === -1, this.state.page <= 0);
    drawCompact(ctx, width - 248, navY, 190, 70, 'NEXT  ›', this.hovered?.userData?.menuAction?.delta === 1, this.state.page >= this.state.pages - 1);

    ctx.fillStyle = 'rgba(235,244,255,.64)';
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillText('PLAY MODE', 58, 1020);
    const labels = { standard: 'STANDARD', auto: 'AI AUTO', zen: 'PURE' };
    VR_MENU_MODES.forEach((mode, index) => {
      const x = 58 + index * 304;
      const hovered = this.hovered?.userData?.menuAction?.mode === mode;
      drawCompact(ctx, x, 1044, 278, 76, labels[mode], hovered || this.state.mode === mode, false, this.state.mode === mode);
    });

    const startHover = this.hovered?.userData?.menuAction?.type === 'start';
    drawStart(ctx, 58, 1154, width - 116, 96, startHover, Boolean(this.state.selectedTrackId));
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

  _buildPanel() {
    const backing = new THREE.Mesh(
      new THREE.PlaneGeometry(1.88, 2.38),
      new THREE.MeshPhysicalMaterial({
        color: 0x17213e,
        emissive: 0x091126,
        emissiveIntensity: 0.45,
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
      new THREE.PlaneGeometry(1.84, 2.3),
      new THREE.MeshBasicMaterial({ map: this._texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    display.renderOrder = 8;
    this.group.add(backing, display);
  }

  _rebuildTargets() {
    for (const target of this.hitTargets) {
      this.group.remove(target);
      target.geometry?.dispose?.();
      target.material?.dispose?.();
    }
    this.hitTargets.length = 0;
    const addTarget = (x, y, width, height, action, disabled = false) => {
      if (disabled) return;
      const target = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, side: THREE.DoubleSide }),
      );
      target.position.set(x, y, 0.02);
      target.userData.menuAction = action;
      this.group.add(target);
      this.hitTargets.push(target);
    };
    this._visibleTracks().forEach((track, index) => addTarget(0, 0.76 - index * 0.27, 1.64, 0.22, { type: 'track', trackId: track.id }));
    addTarget(-0.67, -0.56, 0.38, 0.14, { type: 'page', delta: -1 }, this.state.page <= 0);
    addTarget(0.67, -0.56, 0.38, 0.14, { type: 'page', delta: 1 }, this.state.page >= this.state.pages - 1);
    VR_MENU_MODES.forEach((mode, index) => addTarget(-0.56 + index * 0.56, -0.86, 0.5, 0.15, { type: 'mode', mode }));
    addTarget(0, -1.08, 1.64, 0.18, { type: 'start' }, !this.state.selectedTrackId);
  }

  _updateRay(controller, distance, active) {
    let line = controller.getObjectByName?.('rift-menu-ray');
    if (!line) {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
      line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x7de8ff, transparent: true, opacity: 0.72 }));
      line.name = 'rift-menu-ray';
      controller.add(line);
    }
    let reticle = controller.getObjectByName?.('rift-menu-reticle');
    if (!reticle) {
      reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.008, 0.018, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.94, depthTest: false, depthWrite: false }),
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

function createMenuCanvas() {
  if (!globalThis.document?.createElement && !globalThis.OffscreenCanvas) return null;
  const canvas = globalThis.document?.createElement ? document.createElement('canvas') : new globalThis.OffscreenCanvas(1024, 1280);
  canvas.width = 1024;
  canvas.height = 1280;
  return canvas;
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect?.(x, y, width, height, radius);
  if (!ctx.roundRect) ctx.rect(x, y, width, height);
}

function drawButton(ctx, x, y, width, height, { selected, hovered, label, meta }) {
  roundedRect(ctx, x, y, width, height, 28);
  ctx.fillStyle = selected ? 'rgba(52, 225, 255, .24)' : hovered ? 'rgba(255,255,255,.17)' : 'rgba(255,255,255,.07)';
  ctx.fill();
  ctx.strokeStyle = selected ? '#70efff' : hovered ? 'rgba(255,255,255,.65)' : 'rgba(255,255,255,.13)';
  ctx.lineWidth = selected ? 3 : 2;
  ctx.stroke();
  ctx.fillStyle = selected ? '#ffffff' : '#eef3ff';
  ctx.font = '700 30px system-ui, sans-serif';
  ctx.fillText(label, x + 34, y + 47, width - 68);
  ctx.fillStyle = selected ? '#a8f4ff' : 'rgba(226,236,255,.58)';
  ctx.font = '500 18px system-ui, sans-serif';
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
  ctx.font = '700 20px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + width / 2, y + height / 2 + 7);
  ctx.textAlign = 'left';
}

function drawStart(ctx, x, y, width, height, hovered, enabled) {
  const gradient = ctx.createLinearGradient(x, y, x + width, y);
  gradient.addColorStop(0, enabled ? '#16d9ff' : 'rgba(255,255,255,.15)');
  gradient.addColorStop(1, enabled ? '#ff45cc' : 'rgba(255,255,255,.08)');
  roundedRect(ctx, x, y, width, height, 30);
  ctx.fillStyle = gradient;
  ctx.globalAlpha = hovered ? 1 : 0.82;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = enabled ? '#06101d' : 'rgba(255,255,255,.35)';
  ctx.font = '900 27px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('IGNITE RIFT', x + width / 2, y + height / 2 + 10);
  ctx.textAlign = 'left';
}
