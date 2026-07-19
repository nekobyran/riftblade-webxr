import * as THREE from 'three';

const DEFAULT_MAX_POINTS = 32;
const LOW_POWER_POINT_CAP = 22;
const REDUCED_MOTION_POINT_CAP = 14;
const HARD_POINT_CAP = 96;
const MIN_TIME_STEP = 1 / 240;
const WHITE = new THREE.Color(0xffffff);

/**
 * Fixed-capacity touch-saber ribbon for the mobile XY interaction plane.
 *
 * Pointer coordinates should be projected to world space before they reach
 * this class. The path is then widened in the XY plane, producing a bright
 * camera-facing ribbon without allocating geometry during pointer movement.
 * Both layers use HDR vertex colours and additive blending: a narrow white-hot
 * core stays readable over notes while a broader theme-coloured aura drives
 * bloom. All timestamps are absolute seconds.
 *
 * Typical lifecycle:
 *   trail.begin(worldPoint, time);
 *   trail.pushPoint(worldPoint, time); // on every pointer move
 *   trail.update(time);                // once per render frame
 *   trail.end(time);                   // pointer up/cancel, then keep updating
 *   if (trail.complete) trail.reset(time);
 */
export class MobileSaberTrail {
  constructor({
    name = 'mobile-saber-trail',
    color = 0x49e9ff,
    maxPoints = DEFAULT_MAX_POINTS,
    trailDuration,
    endFadeDuration,
    minPointDistance = 0.0015,
    maxPointDistance = 1.85,
    speedForMax = 5.5,
    lowPower = false,
    reducedMotion = false,
    planeZ = 0,
  } = {}) {
    this.lowPower = Boolean(lowPower);
    this.reducedMotion = Boolean(reducedMotion);
    this.disposed = false;

    const requestedPoints = clampInteger(maxPoints, 2, HARD_POINT_CAP, DEFAULT_MAX_POINTS);
    const profileCap = this.reducedMotion
      ? REDUCED_MOTION_POINT_CAP
      : this.lowPower
        ? LOW_POWER_POINT_CAP
        : HARD_POINT_CAP;
    this.maxPoints = Math.min(requestedPoints, profileCap);
    this.maxSegments = this.maxPoints - 1;

    const defaultTrailDuration = this.reducedMotion ? 0.13 : this.lowPower ? 0.2 : 0.28;
    const minimumTrailDuration = this.reducedMotion ? 0.1 : this.lowPower ? 0.16 : 0.22;
    const maximumTrailDuration = this.reducedMotion ? 0.17 : this.lowPower ? 0.24 : 0.34;
    this.trailDuration = THREE.MathUtils.clamp(
      positiveNumber(trailDuration, defaultTrailDuration),
      minimumTrailDuration,
      maximumTrailDuration,
    );
    const defaultEndFade = this.reducedMotion ? 0.075 : this.lowPower ? 0.11 : 0.145;
    this.endFadeDuration = THREE.MathUtils.clamp(
      positiveNumber(endFadeDuration, defaultEndFade),
      this.reducedMotion ? 0.05 : 0.075,
      this.reducedMotion ? 0.1 : 0.18,
    );
    this.minPointDistance = Math.max(0, finiteNumber(minPointDistance, 0.0015));
    this.maxPointDistance = positiveNumber(maxPointDistance, 1.85);
    this.speedForMax = positiveNumber(speedForMax, 5.5);
    this.planeZ = finiteNumber(planeZ, 0);

    this.time = 0;
    this.endedAt = 0;
    this.active = false;
    this.ending = false;
    this.complete = true;
    this.sampleCount = 0;
    this.visibleSegmentCount = 0;
    this.currentSpeed = 0;
    this.currentWidth = 0;
    this.currentIntensity = 0;
    this._writeIndex = 0;

    // The buffers are allocated exactly once and used as a circular history.
    this._points = new Float32Array(this.maxPoints * 3);
    this._times = new Float64Array(this.maxPoints);
    this._speeds = new Float32Array(this.maxPoints);

    this.color = new THREE.Color();
    this._coreColor = new THREE.Color();
    this.group = new THREE.Group();
    this.group.name = name;
    this.group.frustumCulled = false;
    this.group.userData.mobileSaberTrail = true;
    this.group.userData.fixedCapacity = true;
    this.group.userData.worldSpace = true;
    this.group.userData.interactionPlane = 'xy';
    this.group.userData.maxPoints = this.maxPoints;
    this.group.userData.trailDuration = this.trailDuration;
    this.group.userData.endFadeDuration = this.endFadeDuration;
    this.group.userData.lowPower = this.lowPower;
    this.group.userData.reducedMotion = this.reducedMotion;

    this.auraMesh = createRibbonLayer(`${name}-aura`, this.maxSegments, {
      opacity: this.reducedMotion ? 0.5 : this.lowPower ? 0.66 : 0.78,
      renderOrder: 92,
    });
    this.coreMesh = createRibbonLayer(`${name}-core`, this.maxSegments, {
      opacity: this.reducedMotion ? 0.78 : this.lowPower ? 0.9 : 0.98,
      renderOrder: 93,
    });
    this.group.add(this.auraMesh, this.coreMesh);
    this.setColor(color);
    this.reset(0);
  }

  /** Starts a new gesture while retaining all GPU and typed-array resources. */
  begin(point, timeSeconds = this.time) {
    if (this.disposed || !isFinitePoint(point)) return false;
    const time = Math.max(0, finiteNumber(timeSeconds, this.time));
    this.reset(time);
    this.active = true;
    this.ending = false;
    this.complete = false;
    this.group.visible = true;
    this._syncState();
    return this._appendPoint(point, time);
  }

  /**
   * Adds a projected world-space touch point. Tiny stationary events refresh
   * the latest sample instead of growing history, so a deliberate slow swipe
   * remains luminous without producing degenerate quads.
   */
  pushPoint(point, timeSeconds = this.time) {
    if (this.disposed || !isFinitePoint(point)) return false;
    let time = Math.max(0, finiteNumber(timeSeconds, this.time));
    if (!this.active) return this.begin(point, time);
    if (time < this.time - MIN_TIME_STEP) return this.begin(point, time);

    if (this.sampleCount > 0) {
      const lastIndex = (this._writeIndex - 1 + this.maxPoints) % this.maxPoints;
      const lastOffset = lastIndex * 3;
      const x = Number(point.x);
      const y = Number(point.y);
      const z = finiteNumber(point.z, this.planeZ);
      const dx = x - this._points[lastOffset];
      const dy = y - this._points[lastOffset + 1];
      const dz = z - this._points[lastOffset + 2];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (distance > this.maxPointDistance) {
        // A pointer capture jump must not draw a screen-filling streak.
        this.reset(time);
        this.active = true;
        this.complete = false;
        this.group.visible = true;
        this._syncState();
        return this._appendPoint(point, time);
      }

      if (distance < this.minPointDistance) {
        // Keep the living end of an existing slow trail fresh. No new segment
        // is created and the fixed history therefore cannot grow while idle.
        if (time > this._times[lastIndex]) this._times[lastIndex] = time;
        this.time = Math.max(this.time, time);
        return false;
      }
    }

    return this._appendPoint(point, time);
  }

  /** Marks a gesture complete. Its already-built path fades rapidly in place. */
  end(timeSeconds = this.time) {
    if (this.disposed) return false;
    const time = Math.max(this.time, finiteNumber(timeSeconds, this.time));
    this.time = time;
    this.active = false;
    this.ending = this.sampleCount > 0;
    this.complete = this.sampleCount === 0;
    this.endedAt = time;
    this._rebuildGeometry();
    this._syncState();
    return this.ending;
  }

  /**
   * Advances age/fade at an absolute timestamp. Supplying `point` combines a
   * pointer-move sample and the per-frame rebuild in one call.
   */
  update(timeSeconds = this.time, point = null) {
    if (this.disposed) return false;
    const nextTime = Math.max(0, finiteNumber(timeSeconds, this.time));
    if (nextTime < this.time - MIN_TIME_STEP) {
      if (point) this.begin(point, nextTime);
      else this.reset(nextTime);
    } else {
      this.time = nextTime;
      if (point) this.pushPoint(point, nextTime);
    }
    this._rebuildGeometry();
    this._syncState();
    return this.visibleSegmentCount > 0;
  }

  /** Recolours both HDR layers without replacing their materials or buffers. */
  setColor(color) {
    if (this.disposed) return this;
    this.color.set(color);
    this._coreColor.copy(this.color).lerp(WHITE, 0.9);
    this.group.userData.color = this.color.getHex();
    if (this.sampleCount > 1) this._rebuildGeometry();
    return this;
  }

  /** Clears history but retains every GPU resource and typed array. */
  reset(timeSeconds = 0) {
    if (this.disposed) return this;
    this.time = Math.max(0, finiteNumber(timeSeconds, 0));
    this.endedAt = this.time;
    this.active = false;
    this.ending = false;
    this.complete = true;
    this.sampleCount = 0;
    this.visibleSegmentCount = 0;
    this.currentSpeed = 0;
    this.currentWidth = 0;
    this.currentIntensity = 0;
    this._writeIndex = 0;
    setLayerDrawCount(this.coreMesh, 0);
    setLayerDrawCount(this.auraMesh, 0);
    this.group.visible = false;
    this._syncState();
    return this;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.ending = false;
    this.complete = true;
    this.group.parent?.remove(this.group);
    for (const mesh of [this.auraMesh, this.coreMesh]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.removeFromParent();
    }
    this.group.clear();
    this.group.visible = false;
    this.visibleSegmentCount = 0;
  }

  _appendPoint(point, timeSeconds) {
    let time = Math.max(0, finiteNumber(timeSeconds, this.time));
    let speed = 0;
    if (this.sampleCount > 0) {
      const lastIndex = (this._writeIndex - 1 + this.maxPoints) % this.maxPoints;
      const lastOffset = lastIndex * 3;
      const x = Number(point.x);
      const y = Number(point.y);
      const z = finiteNumber(point.z, this.planeZ);
      const dx = x - this._points[lastOffset];
      const dy = y - this._points[lastOffset + 1];
      const dz = z - this._points[lastOffset + 2];
      const elapsed = time - this._times[lastIndex];
      speed = Math.sqrt(dx * dx + dy * dy + dz * dz) / Math.max(elapsed, MIN_TIME_STEP);
      if (time <= this._times[lastIndex]) time = this._times[lastIndex] + MIN_TIME_STEP;
    }

    const index = this._writeIndex;
    const offset = index * 3;
    this._points[offset] = Number(point.x);
    this._points[offset + 1] = Number(point.y);
    this._points[offset + 2] = finiteNumber(point.z, this.planeZ);
    this._times[index] = time;
    this._speeds[index] = speed;
    this._writeIndex = (index + 1) % this.maxPoints;
    this.sampleCount = Math.min(this.sampleCount + 1, this.maxPoints);
    this.time = Math.max(this.time, time);
    this.currentSpeed = speed;
    this.complete = false;
    return true;
  }

  _rebuildGeometry() {
    // A completed gesture retains its circular history for inspection/reuse,
    // but must never reappear on a later frame after the end fade reached 0.
    if (this.complete && !this.active && !this.ending) {
      setLayerDrawCount(this.coreMesh, 0);
      setLayerDrawCount(this.auraMesh, 0);
      this.group.visible = false;
      return;
    }
    if (this.sampleCount < 2) {
      this.visibleSegmentCount = 0;
      setLayerDrawCount(this.coreMesh, 0);
      setLayerDrawCount(this.auraMesh, 0);
      if (this.ending && this.time - this.endedAt >= this.endFadeDuration) this._markComplete();
      return;
    }

    const endFade = this.ending
      ? smoothFade(this.time - this.endedAt, this.endFadeDuration)
      : 1;
    if (this.ending && endFade <= 0) {
      this._markComplete();
      return;
    }

    const corePositions = this.coreMesh.geometry.getAttribute('position').array;
    const coreColors = this.coreMesh.geometry.getAttribute('color').array;
    const auraPositions = this.auraMesh.geometry.getAttribute('position').array;
    const auraColors = this.auraMesh.geometry.getAttribute('color').array;
    const oldest = this.sampleCount === this.maxPoints ? this._writeIndex : 0;
    const widthScale = this.reducedMotion ? 0.72 : this.lowPower ? 0.9 : 1;
    const intensityScale = this.reducedMotion ? 0.76 : this.lowPower ? 0.9 : 1;
    let visible = 0;
    let latestSpeedFactor = 0;

    for (let sequence = 1; sequence < this.sampleCount; sequence += 1) {
      const previousIndex = (oldest + sequence - 1) % this.maxPoints;
      const currentIndex = (oldest + sequence) % this.maxPoints;
      const currentAge = Math.max(0, this.time - this._times[currentIndex]);
      if (currentAge > this.trailDuration) continue;

      const previousAge = Math.max(0, this.time - this._times[previousIndex]);
      const previousFade = trailFade(previousAge, this.trailDuration) * endFade;
      const currentFade = trailFade(currentAge, this.trailDuration) * endFade;
      if (previousFade <= 0 && currentFade <= 0) continue;

      const speedFactor = THREE.MathUtils.clamp(
        Math.max(this._speeds[previousIndex], this._speeds[currentIndex]) / this.speedForMax,
        0,
        1,
      );
      latestSpeedFactor = speedFactor;
      // The minimums are intentionally strong: mobile has neither a physical
      // controller nor a persistent 3D blade, so even slow movement must read
      // unmistakably as a luminous saber cut.
      const coreHalfWidth = (0.012 + speedFactor * 0.017) * widthScale;
      const auraHalfWidth = (0.052 + speedFactor * 0.073) * widthScale;
      const coreIntensity = (2.85 + speedFactor * 3.65) * intensityScale;
      const auraIntensity = (1.9 + speedFactor * 3.1) * intensityScale;

      writeXYRibbonSegment(
        corePositions,
        visible * 12,
        this._points,
        previousIndex,
        currentIndex,
        coreHalfWidth,
      );
      writeXYRibbonSegment(
        auraPositions,
        visible * 12,
        this._points,
        previousIndex,
        currentIndex,
        auraHalfWidth,
      );
      writeQuadColors(coreColors, visible * 12, this._coreColor, coreIntensity, previousFade, currentFade);
      writeQuadColors(auraColors, visible * 12, this.color, auraIntensity, previousFade, currentFade);
      visible += 1;
    }

    this.visibleSegmentCount = visible;
    this.currentWidth = visible > 0 ? (0.104 + latestSpeedFactor * 0.146) * widthScale : 0;
    this.currentIntensity = visible > 0 ? (2.85 + latestSpeedFactor * 3.65) * intensityScale * endFade : 0;
    setLayerDrawCount(this.coreMesh, visible);
    setLayerDrawCount(this.auraMesh, visible);
    if (visible > 0) {
      markLayerAttributesChanged(this.coreMesh);
      markLayerAttributesChanged(this.auraMesh);
      this.group.visible = true;
    } else if (!this.active) {
      this._markComplete();
    }
  }

  _markComplete() {
    this.active = false;
    this.ending = false;
    this.complete = true;
    this.visibleSegmentCount = 0;
    this.currentWidth = 0;
    this.currentIntensity = 0;
    setLayerDrawCount(this.coreMesh, 0);
    setLayerDrawCount(this.auraMesh, 0);
    this.group.visible = false;
  }

  _syncState() {
    this.group.userData.active = this.active;
    this.group.userData.ending = this.ending;
    this.group.userData.complete = this.complete;
    this.group.userData.visibleSegments = this.visibleSegmentCount;
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
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = renderOrder;
  return mesh;
}

function writeXYRibbonSegment(target, targetOffset, points, previousIndex, currentIndex, halfWidth) {
  const previousOffset = previousIndex * 3;
  const currentOffset = currentIndex * 3;
  const dx = points[currentOffset] - points[previousOffset];
  const dy = points[currentOffset + 1] - points[previousOffset + 1];
  const length = Math.sqrt(dx * dx + dy * dy);
  // Input is an XY interaction path; a near-zero XY delta can only happen
  // during a tracking discontinuity, for which a stable fallback is safest.
  const perpendicularX = length > 1e-7 ? -dy / length : 1;
  const perpendicularY = length > 1e-7 ? dx / length : 0;
  const offsetX = perpendicularX * halfWidth;
  const offsetY = perpendicularY * halfWidth;

  target[targetOffset] = points[previousOffset] + offsetX;
  target[targetOffset + 1] = points[previousOffset + 1] + offsetY;
  target[targetOffset + 2] = points[previousOffset + 2];
  target[targetOffset + 3] = points[previousOffset] - offsetX;
  target[targetOffset + 4] = points[previousOffset + 1] - offsetY;
  target[targetOffset + 5] = points[previousOffset + 2];
  target[targetOffset + 6] = points[currentOffset] + offsetX;
  target[targetOffset + 7] = points[currentOffset + 1] + offsetY;
  target[targetOffset + 8] = points[currentOffset + 2];
  target[targetOffset + 9] = points[currentOffset] - offsetX;
  target[targetOffset + 10] = points[currentOffset + 1] - offsetY;
  target[targetOffset + 11] = points[currentOffset + 2];
}

function writeQuadColors(target, offset, color, intensity, previousFade, currentFade) {
  writeVertexColor(target, offset, color, intensity * previousFade);
  writeVertexColor(target, offset + 3, color, intensity * previousFade);
  writeVertexColor(target, offset + 6, color, intensity * currentFade);
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

function smoothFade(age, duration) {
  return trailFade(Math.max(0, age), duration);
}

function setLayerDrawCount(mesh, segments) {
  mesh.geometry.setDrawRange(0, segments * 6);
  mesh.visible = segments > 0;
}

function markLayerAttributesChanged(mesh) {
  mesh.geometry.getAttribute('position').needsUpdate = true;
  mesh.geometry.getAttribute('color').needsUpdate = true;
}

function isFinitePoint(value) {
  return value
    && Number.isFinite(Number(value.x))
    && Number.isFinite(Number(value.y))
    && (value.z === undefined || Number.isFinite(Number(value.z)));
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
