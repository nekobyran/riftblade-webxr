import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BlackHoleBackdrop, resolveBlackHoleTheme } from './BlackHoleBackdrop.js';

function particleBudget(backdrop) {
  return backdrop.particleFields.reduce(
    (total, field) => total + field.geometry.getAttribute('position').count,
    0,
  );
}

function relativeLuminance(color) {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

describe('BlackHoleBackdrop physical construction', () => {
  it('builds a named, texture-free singularity against genuinely near-black space', () => {
    const backdrop = new BlackHoleBackdrop({ seed: 42 });
    expect(backdrop.group.name).toBe('black-hole-backdrop');
    expect(backdrop.group.userData).toMatchObject({
      procedural: true,
      textureFree: true,
      depthLayered: true,
      visualStyle: 'physical-cinematic',
    });
    expect(backdrop.group.position.toArray()).toEqual([0, 6, -24]);

    [
      'black-hole-deep-space',
      'black-hole-event-horizon',
      'black-hole-gravitational-lens',
      'black-hole-photon-ring',
      'black-hole-lensed-disk-upper',
      'black-hole-lensed-disk-lower',
      'black-hole-accretion-disk-volume',
      'black-hole-accretion-disk-plasma',
      'black-hole-accretion-inner-rim',
      'black-hole-relativistic-jets',
      'black-hole-jet-north',
      'black-hole-jet-south',
      'black-hole-lensed-stardust',
      'black-hole-curved-orbit-trails',
    ].forEach((name) => expect(backdrop.group.getObjectByName(name), name).toBeTruthy());

    const deepSpace = backdrop.group.getObjectByName('black-hole-deep-space');
    expect(Math.max(
      deepSpace.material.color.r,
      deepSpace.material.color.g,
      deepSpace.material.color.b,
    )).toBeLessThan(0.02);
    expect(deepSpace.material.depthWrite).toBe(false);

    const unnamed = [];
    const textureBacked = [];
    backdrop.group.traverse((object) => {
      if (!object.name) unnamed.push(object.type);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach((material) => {
        if (material.map) textureBacked.push(object.name);
      });
    });
    expect(unnamed).toEqual([]);
    expect(textureBacked).toEqual([]);
    backdrop.dispose();
  });

  it('uses a pure-black depth occluder and a thin disk with measurable geometric thickness', () => {
    const backdrop = new BlackHoleBackdrop();
    const horizon = backdrop.group.getObjectByName('black-hole-event-horizon');
    const diskGroup = backdrop.group.getObjectByName('black-hole-accretion-disk');
    const volume = backdrop.group.getObjectByName('black-hole-accretion-disk-volume');

    expect(horizon.material.transparent).toBe(false);
    expect(horizon.material.depthWrite).toBe(true);
    expect(horizon.material.depthTest).toBe(true);
    expect(horizon.material.color.getHex()).toBe(0x000000);
    expect(horizon.userData).toMatchObject({
      opaqueDepthOccluder: true,
      schwarzschildSilhouette: true,
    });
    expect(diskGroup.userData.physicallyOccludedBy).toBe('black-hole-event-horizon');
    expect(diskGroup.rotation.x).toBeGreaterThan(1);
    expect(volume.material.transparent).toBe(true);
    expect(volume.material.depthWrite).toBe(false);
    expect(volume.material.depthTest).toBe(true);

    const geometryDepth = volume.geometry.getAttribute('position').array
      .filter((_, index) => index % 3 === 2);
    const worldThickness = (Math.max(...geometryDepth) - Math.min(...geometryDepth)) * volume.scale.z;
    const outerRadius = volume.geometry.parameters.radius + volume.geometry.parameters.tube;
    const innerRadius = volume.geometry.parameters.radius - volume.geometry.parameters.tube;
    expect(worldThickness).toBeGreaterThan(0.3);
    expect(worldThickness).toBeLessThan(0.5);
    expect(worldThickness / outerRadius).toBeLessThan(0.08);
    expect(innerRadius).toBeGreaterThan(horizon.userData.radius);
    expect(volume.userData.volumetricThickness).toBeCloseTo(worldThickness, 2);
    backdrop.dispose();
  });

  it('prioritizes warm thermal colors and quantifies asymmetric relativistic Doppler brightness', () => {
    const backdrop = new BlackHoleBackdrop({ theme: 'void' });
    const volume = backdrop.group.getObjectByName('black-hole-accretion-disk-volume');
    const outerGlow = backdrop.group.getObjectByName('black-hole-accretion-outer-glow');
    const uniforms = volume.material.uniforms;
    const inner = uniforms.innerHot.value;
    const middle = uniforms.midWarm.value;
    const outer = uniforms.outerCool.value;

    expect(relativeLuminance(inner)).toBeGreaterThan(relativeLuminance(middle));
    expect(relativeLuminance(middle)).toBeGreaterThan(relativeLuminance(outer));
    expect(outer.r).toBeGreaterThan(outer.g * 3);
    expect(outer.r).toBeGreaterThan(outer.b * 8);
    expect(volume.userData.thermalProfile).toEqual({
      innerKelvin: 10_500,
      midKelvin: 5_800,
      outerKelvin: 2_200,
    });
    expect(uniforms.approachingBoost.value).toBeGreaterThanOrEqual(1.65);
    expect(uniforms.recedingFactor.value).toBeLessThanOrEqual(0.45);
    expect(volume.userData.dopplerProfile.approachingSide).toBe('positive-x');
    expect(volume.userData.themeTintWeight).toBeLessThanOrEqual(0.06);
    expect(volume.material.fragmentShader).toContain('relativisticBoost');
    expect(volume.material.fragmentShader).toContain('mix(recedingFactor, approachingBoost');
    expect(outerGlow.material.color.r).toBeGreaterThan(outerGlow.material.color.b * 8);
    backdrop.dispose();
  });

  it('places secondary disk images above and below a thin photon ring while keeping jets restrained', () => {
    const backdrop = new BlackHoleBackdrop();
    backdrop.group.updateMatrixWorld(true);
    const horizon = backdrop.group.getObjectByName('black-hole-event-horizon');
    const ring = backdrop.group.getObjectByName('black-hole-photon-ring');
    const lens = backdrop.group.getObjectByName('black-hole-gravitational-lens');
    const upper = backdrop.group.getObjectByName('black-hole-lensed-disk-upper');
    const lower = backdrop.group.getObjectByName('black-hole-lensed-disk-lower');
    const north = backdrop.group.getObjectByName('black-hole-jet-north');
    const south = backdrop.group.getObjectByName('black-hole-jet-south');
    const horizonCenter = new THREE.Vector3();
    const upperCenter = new THREE.Vector3();
    const lowerCenter = new THREE.Vector3();
    new THREE.Box3().setFromObject(horizon).getCenter(horizonCenter);
    new THREE.Box3().setFromObject(upper).getCenter(upperCenter);
    new THREE.Box3().setFromObject(lower).getCenter(lowerCenter);

    expect(upperCenter.y).toBeGreaterThan(horizonCenter.y + 1);
    expect(lowerCenter.y).toBeLessThan(horizonCenter.y - 1);
    expect(upper.userData).toMatchObject({
      lensedImage: 'upper',
      source: 'black-hole-accretion-disk',
    });
    expect(lower.userData.lensedImage).toBe('lower');
    expect(upper.material.uniforms.brightness.value)
      .toBeGreaterThan(lower.material.uniforms.brightness.value);
    expect(ring.geometry.parameters.tube).toBeLessThanOrEqual(0.052);
    expect(ring.material.opacity).toBeGreaterThan(0.8);
    expect(ring.userData.photonOrbit).toBe(true);
    expect(lens.material.uniforms.opacity.value).toBeLessThanOrEqual(0.052);
    expect(lens.userData.doesNotCoverEventHorizon).toBe(true);
    expect(north.userData.maximumRadius).toBeLessThanOrEqual(0.18);
    expect(north.material.uniforms.opacity.value).toBeLessThanOrEqual(0.11);
    expect(south.userData.maximumRadius).toBeLessThanOrEqual(0.18);
    backdrop.dispose();
  });

  it('is deterministic and keeps low-power particles below a quarter of the full budget', () => {
    const first = new BlackHoleBackdrop({ seed: 'physical-singularity' });
    const second = new BlackHoleBackdrop({ seed: 'physical-singularity' });
    const lowPower = new BlackHoleBackdrop({ seed: 'physical-singularity', lowPower: true });
    const firstDust = first.group.getObjectByName('black-hole-lensed-stardust');
    const secondDust = second.group.getObjectByName('black-hole-lensed-stardust');

    expect(Array.from(firstDust.geometry.getAttribute('position').array.slice(0, 42)))
      .toEqual(Array.from(secondDust.geometry.getAttribute('position').array.slice(0, 42)));
    expect(firstDust.userData.density).toBe('sparse');
    expect(particleBudget(lowPower)).toBeLessThan(particleBudget(first) * 0.25);
    expect(particleBudget(lowPower)).toBeGreaterThan(90);
    expect(lowPower.group.getObjectByName('black-hole-event-horizon')).toBeTruthy();
    expect(lowPower.group.getObjectByName('black-hole-lensed-disk-upper')).toBeTruthy();
    first.dispose();
    second.dispose();
    lowPower.dispose();
  });
});

describe('BlackHoleBackdrop motion and theme behavior', () => {
  it('updates absolute-time flow without replacing uniforms, materials or particle buffers', () => {
    const backdrop = new BlackHoleBackdrop({ seed: 7 });
    const disk = backdrop.group.getObjectByName('black-hole-accretion-disk');
    const volume = backdrop.group.getObjectByName('black-hole-accretion-disk-volume');
    const dust = backdrop.group.getObjectByName('black-hole-lensed-stardust');
    const uniforms = volume.material.uniforms;
    const timeUniform = uniforms.time;
    const pulseUniform = uniforms.pulse;
    const particleArray = dust.geometry.getAttribute('position').array;
    const material = volume.material;
    const startDiskRotation = disk.rotation.z;
    const startDustRotation = dust.rotation.y;

    expect(backdrop.update(20, 1)).toBe(true);
    expect(disk.rotation.z).not.toBeCloseTo(startDiskRotation, 8);
    expect(dust.rotation.y).not.toBeCloseTo(startDustRotation, 8);
    expect(uniforms.time.value).toBe(20);
    expect(uniforms.pulse.value).toBeGreaterThanOrEqual(1.14);

    backdrop.update(20, 1);
    expect(volume.material).toBe(material);
    expect(volume.material.uniforms).toBe(uniforms);
    expect(volume.material.uniforms.time).toBe(timeUniform);
    expect(volume.material.uniforms.pulse).toBe(pulseUniform);
    expect(dust.geometry.getAttribute('position').array).toBe(particleArray);
    backdrop.dispose();
  });

  it('freezes motion for reduced-motion users while preserving a very restrained beat response', () => {
    const backdrop = new BlackHoleBackdrop({ reducedMotion: true });
    const disk = backdrop.group.getObjectByName('black-hole-accretion-disk');
    const volume = backdrop.group.getObjectByName('black-hole-accretion-disk-volume');
    const dust = backdrop.group.getObjectByName('black-hole-lensed-stardust');
    const diskStart = disk.rotation.clone();
    const dustStart = dust.rotation.clone();

    backdrop.update(900, 1);
    expect(disk.rotation.x).toBeCloseTo(diskStart.x, 10);
    expect(disk.rotation.y).toBeCloseTo(diskStart.y, 10);
    expect(disk.rotation.z).toBeCloseTo(diskStart.z, 10);
    expect(dust.rotation.x).toBeCloseTo(dustStart.x, 10);
    expect(dust.rotation.y).toBeCloseTo(dustStart.y, 10);
    expect(dust.rotation.z).toBeCloseTo(dustStart.z, 10);
    expect(volume.material.uniforms.time.value).toBe(0);
    expect(volume.material.uniforms.turbulence.value).toBe(0.04);
    expect(volume.material.uniforms.pulse.value).toBeGreaterThan(1);
    expect(volume.material.uniforms.pulse.value).toBeLessThanOrEqual(1.025);
    backdrop.dispose();
  });

  it('changes only the restrained theme tint while preserving physical thermal colors', () => {
    const backdrop = new BlackHoleBackdrop({ theme: 'neon' });
    const custom = {
      key: 'custom-hole',
      grid: 0x123456,
      bloom: 0x654321,
      accent: 0xfedcba,
      energy: 0xffaa33,
      white: 0xfefefe,
      fog: 0x010203,
    };
    const palette = resolveBlackHoleTheme(custom);
    const volume = backdrop.group.getObjectByName('black-hole-accretion-disk-volume');
    const ring = backdrop.group.getObjectByName('black-hole-photon-ring');
    const lens = backdrop.group.getObjectByName('black-hole-gravitational-lens');
    const upper = backdrop.group.getObjectByName('black-hole-lensed-disk-upper');
    const innerThermal = volume.material.uniforms.innerHot.value.getHex();

    expect(backdrop.setTheme(custom)).toBe(backdrop);
    expect(backdrop.theme).toEqual(palette);
    expect(volume.material.uniforms.themeTint.value.getHex()).toBe(0x123456);
    expect(upper.material.uniforms.themeTint.value.getHex()).toBe(0x123456);
    expect(lens.material.uniforms.themeTint.value.getHex()).toBe(0x654321);
    expect(volume.material.uniforms.innerHot.value.getHex()).toBe(innerThermal);
    expect(ring.material.color.getHex()).toBe(0xfff2bf);
    expect(Math.max(
      backdrop.deepSpaceMaterial.color.r,
      backdrop.deepSpaceMaterial.color.g,
      backdrop.deepSpaceMaterial.color.b,
    )).toBeLessThan(0.02);
    backdrop.dispose();
  });
});

describe('BlackHoleBackdrop cleanup', () => {
  it('detaches and disposes every GPU resource exactly once, then becomes update-safe', () => {
    const backdrop = new BlackHoleBackdrop({ lowPower: true });
    const parent = new THREE.Group();
    parent.add(backdrop.group);
    const horizon = backdrop.group.getObjectByName('black-hole-event-horizon');
    const disk = backdrop.group.getObjectByName('black-hole-accretion-disk-volume');
    const dust = backdrop.group.getObjectByName('black-hole-lensed-stardust');
    const lens = backdrop.group.getObjectByName('black-hole-gravitational-lens');
    const horizonGeometryDispose = vi.spyOn(horizon.geometry, 'dispose');
    const horizonMaterialDispose = vi.spyOn(horizon.material, 'dispose');
    const diskGeometryDispose = vi.spyOn(disk.geometry, 'dispose');
    const diskMaterialDispose = vi.spyOn(disk.material, 'dispose');
    const dustGeometryDispose = vi.spyOn(dust.geometry, 'dispose');
    const lensMaterialDispose = vi.spyOn(lens.material, 'dispose');

    backdrop.dispose();
    expect(parent.children).not.toContain(backdrop.group);
    expect(horizonGeometryDispose).toHaveBeenCalledTimes(1);
    expect(horizonMaterialDispose).toHaveBeenCalledTimes(1);
    expect(diskGeometryDispose).toHaveBeenCalledTimes(1);
    expect(diskMaterialDispose).toHaveBeenCalledTimes(1);
    expect(dustGeometryDispose).toHaveBeenCalledTimes(1);
    expect(lensMaterialDispose).toHaveBeenCalledTimes(1);
    expect(backdrop.group.children).toHaveLength(0);
    expect(backdrop.update(3, 1)).toBe(false);
    expect(backdrop.setTheme('magma')).toBe(backdrop);
    expect(() => backdrop.dispose()).not.toThrow();
  });
});
