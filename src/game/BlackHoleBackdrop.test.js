import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BlackHoleBackdrop, resolveBlackHoleTheme } from './BlackHoleBackdrop.js';

function particleBudget(backdrop) {
  return backdrop.particleFields.reduce(
    (total, field) => total + field.geometry.getAttribute('position').count,
    0,
  );
}

describe('BlackHoleBackdrop construction', () => {
  it('builds a named, texture-free 3D singularity with every requested phenomenon', () => {
    const backdrop = new BlackHoleBackdrop({ seed: 42 });
    expect(backdrop.group.name).toBe('black-hole-backdrop');
    expect(backdrop.group.userData).toMatchObject({
      procedural: true,
      textureFree: true,
      depthLayered: true,
      adjustableAnchor: true,
    });
    expect(backdrop.group.position.toArray()).toEqual([0, 6, -24]);
    expect(backdrop.group.scale.toArray()).toEqual([1, 1, 1]);

    const requiredNames = [
      'black-hole-event-horizon',
      'black-hole-gravitational-lens',
      'black-hole-photon-ring',
      'black-hole-photon-halo',
      'black-hole-accretion-disk',
      'black-hole-accretion-disk-volume',
      'black-hole-accretion-disk-plasma',
      'black-hole-accretion-inner-rim',
      'black-hole-jet-north',
      'black-hole-jet-south',
      'black-hole-jet-particles-north',
      'black-hole-jet-particles-south',
      'black-hole-lensed-stardust',
      'black-hole-curved-orbit-trails',
    ];
    requiredNames.forEach((name) => expect(backdrop.group.getObjectByName(name), name).toBeTruthy());

    const unnamed = [];
    backdrop.group.traverse((object) => {
      if (!object.name) unnamed.push(object.type);
    });
    expect(unnamed).toEqual([]);

    const textureBacked = [];
    backdrop.group.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach((material) => {
        if (material.map) textureBacked.push(object.name);
      });
    });
    expect(textureBacked).toEqual([]);
    backdrop.dispose();
  });

  it('uses an opaque depth-writing horizon to correctly occlude the rear of a thick tilted disk', () => {
    const backdrop = new BlackHoleBackdrop();
    const horizon = backdrop.group.getObjectByName('black-hole-event-horizon');
    const diskGroup = backdrop.group.getObjectByName('black-hole-accretion-disk');
    const volume = backdrop.group.getObjectByName('black-hole-accretion-disk-volume');

    expect(horizon.material.transparent).toBe(false);
    expect(horizon.material.depthWrite).toBe(true);
    expect(horizon.material.depthTest).toBe(true);
    expect(horizon.material.color.getHex()).toBe(0x000000);
    expect(horizon.userData.opaqueDepthOccluder).toBe(true);
    expect(diskGroup.userData.physicallyOccludedBy).toBe('black-hole-event-horizon');
    expect(diskGroup.rotation.x).toBeGreaterThan(0.9);
    expect(volume.material.transparent).toBe(true);
    expect(volume.material.depthWrite).toBe(false);
    expect(volume.material.depthTest).toBe(true);
    expect(volume.userData.volumetricThickness).toBeGreaterThan(1);

    const localDepth = volume.geometry.getAttribute('position').array.filter((_, index) => index % 3 === 2);
    expect(Math.max(...localDepth) - Math.min(...localDepth)).toBeGreaterThan(3.5);
    expect(volume.scale.z).toBeGreaterThan(0.2);
    backdrop.dispose();
  });

  it('creates photon/lensing layers and genuinely bipolar jet volumes with additive light', () => {
    const backdrop = new BlackHoleBackdrop();
    const ring = backdrop.group.getObjectByName('black-hole-photon-ring');
    const lens = backdrop.group.getObjectByName('black-hole-gravitational-lens');
    const north = backdrop.group.getObjectByName('black-hole-jet-north');
    const south = backdrop.group.getObjectByName('black-hole-jet-south');
    const northDust = backdrop.group.getObjectByName('black-hole-jet-particles-north');
    const southDust = backdrop.group.getObjectByName('black-hole-jet-particles-south');

    expect(ring.material.blending).toBe(THREE.AdditiveBlending);
    expect(lens.material.uniforms.tint).toBeTruthy();
    expect(lens.material.fragmentShader).toContain('fresnel');
    expect(north.position.z).toBeGreaterThan(0);
    expect(south.position.z).toBeLessThan(0);
    expect(north.rotation.x).toBeCloseTo(Math.PI / 2);
    expect(south.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(northDust.geometry.userData.flow).toBe('north-relativistic-jet');
    expect(southDust.geometry.userData.flow).toBe('south-relativistic-jet');
    backdrop.dispose();
  });

  it('is deterministic and cuts the low-power particle budget well below thirty percent', () => {
    const first = new BlackHoleBackdrop({ seed: 'event-horizon' });
    const second = new BlackHoleBackdrop({ seed: 'event-horizon' });
    const lowPower = new BlackHoleBackdrop({ seed: 'event-horizon', lowPower: true });
    const firstDust = first.group.getObjectByName('black-hole-lensed-stardust');
    const secondDust = second.group.getObjectByName('black-hole-lensed-stardust');

    expect(Array.from(firstDust.geometry.getAttribute('position').array.slice(0, 36)))
      .toEqual(Array.from(secondDust.geometry.getAttribute('position').array.slice(0, 36)));
    expect(particleBudget(lowPower)).toBeLessThan(particleBudget(first) * 0.3);
    expect(particleBudget(lowPower)).toBeGreaterThan(300);
    expect(lowPower.group.getObjectByName('black-hole-event-horizon')).toBeTruthy();
    expect(lowPower.group.getObjectByName('black-hole-photon-ring')).toBeTruthy();
    first.dispose();
    second.dispose();
    lowPower.dispose();
  });
});

describe('BlackHoleBackdrop animation and themes', () => {
  it('animates disk turbulence, jet flow, orbiting dust and beat pulses from absolute time', () => {
    const backdrop = new BlackHoleBackdrop({ seed: 7 });
    const disk = backdrop.group.getObjectByName('black-hole-accretion-disk');
    const volume = backdrop.group.getObjectByName('black-hole-accretion-disk-volume');
    const jet = backdrop.group.getObjectByName('black-hole-jet-north');
    const dust = backdrop.group.getObjectByName('black-hole-lensed-stardust');
    const startDiskRotation = disk.rotation.z;
    const startDustRotation = dust.rotation.y;

    expect(backdrop.update(20, 0.9)).toBe(true);
    expect(disk.rotation.z).not.toBeCloseTo(startDiskRotation, 8);
    expect(dust.rotation.y).not.toBeCloseTo(startDustRotation, 8);
    expect(volume.material.uniforms.time.value).toBe(20);
    expect(volume.material.uniforms.pulse.value).toBeGreaterThan(1.18);
    expect(volume.material.uniforms.turbulence.value).toBe(1);
    expect(jet.material.uniforms.time.value).toBe(20);

    const firstRotation = disk.rotation.z;
    const firstScale = disk.scale.x;
    backdrop.update(20, 0.9);
    expect(disk.rotation.z).toBeCloseTo(firstRotation, 10);
    expect(disk.scale.x).toBeCloseTo(firstScale, 10);
    backdrop.dispose();
  });

  it('honors reduced motion while retaining a restrained beat response', () => {
    const backdrop = new BlackHoleBackdrop({ reducedMotion: true });
    const disk = backdrop.group.getObjectByName('black-hole-accretion-disk');
    const volume = backdrop.group.getObjectByName('black-hole-accretion-disk-volume');
    const dust = backdrop.group.getObjectByName('black-hole-lensed-stardust');
    const startDiskRotation = disk.rotation.clone();
    const startDustRotation = dust.rotation.clone();

    backdrop.update(900, 1);
    expect(disk.rotation.x).toBeCloseTo(startDiskRotation.x, 10);
    expect(disk.rotation.y).toBeCloseTo(startDiskRotation.y, 10);
    expect(disk.rotation.z).toBeCloseTo(startDiskRotation.z, 10);
    expect(dust.rotation.x).toBeCloseTo(startDustRotation.x, 10);
    expect(dust.rotation.y).toBeCloseTo(startDustRotation.y, 10);
    expect(dust.rotation.z).toBeCloseTo(startDustRotation.z, 10);
    expect(volume.material.uniforms.time.value).toBe(0);
    expect(volume.material.uniforms.turbulence.value).toBe(0.08);
    expect(volume.material.uniforms.pulse.value).toBeGreaterThan(1);
    expect(volume.material.uniforms.pulse.value).toBeLessThan(1.04);
    backdrop.dispose();
  });

  it('accepts RhythmGame theme fields and recolors shader, photon and jet materials in place', () => {
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
    const jetParticles = backdrop.group.getObjectByName('black-hole-jet-particles-north');

    expect(backdrop.setTheme(custom)).toBe(backdrop);
    expect(backdrop.theme).toEqual(palette);
    expect(volume.material.uniforms.colorA.value.getHex()).toBe(0xffaa33);
    expect(volume.material.uniforms.colorB.value.getHex()).toBe(0x123456);
    expect(ring.material.color.getHex()).toBe(0xfefefe);
    expect(lens.material.uniforms.tint.value.getHex()).toBe(0x654321);
    expect(jetParticles.material.uniforms.tint.value.getHex()).toBe(0xfedcba);
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
    const horizonGeometryDispose = vi.spyOn(horizon.geometry, 'dispose');
    const horizonMaterialDispose = vi.spyOn(horizon.material, 'dispose');
    const diskGeometryDispose = vi.spyOn(disk.geometry, 'dispose');
    const diskMaterialDispose = vi.spyOn(disk.material, 'dispose');
    const dustGeometryDispose = vi.spyOn(dust.geometry, 'dispose');

    backdrop.dispose();
    expect(parent.children).not.toContain(backdrop.group);
    expect(horizonGeometryDispose).toHaveBeenCalledTimes(1);
    expect(horizonMaterialDispose).toHaveBeenCalledTimes(1);
    expect(diskGeometryDispose).toHaveBeenCalledTimes(1);
    expect(diskMaterialDispose).toHaveBeenCalledTimes(1);
    expect(dustGeometryDispose).toHaveBeenCalledTimes(1);
    expect(backdrop.group.children).toHaveLength(0);
    expect(backdrop.update(3, 1)).toBe(false);
    expect(backdrop.setTheme('magma')).toBe(backdrop);
    expect(() => backdrop.dispose()).not.toThrow();
  });
});
