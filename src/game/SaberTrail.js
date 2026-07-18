import * as THREE from 'three';

const DEFAULT_MAX_SAMPLES = 10;
const LOW_POWER_SAMPLE_CAP = 7;
const REDUCED_MOTION_SAMPLE_CAP = 5;
const HARD_SAMPLE_CAP = 96;
const MIN_TIME_STEP = 1 / 240;
const WHITE = new THREE.Color(0xffffff);

/**
 * Allocation-free swept-saber ribbon.
 *
 * Each sample is a blade slice (world-space hilt and tip). Consecutive slices
 * become a quad, producing the broad fan-shaped trail seen behind a real
 * rhythm-game saber rather than a single static line. Two HDR additive layers
 * share the same fixed-capacity layout: a white-hot core and a wider coloured
 * glow that becomes brighter and broader as swing speed rises.
 *
 * Typical frame usage (one instance per hand):
 *   trail.update(elapsedSeconds, bladeBaseWorld, bladeTipWorld);
 *
 * `elapsedSeconds` is absolute. A backwards timestamp is treated as a song
 * restart and safely resets the trail.
 */
export class SaberTrail {
  constructor({
    name = 'saber-trail',
    color = 0x49e9ff,
    maxSamples = DEFAULT_MAX_SAMPLES,
    trailDuration,
    speedForMax = 7.5,
    minSampleDistance = 0.003,
    maxSampleDistance = 0.58,
    lowPower = false,
    reducedMotion = false,
  } = {}) {
    this.lowPower = Boolean(lowPower);
    this.reducedMotion = Boolean(reducedMotion);
    this.disposed = false;

    const requestedSamples = clampInteger(maxSamples, 2, HARD_SAMPLE_CAP, DEFAULT_MAX_SAMPLES);
    const profileCap = this.reducedMotion
      ? REDUCED_MOTION_SAMPLE_CAP
      : this.lowPower
        ? LOW_POWER_SAMPLE_CAP
        : HARD_SAMPLE_CAP;
    this.maxSamples = Math.min(requestedSamples, profileCap);
    this.maxSegments = this.maxSamples - 1;

    const durationCap = this.reducedMotion ? 0.06 : this.lowPower ? 0.085 : 0.11;
    const defaultDuration = this.reducedMotion ? 0.05 : this.lowPower ? 0.072 : 0.09;
    this.trailDuration = THREE.MathUtils.clamp(
      positiveNumber(trailDuration, defaultDuration),
      0.03,
      durationCap,
    );
    this.speedForMax = positiveNumber(speedForMax, 7.5);
    this.minSampleDistance = Math.max(0, finiteNumber(minSampleDistance, 0.003));
    this.maxSampleDistance = positiveNumber(maxSampleDistance, 0.62);
    this.time = 0;
    this.sampleCount = 0;
    this.visibleSegmentCount = 0;
    this.currentSpeed = 0;
    this.currentWidth = 0;
    this.currentIntensity = 0;
    this._writeIndex = 0;

    this._bases = new Float32Array(this.maxSamples * 3);
    this._tips = new Float32Array(this.maxSamples * 3);
    this._times = new Float64Array(this.maxSamples);
    this._speeds = new Float32Array(this.maxSamples);

    this.color = new THREE.Color();
    this._hotColor = new THREE.Color();
    this.group = new THREE.Group();
    this.group.name = name;
    this.group.frustumCulled = false;
    this.group.userData.saberTrail = true;
    this.group.userData.fixedCapacity = true;
    this.group.userData.worldSpace = true;

    this.glowMesh = createRibbonLayer(`${name}-glow`, this.maxSegments, {
      opacity: this.reducedMotion ? 0.035 : this.lowPower ? 0.05 : 0.065,
      renderOrder: 70,
    });
    this.coreMesh = createRibbonLayer(`${name}-core`, this.maxSegments, {
      opacity: this.reducedMotion ? 0.05 : this.lowPower ? 0.065 : 0.085,
      renderOrder: 71,
    });
    this.group.add(this.glowMesh, this.coreMesh);
    this.setColor(color);
    this.reset(0);
  }

  /** Recolours both layers in place; existing GPU resources are retained. */
  setColor(color) {
    if (this.disposed) return this;
    this.color.set(color);
    this._hotColor.copy(this.color).lerp(WHITE, 0.88);
    this.group.userData.color = this.color.getHex();
    if (this.sampleCount > 1) this._rebuildGeometry();
    return this;
  }

  /**
   * Adds one world-space blade sample without allocating. Returns false for a
   * malformed/degenerate sample or when an almost stationary duplicate is
   * intentionally skipped.
   */
  pushSample(base, tip, timeSeconds = this.time) {
    if (this.disposed || !isFiniteVector(base) || !isFiniteVector(tip)) return false;

    const bx = Number(base.x);
    const by = Number(base.y);
    const bz = Number(base.z);
    const tx = Number(tip.x);
    const ty = Number(tip.y);
    const tz = Number(tip.z);
    const bladeX = tx - bx;
    const bladeY = ty - by;
    const bladeZ = tz - bz;
    if (bladeX * bladeX + bladeY * bladeY + bladeZ * bladeZ < 1e-8) return false;

    let time = finiteNumber(timeSeconds, this.time);
    if (this.sampleCount > 0) {
      const lastIndex = (this._writeIndex - 1 + this.maxSamples) % this.maxSamples;
      const lastTime = this._times[lastIndex];
      if (time < lastTime - MIN_TIME_STEP) this.reset(time);
    }

    let speed = 0;
    if (this.sampleCount > 0) {
      const lastIndex = (this._writeIndex - 1 + this.maxSamples) % this.maxSamples;
      const lastOffset = lastIndex * 3;
      const baseDx = bx - this._bases[lastOffset];
      const baseDy = by - this._bases[lastOffset + 1];
      const baseDz = bz - this._bases[lastOffset + 2];
      const tipDx = tx - this._tips[lastOffset];
      const tipDy = ty - this._tips[lastOffset + 1];
      const tipDz = tz - this._tips[lastOffset + 2];
      const baseDistance = Math.sqrt(baseDx * baseDx + baseDy * baseDy + baseDz * baseDz);
      const tipDistance = Math.sqrt(tipDx * tipDx + tipDy * tipDy + tipDz * tipDz);
      const movement = Math.max(baseDistance, tipDistance);
      const elapsed = time - this._times[lastIndex];
      if (movement > this.maxSampleDistance) {
        // Tracking reacquisition or an AI target hand-off is not a physical
        // swing. Break the strip so one discontinuity cannot fill the screen.
        this.reset(time);
      } else {
        if (movement < this.minSampleDistance && elapsed < 1 / 30) return false;
        speed = movement / Math.max(elapsed, MIN_TIME_STEP);
        if (time <= this._times[lastIndex]) time = this._times[lastIndex] + MIN_TIME_STEP;
      }
    }

    const index = this._writeIndex;
    const offset = index * 3;
    this._bases[offset] = bx;
    this._bases[offset + 1] = by;
    this._bases[offset + 2] = bz;
    this._tips[offset] = tx;
    this._tips[offset + 1] = ty;
    this._tips[offset + 2] = tz;
    this._times[index] = time;
    this._speeds[index] = speed;

    this._writeIndex = (index + 1) % this.maxSamples;
    this.sampleCount = Math.min(this.sampleCount + 1, this.maxSamples);
    this.time = Math.max(this.time, time);
    this.currentSpeed = speed;
    return true;
  }

  /**
   * Advances/fades the trail at an absolute timestamp. Supplying base and tip
   * makes this the single-call frame API used by AI, desktop and WebXR sabers.
   */
  update(timeSeconds = this.time, base = null, tip = null) {
    if (this.disposed) return false;
    const nextTime = finiteNumber(timeSeconds, this.time);
    if (nextTime < this.time - MIN_TIME_STEP) this.reset(nextTime);
    this.time = Math.max(0, nextTime);
    if (base && tip) this.pushSample(base, tip, this.time);
    this._rebuildGeometry();
    return this.visibleSegmentCount > 0;
  }

  /** Clears history while retaining every typed array, geometry and material. */
  reset(timeSeconds = 0) {
    if (this.disposed) return this;
    this.time = Math.max(0, finiteNumber(timeSeconds, 0));
    this.sampleCount = 0;
    this.visibleSegmentCount = 0;
    this.currentSpeed = 0;
    this.currentWidth = 0;
    this.currentIntensity = 0;
    this._writeIndex = 0;
    setLayerDrawCount(this.coreMesh, 0);
    setLayerDrawCount(this.glowMesh, 0);
    this.group.userData.visibleSegments = 0;
    this.group.userData.speed = 0;
    this.group.userData.width = 0;
    this.group.userData.intensity = 0;
    return this;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.parent?.remove(this.group);
    for (const mesh of [this.glowMesh, this.coreMesh]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.removeFromParent();
    }
    this.group.clear();
    this.visibleSegmentCount = 0;
  }

  _rebuildGeometry() {
    if (this.sampleCount < 2) {
      this.visibleSegmentCount = 0;
      setLayerDrawCount(this.coreMesh, 0);
      setLayerDrawCount(this.glowMesh, 0);
      return;
    }

    const corePositions = this.coreMesh.geometry.getAttribute('position').array;
    const coreColors = this.coreMesh.geometry.getAttribute('color').array;
    const glowPositions = this.glowMesh.geometry.getAttribute('position').array;
    const glowColors = this.glowMesh.geometry.getAttribute('color').array;
    const oldest = this.sampleCount === this.maxSamples ? this._writeIndex : 0;
    const motionScale = this.reducedMotion ? 0.34 : this.lowPower ? 0.72 : 1;
    const intensityScale = this.reducedMotion ? 0.62 : this.lowPower ? 0.82 : 1;
    let visible = 0;
    let latestSpeedFactor = 0;

    for (let sequence = 1; sequence < this.sampleCount; sequence += 1) {
      const previousIndex = (oldest + sequence - 1) % this.maxSamples;
      const currentIndex = (oldest + sequence) % this.maxSamples;
      const currentAge = this.time - this._times[currentIndex];
      if (currentAge > this.trailDuration || currentAge < -MIN_TIME_STEP) continue;

      const previousAge = Math.max(0, this.time - this._times[previousIndex]);
      const previousFade = trailFade(previousAge, this.trailDuration);
      const currentFade = trailFade(Math.max(0, currentAge), this.trailDuration);
      if (previousFade <= 0 && currentFade <= 0) continue;

      const speedFactor = THREE.MathUtils.clamp(
        Math.max(this._speeds[previousIndex], this._speeds[currentIndex]) / this.speedForMax,
        0,
        1,
      );
      latestSpeedFactor = speedFactor;
      const coreWidth = (0.0014 + speedFactor * 0.0036) * motionScale;
      const glowWidth = (0.006 + speedFactor * 0.024) * motionScale;
      const coreIntensity = (0.76 + speedFactor * 0.5) * intensityScale;
      const glowIntensity = (0.72 + speedFactor * 0.7) * intensityScale;

      // Only the outer section of the blade paints a trail. Sweeping the whole
      // 1.28 m blade near the camera creates an opaque fan that hides notes and
      // the black hole; a tip-led ribbon still reads as a fast luminous slash.
      writeRibbonSegment(corePositions, visible * 12, this._bases, this._tips, previousIndex, currentIndex, coreWidth, 0.58);
      writeRibbonSegment(glowPositions, visible * 12, this._bases, this._tips, previousIndex, currentIndex, glowWidth, 0.7);
      writeQuadColors(coreColors, visible * 12, this._hotColor, coreIntensity, previousFade, currentFade, 0.28);
      writeQuadColors(glowColors, visible * 12, this.color, glowIntensity, previousFade, currentFade, 0.16);
      visible += 1;
    }

    this.visibleSegmentCount = visible;
    this.currentWidth = visible > 0 ? (0.012 + latestSpeedFactor * 0.05) * motionScale : 0;
    this.currentIntensity = visible > 0 ? (0.76 + latestSpeedFactor * 0.5) * intensityScale : 0;
    setLayerDrawCount(this.coreMesh, visible);
    setLayerDrawCount(this.glowMesh, visible);
    if (visible > 0) {
      markLayerAttributesChanged(this.coreMesh);
      markLayerAttributesChanged(this.glowMesh);
    }
    this.group.userData.visibleSegments = visible;
    this.group.userData.speed = this.currentSpeed;
    this.group.userData.width = this.currentWidth;
    this.group.userData.intensity = this.currentIntensity;
  }
}

function createRibbonLayer(name, maxSegments, { opacity, renderOrder }) {
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(maxSegments * 4 * 3), 3);
  const color = new THREE.BufferAttribute(new Float32Array(maxSegments * 4 * 3), 3);
  position.setUsage(THREE.DynamicDrawUsage);
  color.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.setAttribute('color', color);

  const IndexArray = maxSegments * 4 > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(maxSegments * 6);
  for (let segment = 0; segment < maxSegments; segment += 1) {
    const vertex = segment * 4;
    const offset = segment * 6;
    indices[offset] = vertex;
    indices[offset + 1] = vertex + 2;
    indices[offset + 2] = vertex + 1;
    indices[offset + 3] = vertex + 2;
    indices[offset + 4] = vertex + 3;
    indices[offset + 5] = vertex + 1;
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);

  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    // Keep the HDR colour eligible for bloom, but let ACES compress the direct
    // ribbon instead of clipping every fast swing to a solid white sheet.
    toneMapped: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = renderOrder;
  return mesh;
}

function writeRibbonSegment(target, targetOffset, bases, tips, previousIndex, currentIndex, expansion, bladeStartRatio) {
  const previousOffset = previousIndex * 3;
  const currentOffset = currentIndex * 3;
  const previousMidX = (bases[previousOffset] + tips[previousOffset]) * 0.5;
  const previousMidY = (bases[previousOffset + 1] + tips[previousOffset + 1]) * 0.5;
  const previousMidZ = (bases[previousOffset + 2] + tips[previousOffset + 2]) * 0.5;
  const currentMidX = (bases[currentOffset] + tips[currentOffset]) * 0.5;
  const currentMidY = (bases[currentOffset + 1] + tips[currentOffset + 1]) * 0.5;
  const currentMidZ = (bases[currentOffset + 2] + tips[currentOffset + 2]) * 0.5;
  let motionX = currentMidX - previousMidX;
  let motionY = currentMidY - previousMidY;
  let motionZ = currentMidZ - previousMidZ;
  let motionLength = Math.sqrt(motionX * motionX + motionY * motionY + motionZ * motionZ);

  if (motionLength < 1e-6) {
    motionX = tips[currentOffset] - tips[previousOffset];
    motionY = tips[currentOffset + 1] - tips[previousOffset + 1];
    motionZ = tips[currentOffset + 2] - tips[previousOffset + 2];
    motionLength = Math.sqrt(motionX * motionX + motionY * motionY + motionZ * motionZ);
  }
  if (motionLength > 1e-6) {
    motionX /= motionLength;
    motionY /= motionLength;
    motionZ /= motionLength;
  } else {
    motionX = 0;
    motionY = 0;
    motionZ = 0;
  }

  writeExpandedBlade(target, targetOffset, bases, tips, previousOffset, -expansion, motionX, motionY, motionZ, expansion * 0.22, bladeStartRatio);
  writeExpandedBlade(target, targetOffset + 6, bases, tips, currentOffset, expansion, motionX, motionY, motionZ, expansion * 0.22, bladeStartRatio);
}

function writeExpandedBlade(target, targetOffset, bases, tips, sourceOffset, motionAmount, motionX, motionY, motionZ, bladeExtension, bladeStartRatio) {
  const startRatio = THREE.MathUtils.clamp(bladeStartRatio, 0, 0.92);
  const baseX = THREE.MathUtils.lerp(bases[sourceOffset], tips[sourceOffset], startRatio);
  const baseY = THREE.MathUtils.lerp(bases[sourceOffset + 1], tips[sourceOffset + 1], startRatio);
  const baseZ = THREE.MathUtils.lerp(bases[sourceOffset + 2], tips[sourceOffset + 2], startRatio);
  let bladeX = tips[sourceOffset] - baseX;
  let bladeY = tips[sourceOffset + 1] - baseY;
  let bladeZ = tips[sourceOffset + 2] - baseZ;
  const bladeLength = Math.sqrt(bladeX * bladeX + bladeY * bladeY + bladeZ * bladeZ) || 1;
  bladeX /= bladeLength;
  bladeY /= bladeLength;
  bladeZ /= bladeLength;

  target[targetOffset] = baseX + motionX * motionAmount - bladeX * bladeExtension;
  target[targetOffset + 1] = baseY + motionY * motionAmount - bladeY * bladeExtension;
  target[targetOffset + 2] = baseZ + motionZ * motionAmount - bladeZ * bladeExtension;
  target[targetOffset + 3] = tips[sourceOffset] + motionX * motionAmount + bladeX * bladeExtension;
  target[targetOffset + 4] = tips[sourceOffset + 1] + motionY * motionAmount + bladeY * bladeExtension;
  target[targetOffset + 5] = tips[sourceOffset + 2] + motionZ * motionAmount + bladeZ * bladeExtension;
}

function writeQuadColors(target, offset, color, intensity, previousFade, currentFade, baseFalloff) {
  writeVertexColor(target, offset, color, intensity * previousFade * baseFalloff);
  writeVertexColor(target, offset + 3, color, intensity * previousFade);
  writeVertexColor(target, offset + 6, color, intensity * currentFade * baseFalloff);
  writeVertexColor(target, offset + 9, color, intensity * currentFade);
}

function writeVertexColor(target, offset, color, intensity) {
  target[offset] = color.r * intensity;
  target[offset + 1] = color.g * intensity;
  target[offset + 2] = color.b * intensity;
}

function trailFade(age, duration) {
  const normalized = THREE.MathUtils.clamp(1 - age / duration, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function setLayerDrawCount(mesh, segments) {
  mesh.geometry.setDrawRange(0, segments * 6);
  mesh.visible = segments > 0;
}

function markLayerAttributesChanged(mesh) {
  mesh.geometry.getAttribute('position').needsUpdate = true;
  mesh.geometry.getAttribute('color').needsUpdate = true;
}

function isFiniteVector(value) {
  return value
    && Number.isFinite(Number(value.x))
    && Number.isFinite(Number(value.y))
    && Number.isFinite(Number(value.z));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value, fallback) {
  const number = finiteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function clampInteger(value, min, max, fallback) {
  const number = Math.floor(finiteNumber(value, fallback));
  return THREE.MathUtils.clamp(number, min, max);
}
