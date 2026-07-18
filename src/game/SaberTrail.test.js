import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SaberTrail } from './SaberTrail.js';

const base = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const tip = (x = 0, y = 1.25, z = 0) => new THREE.Vector3(x, y, z);

function maxValue(array, length = array.length) {
  let result = -Infinity;
  for (let index = 0; index < length; index += 1) result = Math.max(result, array[index]);
  return result;
}

describe('SaberTrail fixed GPU ribbon', () => {
  it('builds a named white-hot core and wider additive HDR glow with fixed dynamic buffers', () => {
    const trail = new SaberTrail({ name: 'left-saber-trail', color: 0x23aaff, maxSamples: 20 });
    const core = trail.group.getObjectByName('left-saber-trail-core');
    const glow = trail.group.getObjectByName('left-saber-trail-glow');

    expect(trail.group.userData).toMatchObject({ saberTrail: true, fixedCapacity: true, worldSpace: true });
    expect(core).toBe(trail.coreMesh);
    expect(glow).toBe(trail.glowMesh);
    expect(core.material).toMatchObject({
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: true,
      vertexColors: true,
    });
    expect(glow.material.blending).toBe(THREE.AdditiveBlending);
    expect(glow.material.opacity).toBeLessThan(core.material.opacity);
    expect(core.geometry.getAttribute('position').usage).toBe(THREE.DynamicDrawUsage);
    expect(core.geometry.getAttribute('color').usage).toBe(THREE.DynamicDrawUsage);
    expect(core.geometry.getAttribute('position').count).toBe((20 - 1) * 4);
    expect(core.geometry.index.count).toBe((20 - 1) * 6);
    expect(core.geometry.drawRange.count).toBe(0);
    expect(core.visible).toBe(false);
    trail.dispose();
  });

  it('turns consecutive hilt/tip world slices into a broad two-triangle ribbon', () => {
    const trail = new SaberTrail({ color: 0x00baff, speedForMax: 5 });
    trail.pushSample(base(0, 0, 0), tip(0, 1.2, 0), 1);
    trail.pushSample(base(0.35, 0.05, 0), tip(0.52, 1.2, 0.08), 1.04);

    expect(trail.update(1.04)).toBe(true);
    expect(trail.visibleSegmentCount).toBe(1);
    expect(trail.coreMesh.geometry.drawRange.count).toBe(6);
    expect(trail.glowMesh.geometry.drawRange.count).toBe(6);
    expect(trail.coreMesh.visible).toBe(true);

    const core = trail.coreMesh.geometry.getAttribute('position').array;
    const glow = trail.glowMesh.geometry.getAttribute('position').array;
    const coreSpan = Math.max(core[0], core[3], core[6], core[9]) - Math.min(core[0], core[3], core[6], core[9]);
    const glowSpan = Math.max(glow[0], glow[3], glow[6], glow[9]) - Math.min(glow[0], glow[3], glow[6], glow[9]);
    expect(coreSpan).toBeGreaterThan(0.35);
    expect(glowSpan).toBeGreaterThan(coreSpan);
    // The ribbon is tip-led rather than a full-blade white fan near the camera.
    expect(Math.min(core[1], core[4], core[7], core[10])).toBeGreaterThan(0.5);
    expect(Math.min(glow[1], glow[4], glow[7], glow[10])).toBeGreaterThan(0.7);
    const glowColors = trail.glowMesh.geometry.getAttribute('color').array;
    expect(Math.max(glowColors[0], glowColors[1], glowColors[2]))
      .toBeLessThan(Math.max(glowColors[3], glowColors[4], glowColors[5]) * 0.25);
    trail.dispose();
  });

  it('makes fast swings wider and brighter than slow swings', () => {
    const slow = new SaberTrail({ color: 0xff2255, speedForMax: 8 });
    slow.update(0, base(), tip());
    slow.update(0.2, base(0.12), tip(0.12));

    const fast = new SaberTrail({ color: 0xff2255, speedForMax: 8 });
    fast.update(0, base(), tip());
    fast.update(0.015, base(0.12), tip(0.12));

    expect(fast.currentSpeed).toBeGreaterThan(slow.currentSpeed * 5);
    expect(fast.currentWidth).toBeGreaterThan(slow.currentWidth);
    expect(fast.currentIntensity).toBeGreaterThan(slow.currentIntensity);
    const slowColors = slow.glowMesh.geometry.getAttribute('color').array;
    const fastColors = fast.glowMesh.geometry.getAttribute('color').array;
    expect(maxValue(fastColors, 12)).toBeGreaterThan(maxValue(slowColors, 12));
    expect(maxValue(fastColors, 12)).toBeGreaterThan(1);
    slow.dispose();
    fast.dispose();
  });

  it('uses a near-white core while retaining the selected hue in the outer glow', () => {
    const trail = new SaberTrail({ color: 0xff0000 });
    trail.update(0, base(), tip());
    trail.update(0.02, base(0.2), tip(0.2));
    const core = trail.coreMesh.geometry.getAttribute('color').array;
    const glow = trail.glowMesh.geometry.getAttribute('color').array;

    expect(core[1]).toBeGreaterThan(0);
    expect(core[2]).toBeGreaterThan(0);
    expect(core[0] / Math.max(core[1], 1e-6)).toBeLessThan(2);
    expect(glow[0]).toBeGreaterThan(glow[1] * 10);
    expect(glow[0]).toBeGreaterThan(glow[2] * 10);

    trail.setColor(0x00ff66).update(0.02);
    const recoloured = trail.glowMesh.geometry.getAttribute('color').array;
    expect(recoloured[1]).toBeGreaterThan(recoloured[0] * 10);
    expect(trail.group.userData.color).toBe(0x00ff66);
    trail.dispose();
  });
});

describe('SaberTrail bounded lifecycle', () => {
  it('reuses the exact geometries and arrays while wrapping at its sample capacity', () => {
    const trail = new SaberTrail({ maxSamples: 8 });
    const coreGeometry = trail.coreMesh.geometry;
    const glowGeometry = trail.glowMesh.geometry;
    const corePositions = coreGeometry.getAttribute('position').array;
    const glowColors = glowGeometry.getAttribute('color').array;

    for (let index = 0; index < 100; index += 1) {
      const x = index * 0.025;
      trail.update(index / 120, base(x), tip(x));
    }

    expect(trail.sampleCount).toBe(8);
    expect(trail.visibleSegmentCount).toBeLessThanOrEqual(7);
    expect(trail.coreMesh.geometry).toBe(coreGeometry);
    expect(trail.glowMesh.geometry).toBe(glowGeometry);
    expect(trail.coreMesh.geometry.getAttribute('position').array).toBe(corePositions);
    expect(trail.glowMesh.geometry.getAttribute('color').array).toBe(glowColors);
    expect(coreGeometry.drawRange.count).toBeLessThanOrEqual(7 * 6);
    trail.dispose();
  });

  it('fades old geometry out, resets on a backwards song clock and retains resources across reset', () => {
    const trail = new SaberTrail({ trailDuration: 0.1 });
    const geometry = trail.coreMesh.geometry;
    const positions = geometry.getAttribute('position').array;
    trail.update(2, base(), tip());
    trail.update(2.02, base(0.3), tip(0.3));
    expect(trail.visibleSegmentCount).toBe(1);

    trail.update(2.4);
    expect(trail.visibleSegmentCount).toBe(0);
    expect(trail.coreMesh.visible).toBe(false);
    trail.update(0.1, base(), tip());
    expect(trail.sampleCount).toBe(1);
    expect(trail.time).toBeCloseTo(0.1);

    trail.reset(0);
    expect(trail.coreMesh.geometry).toBe(geometry);
    expect(trail.coreMesh.geometry.getAttribute('position').array).toBe(positions);
    expect(trail.sampleCount).toBe(0);
    expect(trail.currentIntensity).toBe(0);
    trail.dispose();
  });

  it('breaks the ribbon across tracking teleports instead of painting a full-screen sheet', () => {
    const trail = new SaberTrail({ maxSampleDistance: 0.5 });
    trail.update(0, base(), tip());
    trail.update(0.02, base(2), tip(2));

    expect(trail.sampleCount).toBe(1);
    expect(trail.visibleSegmentCount).toBe(0);
    trail.update(0.04, base(2.2), tip(2.2));
    expect(trail.visibleSegmentCount).toBe(1);
    trail.dispose();
  });

  it('caps Quest and reduced-motion history while preserving a subtle real ribbon', () => {
    const full = new SaberTrail({ maxSamples: 64 });
    const lowPower = new SaberTrail({ maxSamples: 64, lowPower: true });
    const reduced = new SaberTrail({ maxSamples: 64, reducedMotion: true });

    expect(lowPower.maxSamples).toBeLessThan(full.maxSamples / 3);
    expect(reduced.maxSamples).toBeLessThan(lowPower.maxSamples);
    expect(reduced.trailDuration).toBeLessThan(lowPower.trailDuration);
    reduced.update(0, base(), tip());
    reduced.update(0.02, base(0.2), tip(0.2));
    expect(reduced.visibleSegmentCount).toBe(1);
    expect(reduced.currentWidth).toBeGreaterThan(0);
    full.dispose();
    lowPower.dispose();
    reduced.dispose();
  });

  it('rejects malformed samples and disposes both GPU layers exactly once', () => {
    const trail = new SaberTrail();
    expect(trail.pushSample(null, tip(), 0)).toBe(false);
    expect(trail.pushSample(base(), { x: NaN, y: 1, z: 0 }, 0)).toBe(false);
    expect(trail.pushSample(base(), base(), 0)).toBe(false);

    const coreGeometryDispose = vi.spyOn(trail.coreMesh.geometry, 'dispose');
    const coreMaterialDispose = vi.spyOn(trail.coreMesh.material, 'dispose');
    const glowGeometryDispose = vi.spyOn(trail.glowMesh.geometry, 'dispose');
    trail.dispose();
    trail.dispose();

    expect(coreGeometryDispose).toHaveBeenCalledTimes(1);
    expect(coreMaterialDispose).toHaveBeenCalledTimes(1);
    expect(glowGeometryDispose).toHaveBeenCalledTimes(1);
    expect(trail.group.children).toHaveLength(0);
    expect(trail.update(1, base(), tip())).toBe(false);
    expect(trail.pushSample(base(), tip(), 1)).toBe(false);
  });
});
