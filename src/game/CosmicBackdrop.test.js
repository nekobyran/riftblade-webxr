import { describe, expect, it, vi } from 'vitest';
import { CosmicBackdrop, resolveCosmicTheme } from './CosmicBackdrop.js';

describe('CosmicBackdrop construction', () => {
  it('creates named near, mid and far 3D star shells plus dust, nebulae and two celestial landmarks', () => {
    const backdrop = new CosmicBackdrop({ seed: 42 });
    expect(backdrop.group.name).toBe('cosmic-backdrop');
    expect(backdrop.group.userData).toMatchObject({ procedural: true, textureFree: true });

    const near = backdrop.group.getObjectByName('cosmic-stars-near');
    const mid = backdrop.group.getObjectByName('cosmic-stars-mid');
    const far = backdrop.group.getObjectByName('cosmic-stars-far');
    expect([near, mid, far].every(Boolean)).toBe(true);
    expect(near.geometry.getAttribute('position').count).toBeGreaterThan(300);
    expect(mid.geometry.getAttribute('position').count).toBeGreaterThan(near.geometry.getAttribute('position').count);
    expect(far.geometry.getAttribute('position').count).toBeGreaterThan(mid.geometry.getAttribute('position').count);

    const nearPositions = near.geometry.getAttribute('position').array;
    const zValues = Array.from({ length: Math.min(60, nearPositions.length / 3) }, (_, index) => nearPositions[index * 3 + 2]);
    expect(Math.max(...zValues) - Math.min(...zValues)).toBeGreaterThan(10);
    expect(backdrop.group.getObjectByName('cosmic-stardust')).toBeTruthy();
    expect(backdrop.group.getObjectByName('cosmic-nebula-1')).toBeTruthy();
    expect(backdrop.group.getObjectByName('cosmic-nebula-3')).toBeTruthy();
    expect(backdrop.group.getObjectByName('cosmic-distant-planet')).toBeTruthy();
    expect(backdrop.group.getObjectByName('cosmic-ring-galaxy')).toBeTruthy();
    backdrop.dispose();
  });

  it('uses deterministic generation and a much smaller Quest-friendly low-power budget', () => {
    const first = new CosmicBackdrop({ seed: 'same-seed' });
    const second = new CosmicBackdrop({ seed: 'same-seed' });
    const lowPower = new CosmicBackdrop({ seed: 'same-seed', lowPower: true });
    const firstPosition = first.group.getObjectByName('cosmic-stars-near').geometry.getAttribute('position').array;
    const secondPosition = second.group.getObjectByName('cosmic-stars-near').geometry.getAttribute('position').array;
    expect(Array.from(firstPosition.slice(0, 24))).toEqual(Array.from(secondPosition.slice(0, 24)));

    const fullCount = first.starLayers.reduce((sum, layer) => sum + layer.geometry.getAttribute('position').count, 0);
    const reducedCount = lowPower.starLayers.reduce((sum, layer) => sum + layer.geometry.getAttribute('position').count, 0);
    expect(reducedCount).toBeLessThan(fullCount * 0.3);
    expect(lowPower.group.getObjectByName('cosmic-distant-planet')).toBeTruthy();
    expect(lowPower.group.getObjectByName('cosmic-ring-galaxy')).toBeTruthy();
    first.dispose();
    second.dispose();
    lowPower.dispose();
  });
});

describe('CosmicBackdrop animation and theming', () => {
  it('applies depth-dependent parallax and beat breathing without frame-delta accumulation', () => {
    const backdrop = new CosmicBackdrop({ seed: 7 });
    const near = backdrop.group.getObjectByName('cosmic-stars-near');
    const far = backdrop.group.getObjectByName('cosmic-stars-far');
    const nearStart = near.rotation.y;
    const farStart = far.rotation.y;

    expect(backdrop.update(20, 0.8)).toBe(true);
    expect(Math.abs(near.rotation.y - nearStart)).toBeGreaterThan(Math.abs(far.rotation.y - farStart));
    expect(near.material.uniforms.pulse.value).toBeGreaterThan(1);
    const firstUpdate = near.rotation.y;
    backdrop.update(20, 0.8);
    expect(near.rotation.y).toBeCloseTo(firstUpdate, 10);
    backdrop.dispose();
  });

  it('disables slow drift under reduced-motion while preserving a subtle beat response', () => {
    const backdrop = new CosmicBackdrop({ seed: 9, reducedMotion: true });
    const near = backdrop.group.getObjectByName('cosmic-stars-near');
    const startRotation = near.rotation.clone();
    backdrop.update(500, 1);
    expect(near.rotation.x).toBeCloseTo(startRotation.x, 10);
    expect(near.rotation.y).toBeCloseTo(startRotation.y, 10);
    expect(near.rotation.z).toBeCloseTo(startRotation.z, 10);
    expect(near.material.uniforms.pulse.value).toBeGreaterThan(1);
    expect(near.material.uniforms.pulse.value).toBeLessThan(1.03);
    backdrop.dispose();
  });

  it('accepts RhythmGame palette fields and recolors every shader and celestial material in place', () => {
    const backdrop = new CosmicBackdrop({ theme: 'neon' });
    const near = backdrop.group.getObjectByName('cosmic-stars-near');
    const planet = backdrop.group.getObjectByName('cosmic-planet-core');
    const palette = resolveCosmicTheme({ key: 'custom', grid: 0x123456, bloom: 0x654321, accent: 0xfedcba, fog: 0x010203, sky: [0x010203, 0x223344, 0xaabbcc] });

    backdrop.setTheme({ key: 'custom', grid: 0x123456, bloom: 0x654321, accent: 0xfedcba, fog: 0x010203, sky: [0x010203, 0x223344, 0xaabbcc] });
    expect(backdrop.theme).toEqual(palette);
    expect(near.material.uniforms.tint.value.getHex()).toBe(0x123456);
    expect(planet.material.color.getHex()).toBe(0xaabbcc);
    backdrop.dispose();
  });
});

describe('CosmicBackdrop cleanup', () => {
  it('disposes all GPU resources, detaches its group and becomes update-safe', () => {
    const backdrop = new CosmicBackdrop({ lowPower: true });
    const parent = { remove: vi.fn() };
    Object.defineProperty(backdrop.group, 'parent', { configurable: true, value: parent });
    const near = backdrop.group.getObjectByName('cosmic-stars-near');
    const planetCore = backdrop.group.getObjectByName('cosmic-planet-core');
    const geometryDispose = vi.spyOn(near.geometry, 'dispose');
    const materialDispose = vi.spyOn(near.material, 'dispose');
    const planetDispose = vi.spyOn(planetCore.geometry, 'dispose');

    backdrop.dispose();
    expect(parent.remove).toHaveBeenCalledWith(backdrop.group);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(planetDispose).toHaveBeenCalledTimes(1);
    expect(backdrop.group.children).toHaveLength(0);
    expect(backdrop.update(2, 1)).toBe(false);
    expect(() => backdrop.dispose()).not.toThrow();
  });
});
