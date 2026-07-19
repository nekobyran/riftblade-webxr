import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MobileSaberTrail } from './MobileSaberTrail.js';

const point = (x = 0, y = 0, z = -0.74) => new THREE.Vector3(x, y, z);

function maxValue(array, length = array.length) {
  let maximum = -Infinity;
  for (let index = 0; index < length; index += 1) maximum = Math.max(maximum, array[index]);
  return maximum;
}

describe('MobileSaberTrail fixed XY ribbon', () => {
  it('creates a white-hot core and broad additive aura using fixed dynamic GPU buffers', () => {
    const trail = new MobileSaberTrail({ name: 'touch-left', color: 0x29aaff, maxPoints: 20 });
    const core = trail.group.getObjectByName('touch-left-core');
    const aura = trail.group.getObjectByName('touch-left-aura');

    expect(trail.group.userData).toMatchObject({
      mobileSaberTrail: true,
      fixedCapacity: true,
      worldSpace: true,
      interactionPlane: 'xy',
      maxPoints: 20,
    });
    expect(core).toBe(trail.coreMesh);
    expect(aura).toBe(trail.auraMesh);
    expect(core.material).toMatchObject({
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      vertexColors: true,
    });
    expect(aura.material.blending).toBe(THREE.AdditiveBlending);
    expect(core.material.opacity).toBeGreaterThanOrEqual(0.9);
    expect(aura.material.opacity).toBeGreaterThanOrEqual(0.65);
    expect(core.geometry.getAttribute('position').usage).toBe(THREE.DynamicDrawUsage);
    expect(core.geometry.getAttribute('position').count).toBe((20 - 1) * 4);
    expect(core.geometry.index.count).toBe((20 - 1) * 6);
    expect(core.geometry.drawRange.count).toBe(0);
    trail.dispose();
  });

  it('keeps a slow mobile swipe broad, bright and visible in the interaction plane', () => {
    const trail = new MobileSaberTrail({ color: 0xff2244, speedForMax: 6 });
    expect(trail.begin(point(0, 0), 1)).toBe(true);
    expect(trail.pushPoint(point(0.035, 0.08), 1.12)).toBe(true);
    expect(trail.update(1.12)).toBe(true);

    expect(trail.active).toBe(true);
    expect(trail.visibleSegmentCount).toBe(1);
    expect(trail.currentWidth).toBeGreaterThan(0.1);
    expect(trail.currentIntensity).toBeGreaterThan(2.5);
    expect(trail.coreMesh.geometry.drawRange.count).toBe(6);
    expect(trail.auraMesh.geometry.drawRange.count).toBe(6);
    const corePositions = trail.coreMesh.geometry.getAttribute('position').array;
    const auraPositions = trail.auraMesh.geometry.getAttribute('position').array;
    const coreStartSpan = Math.hypot(corePositions[0] - corePositions[3], corePositions[1] - corePositions[4]);
    const auraStartSpan = Math.hypot(auraPositions[0] - auraPositions[3], auraPositions[1] - auraPositions[4]);
    expect(auraStartSpan).toBeGreaterThan(coreStartSpan * 3);
    expect(corePositions[2]).toBeCloseTo(-0.74);
    expect(auraPositions[2]).toBeCloseTo(-0.74);
    trail.dispose();
  });

  it('uses a near-white HDR core, preserves the aura hue and recolours in place', () => {
    const trail = new MobileSaberTrail({ color: 0xff0000 });
    trail.begin(point(), 0);
    trail.pushPoint(point(0.18, 0.1), 0.03);
    trail.update(0.03);
    const coreArray = trail.coreMesh.geometry.getAttribute('color').array;
    const auraArray = trail.auraMesh.geometry.getAttribute('color').array;

    expect(maxValue(coreArray, 12)).toBeGreaterThan(2);
    expect(coreArray[1]).toBeGreaterThan(1);
    expect(coreArray[2]).toBeGreaterThan(1);
    expect(coreArray[0] / coreArray[1]).toBeLessThan(1.3);
    expect(auraArray[0]).toBeGreaterThan(auraArray[1] * 20);
    expect(maxValue(auraArray, 12)).toBeGreaterThan(1);

    const auraGeometry = trail.auraMesh.geometry;
    const auraColors = auraGeometry.getAttribute('color').array;
    trail.setColor(0x00ff77);
    expect(trail.auraMesh.geometry).toBe(auraGeometry);
    expect(trail.auraMesh.geometry.getAttribute('color').array).toBe(auraColors);
    expect(auraColors[1]).toBeGreaterThan(auraColors[0] * 20);
    expect(trail.group.userData.color).toBe(0x00ff77);
    trail.dispose();
  });
});

describe('MobileSaberTrail bounded gesture lifecycle', () => {
  it('caps low-power history while leaving its aura conspicuously visible', () => {
    const full = new MobileSaberTrail({ maxPoints: 64 });
    const lowPower = new MobileSaberTrail({ maxPoints: 64, lowPower: true });
    const reduced = new MobileSaberTrail({ maxPoints: 64, reducedMotion: true });

    expect(full.maxPoints).toBe(64);
    expect(lowPower.maxPoints).toBe(22);
    expect(reduced.maxPoints).toBe(14);
    expect(lowPower.trailDuration).toBeGreaterThanOrEqual(0.16);
    expect(lowPower.auraMesh.material.opacity).toBeGreaterThanOrEqual(0.65);
    lowPower.begin(point(), 0);
    lowPower.pushPoint(point(0.08, 0.04), 0.08);
    lowPower.update(0.08);
    expect(lowPower.visibleSegmentCount).toBe(1);
    expect(lowPower.currentWidth).toBeGreaterThan(0.09);
    expect(lowPower.currentIntensity).toBeGreaterThan(2);
    expect(maxValue(lowPower.auraMesh.geometry.getAttribute('color').array, 12)).toBeGreaterThan(1);
    full.dispose();
    lowPower.dispose();
    reduced.dispose();
  });

  it('ends with a quick in-place fade and exposes a stable complete flag', () => {
    const trail = new MobileSaberTrail({ endFadeDuration: 0.14 });
    trail.begin(point(), 2);
    trail.pushPoint(point(0.25, 0.12), 2.04);
    trail.update(2.04);
    const peak = maxValue(trail.coreMesh.geometry.getAttribute('color').array, 12);

    expect(trail.end(2.04)).toBe(true);
    expect(trail).toMatchObject({ active: false, ending: true, complete: false });
    expect(trail.update(2.1)).toBe(true);
    const fading = maxValue(trail.coreMesh.geometry.getAttribute('color').array, 12);
    expect(fading).toBeGreaterThan(0);
    expect(fading).toBeLessThan(peak);

    expect(trail.update(2.2)).toBe(false);
    expect(trail).toMatchObject({ active: false, ending: false, complete: true, visibleSegmentCount: 0 });
    expect(trail.group.visible).toBe(false);
    expect(trail.coreMesh.geometry.drawRange.count).toBe(0);
    expect(trail.group.userData.complete).toBe(true);
    // Retained samples must not make the finished slash flash back on screen.
    expect(trail.update(2.21)).toBe(false);
    expect(trail.group.visible).toBe(false);
    expect(trail.coreMesh.geometry.drawRange.count).toBe(0);
    trail.dispose();
  });

  it('reuses exact typed arrays and geometries while circular history wraps', () => {
    const trail = new MobileSaberTrail({ maxPoints: 8, minPointDistance: 0 });
    const points = trail._points;
    const times = trail._times;
    const coreGeometry = trail.coreMesh.geometry;
    const corePositions = coreGeometry.getAttribute('position').array;
    const auraColors = trail.auraMesh.geometry.getAttribute('color').array;
    trail.begin(point(), 0);

    for (let index = 1; index <= 100; index += 1) {
      trail.pushPoint(point(index * 0.01, (index % 5) * 0.006), index / 120);
      trail.update(index / 120);
    }

    expect(trail.sampleCount).toBe(8);
    expect(trail.visibleSegmentCount).toBeLessThanOrEqual(7);
    expect(trail._points).toBe(points);
    expect(trail._times).toBe(times);
    expect(trail.coreMesh.geometry).toBe(coreGeometry);
    expect(trail.coreMesh.geometry.getAttribute('position').array).toBe(corePositions);
    expect(trail.auraMesh.geometry.getAttribute('color').array).toBe(auraColors);
    expect(coreGeometry.drawRange.count).toBeLessThanOrEqual(7 * 6);
    trail.dispose();
  });

  it('refreshes stationary input without allocating segments and breaks pointer teleports', () => {
    const trail = new MobileSaberTrail({ maxPointDistance: 0.5 });
    trail.begin(point(), 0);
    expect(trail.pushPoint(point(0.1, 0), 0.04)).toBe(true);
    const count = trail.sampleCount;
    expect(trail.pushPoint(point(0.1, 0), 0.1)).toBe(false);
    expect(trail.sampleCount).toBe(count);
    expect(trail._times[trail._writeIndex - 1]).toBeCloseTo(0.1);

    expect(trail.pushPoint(point(2, 0), 0.12)).toBe(true);
    expect(trail.sampleCount).toBe(1);
    expect(trail.visibleSegmentCount).toBe(0);
    trail.pushPoint(point(2.15, 0.04), 0.16);
    trail.update(0.16);
    expect(trail.visibleSegmentCount).toBe(1);
    trail.dispose();
  });

  it('resets without replacing resources and disposes both layers exactly once', () => {
    const trail = new MobileSaberTrail();
    const geometry = trail.coreMesh.geometry;
    const positions = geometry.getAttribute('position').array;
    trail.begin(point(), 1);
    trail.pushPoint(point(0.2, 0.1), 1.03);
    trail.update(1.03);
    trail.reset(0);

    expect(trail.coreMesh.geometry).toBe(geometry);
    expect(trail.coreMesh.geometry.getAttribute('position').array).toBe(positions);
    expect(trail).toMatchObject({ sampleCount: 0, complete: true, active: false, visibleSegmentCount: 0 });
    expect(trail.begin(null, 0)).toBe(false);
    expect(trail.pushPoint({ x: NaN, y: 0 }, 0)).toBe(false);

    const coreGeometryDispose = vi.spyOn(trail.coreMesh.geometry, 'dispose');
    const coreMaterialDispose = vi.spyOn(trail.coreMesh.material, 'dispose');
    const auraGeometryDispose = vi.spyOn(trail.auraMesh.geometry, 'dispose');
    trail.dispose();
    trail.dispose();

    expect(coreGeometryDispose).toHaveBeenCalledTimes(1);
    expect(coreMaterialDispose).toHaveBeenCalledTimes(1);
    expect(auraGeometryDispose).toHaveBeenCalledTimes(1);
    expect(trail.group.children).toHaveLength(0);
    expect(trail.update(2)).toBe(false);
    expect(trail.begin(point(), 2)).toBe(false);
  });
});
