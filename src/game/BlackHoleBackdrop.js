import * as THREE from 'three';

const DEFAULT_THEME = Object.freeze({
  key: 'singularity',
  primary: 0x58eaff,
  secondary: 0xb65cff,
  accent: 0xff4fbf,
  hot: 0xffd37a,
  white: 0xfff7df,
  deep: 0x020006,
});

const THEME_PALETTES = Object.freeze({
  neon: { primary: 0x47eaff, secondary: 0xf24bff, accent: 0xff4fc4, hot: 0xffd08a, white: 0xfff9e8, deep: 0x03000a },
  magma: { primary: 0xff6b19, secondary: 0xff254f, accent: 0xffa126, hot: 0xffde78, white: 0xffffe2, deep: 0x080001 },
  orbit: { primary: 0x8beaff, secondary: 0x8d77ff, accent: 0xd5a5ff, hot: 0xffd7a3, white: 0xf4feff, deep: 0x00040b },
  sakura: { primary: 0xff8fcf, secondary: 0xb37bff, accent: 0xff5c9f, hot: 0xffd0c9, white: 0xfff5fa, deep: 0x070008 },
  abyss: { primary: 0x00e7df, secondary: 0x147bd1, accent: 0x32b6ff, hot: 0x9fffee, white: 0xe9ffff, deep: 0x000407 },
  solar: { primary: 0xff9a21, secondary: 0xff4b19, accent: 0xffc431, hot: 0xffe49a, white: 0xffffe5, deep: 0x090100 },
  ice: { primary: 0xa7edff, secondary: 0x7c91ff, accent: 0xd1c4ff, hot: 0xdffaff, white: 0xffffff, deep: 0x00040a },
  jungle: { primary: 0x56f09a, secondary: 0x9bff42, accent: 0xffd84a, hot: 0xeeff9f, white: 0xf9ffe4, deep: 0x000602 },
  desert: { primary: 0xffb056, secondary: 0xef5a32, accent: 0x45dfff, hot: 0xffe0a3, white: 0xffffe8, deep: 0x080201 },
  void: { primary: 0x8f4dff, secondary: 0xe04cff, accent: 0x45fff0, hot: 0xffb9ee, white: 0xfff1ff, deep: 0x010003 },
});

const THERMAL_COLORS = Object.freeze({
  innerHot: 0xffffe7,
  midWarm: 0xffb62f,
  outerCool: 0xb7280b,
  photon: 0xfff2bf,
  starlight: 0xffe3b1,
  copper: 0xcf641d,
});

const THERMAL_PROFILE = Object.freeze({
  innerKelvin: 10_500,
  midKelvin: 5_800,
  outerKelvin: 2_200,
});

const DOPPLER_PROFILE = Object.freeze({
  approachingSide: 'positive-x',
  approachingBoost: 1.7,
  recedingFactor: 0.44,
});

const DISK_TILT = Object.freeze({ x: 1.12, y: 0.055, z: -0.09 });
const SYSTEM_POSITION = Object.freeze({ x: 0, y: 6, z: -24 });
const HORIZON_RADIUS = 2.34;

export function resolveBlackHoleTheme(theme = DEFAULT_THEME) {
  const source = typeof theme === 'string' ? { key: theme } : theme || {};
  const key = String(source.key || DEFAULT_THEME.key).toLowerCase();
  const preset = THEME_PALETTES[key] || DEFAULT_THEME;
  const sky = Array.isArray(source.sky) ? source.sky : [];
  return {
    key,
    primary: colorHex(source.primary ?? source.grid, preset.primary),
    secondary: colorHex(source.secondary ?? source.bloom, preset.secondary),
    accent: colorHex(source.accent, preset.accent),
    hot: colorHex(source.hot ?? source.energy, preset.hot),
    white: colorHex(source.white, preset.white),
    deep: colorHex(source.deep ?? source.fog ?? sky[0], preset.deep),
  };
}

/**
 * Texture-free cinematic black hole.
 *
 * The event horizon is an opaque depth-writing sphere. Every luminous layer is
 * physically warm first and receives only a restrained theme tint. The disk is
 * geometrically thin but has real thickness, so the horizon can correctly hide
 * its rear half in desktop and WebXR rendering.
 */
export class BlackHoleBackdrop {
  constructor({ theme = DEFAULT_THEME, lowPower = false, reducedMotion = false, seed = 0xb1ac401e } = {}) {
    this.lowPower = Boolean(lowPower);
    this.reducedMotion = Boolean(reducedMotion);
    this.seed = normalizeSeed(seed);
    this.theme = resolveBlackHoleTheme(theme);
    this.disposed = false;
    this._rng = mulberry32(this.seed);
    this._materials = [];
    this._animatedMaterials = [];
    this._themeScratch = new THREE.Color();
    this.particleFields = [];

    this.group = new THREE.Group();
    this.group.name = 'black-hole-backdrop';
    this.group.position.set(SYSTEM_POSITION.x, SYSTEM_POSITION.y, SYSTEM_POSITION.z);
    this.group.userData.procedural = true;
    this.group.userData.textureFree = true;
    this.group.userData.depthLayered = true;
    this.group.userData.adjustableAnchor = true;
    this.group.userData.visualStyle = 'physical-cinematic';

    this.system = new THREE.Group();
    this.system.name = 'black-hole-system';
    this.group.add(this.system);

    this._buildDeepSpace();
    this._buildLensedStarlight();
    this._buildJets();
    this._buildAccretionDisk();
    this._buildEventHorizon();
    this._buildPhotonSphere();
    this.setTheme(this.theme);
  }

  setTheme(theme) {
    if (this.disposed) return this;
    this.theme = resolveBlackHoleTheme(theme);

    for (const material of this._materials) {
      const roles = material.userData.blackHoleColorRoles || {};
      for (const [target, role] of Object.entries(roles)) {
        const value = this.theme[role] ?? this.theme.primary;
        if (target === 'color') material.color?.setHex?.(value);
        else material.uniforms?.[target]?.value?.setHex?.(value);
      }
    }

    if (this.deepSpaceMaterial) {
      this._themeScratch.setHex(this.theme.deep);
      this.deepSpaceMaterial.color.setRGB(
        Math.min(this._themeScratch.r * 0.14, 0.012),
        Math.min(this._themeScratch.g * 0.14, 0.012),
        Math.min(this._themeScratch.b * 0.14, 0.016),
      );
    }
    return this;
  }

  update(elapsed = 0, beatPulse = 0) {
    if (this.disposed) return false;
    const time = Math.max(0, finiteNumber(elapsed));
    const beat = THREE.MathUtils.clamp(finiteNumber(beatPulse), 0, 1);
    const motion = this.reducedMotion ? 0 : this.lowPower ? 0.5 : 1;
    const shaderTime = time * motion;
    const pulse = 1 + beat * (this.reducedMotion ? 0.025 : this.lowPower ? 0.08 : 0.14);

    for (const material of this._animatedMaterials) {
      if (material.uniforms.time) material.uniforms.time.value = shaderTime;
      if (material.uniforms.pulse) material.uniforms.pulse.value = pulse;
      if (material.uniforms.turbulence) {
        material.uniforms.turbulence.value = this.reducedMotion ? 0.04 : this.lowPower ? 0.38 : 1;
      }
    }

    if (this.accretionDisk) {
      this.accretionDisk.rotation.set(
        DISK_TILT.x,
        DISK_TILT.y,
        DISK_TILT.z + time * 0.0028 * motion,
      );
      const diskPulse = 1 + beat * (this.reducedMotion ? 0.006 : this.lowPower ? 0.014 : 0.024);
      this.accretionDisk.scale.set(diskPulse, diskPulse, 1 + beat * 0.012);
    }

    if (this.photonSphere) {
      const ringScale = 1 + beat * (this.reducedMotion ? 0.004 : 0.011);
      this.photonSphere.scale.setScalar(ringScale);
      if (this.lensedImages) {
        this.lensedImages.rotation.z = this.lensedImages.userData.baseRotationZ - time * 0.0015 * motion;
      }
    }

    if (this.jetGroup) {
      this.jetGroup.rotation.set(
        DISK_TILT.x,
        DISK_TILT.y,
        DISK_TILT.z + Math.sin(time * 0.055) * 0.004 * motion,
      );
      this.jetGroup.scale.set(1, 1, 1 + beat * (this.reducedMotion ? 0.008 : 0.025));
    }

    if (this.lensedStardust) {
      const base = this.lensedStardust.userData.baseRotation;
      this.lensedStardust.rotation.set(
        base.x + Math.sin(time * 0.018) * 0.004 * motion,
        base.y + time * 0.0012 * motion,
        base.z - time * 0.0007 * motion,
      );
    }

    if (this.orbitTrails) {
      this.orbitTrails.rotation.z = this.orbitTrails.userData.baseRotationZ + time * 0.002 * motion;
      this.orbitTrails.material.opacity = this.orbitTrails.userData.baseOpacity * (1 + beat * 0.22);
    }
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.parent?.remove(this.group);

    const geometries = new Set();
    const materials = new Set();
    this.group.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => material && materials.add(material));
      } else if (object.material) {
        materials.add(object.material);
      }
    });
    geometries.forEach((geometry) => geometry.dispose?.());
    materials.forEach((material) => material.dispose?.());

    this.group.clear();
    this._materials.length = 0;
    this._animatedMaterials.length = 0;
    this.particleFields.length = 0;
    this.system = null;
    this.eventHorizon = null;
    this.accretionDisk = null;
    this.photonSphere = null;
    this.lensedImages = null;
    this.jetGroup = null;
    this.lensedStardust = null;
    this.orbitTrails = null;
    this.deepSpaceMaterial = null;
    this._themeScratch = null;
  }

  _buildDeepSpace() {
    const material = this._registerMaterial(new THREE.MeshBasicMaterial({
      color: 0x000002,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }));
    material.name = 'black-hole-deep-space-material';
    const background = new THREE.Mesh(
      new THREE.SphereGeometry(68, this.lowPower ? 20 : 40, this.lowPower ? 12 : 24),
      material,
    );
    background.name = 'black-hole-deep-space';
    background.renderOrder = -100;
    background.userData.nearBlack = true;
    this.deepSpaceMaterial = material;
    this.system.add(background);
  }

  _buildEventHorizon() {
    const material = this._registerMaterial(new THREE.MeshBasicMaterial({
      color: 0x000000,
      depthTest: true,
      depthWrite: true,
      fog: false,
      toneMapped: false,
    }));
    material.name = 'black-hole-event-horizon-material';
    const horizon = new THREE.Mesh(
      new THREE.SphereGeometry(HORIZON_RADIUS, this.lowPower ? 28 : 64, this.lowPower ? 18 : 42),
      material,
    );
    horizon.name = 'black-hole-event-horizon';
    horizon.renderOrder = 2;
    horizon.userData.opaqueDepthOccluder = true;
    horizon.userData.radius = HORIZON_RADIUS;
    horizon.userData.schwarzschildSilhouette = true;
    this.eventHorizon = horizon;
    this.system.add(horizon);
  }

  _buildAccretionDisk() {
    const group = new THREE.Group();
    group.name = 'black-hole-accretion-disk';
    group.rotation.set(DISK_TILT.x, DISK_TILT.y, DISK_TILT.z);
    group.userData.physicallyOccludedBy = 'black-hole-event-horizon';
    group.userData.geometry = 'thin-volumetric-torus';
    group.userData.thermalProfile = { ...THERMAL_PROFILE };
    group.userData.dopplerProfile = { ...DOPPLER_PROFILE };

    const layers = [
      {
        name: 'black-hole-accretion-disk-volume',
        radius: 4.13,
        tube: 1.52,
        thickness: 0.115,
        opacity: this.lowPower ? 0.72 : 0.84,
        speed: 0.32,
        phase: 0,
        filamentDensity: 1,
        order: 4,
      },
      {
        name: 'black-hole-accretion-disk-plasma',
        radius: 4.06,
        tube: 1.38,
        thickness: 0.065,
        opacity: this.lowPower ? 0.32 : 0.43,
        speed: -0.18,
        phase: 2.4,
        filamentDensity: 1.65,
        order: 5,
      },
    ];

    layers.forEach((config, index) => {
      const material = this._registerAnimatedMaterial(createThermalDiskMaterial({
        themeTint: this.theme.primary,
        opacity: config.opacity,
        speed: config.speed,
        phase: config.phase,
        filamentDensity: config.filamentDensity,
        lowPower: this.lowPower,
      }), { themeTint: 'primary' });
      material.name = config.name + '-material';
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(
          config.radius,
          config.tube,
          this.lowPower ? 10 : 22,
          this.lowPower ? 112 : 260,
        ),
        material,
      );
      mesh.name = config.name;
      mesh.scale.z = config.thickness;
      mesh.renderOrder = config.order;
      mesh.userData.layer = index;
      mesh.userData.volumetricThickness = config.tube * config.thickness * 2;
      mesh.userData.thermalProfile = { ...THERMAL_PROFILE };
      mesh.userData.dopplerProfile = { ...DOPPLER_PROFILE };
      mesh.userData.themeTintWeight = 0.06;
      group.add(mesh);
    });

    const innerMaterial = this._registerMaterial(new THREE.MeshBasicMaterial({
      color: THERMAL_COLORS.innerHot,
      transparent: true,
      opacity: this.lowPower ? 0.72 : 0.9,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }));
    innerMaterial.name = 'black-hole-accretion-inner-rim-material';
    const innerRim = new THREE.Mesh(
      new THREE.TorusGeometry(2.53, this.lowPower ? 0.055 : 0.072, 8, this.lowPower ? 96 : 220),
      innerMaterial,
    );
    innerRim.name = 'black-hole-accretion-inner-rim';
    innerRim.scale.z = 0.42;
    innerRim.renderOrder = 6;
    innerRim.userData.colorTemperatureKelvin = THERMAL_PROFILE.innerKelvin;
    group.add(innerRim);

    const outerMaterial = this._registerMaterial(new THREE.MeshBasicMaterial({
      color: THERMAL_COLORS.outerCool,
      transparent: true,
      opacity: this.lowPower ? 0.035 : 0.055,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    }));
    outerMaterial.name = 'black-hole-accretion-outer-glow-material';
    const outerGlow = new THREE.Mesh(
      new THREE.TorusGeometry(4.22, 1.72, this.lowPower ? 8 : 14, this.lowPower ? 84 : 180),
      outerMaterial,
    );
    outerGlow.name = 'black-hole-accretion-outer-glow';
    outerGlow.scale.z = 0.04;
    outerGlow.renderOrder = 3;
    outerGlow.userData.thermalHaze = true;
    outerGlow.userData.themeTintWeight = 0;
    group.add(outerGlow);

    this.accretionDisk = group;
    this.system.add(group);
  }

  _buildPhotonSphere() {
    const group = new THREE.Group();
    group.name = 'black-hole-photon-sphere';
    group.userData.lensingModel = 'photon-ring-and-secondary-disk-images';

    const lensMaterial = this._registerAnimatedMaterial(createFresnelLensMaterial({
      themeTint: this.theme.secondary,
      opacity: this.lowPower ? 0.035 : 0.052,
    }), { themeTint: 'secondary' });
    lensMaterial.name = 'black-hole-gravitational-lens-material';
    const lens = new THREE.Mesh(
      new THREE.TorusGeometry(2.68, this.lowPower ? 0.22 : 0.28, this.lowPower ? 8 : 14, this.lowPower ? 96 : 220),
      lensMaterial,
    );
    lens.name = 'black-hole-gravitational-lens';
    lens.renderOrder = 7;
    lens.userData.themeTintWeight = 0.055;
    lens.userData.doesNotCoverEventHorizon = true;

    const haloMaterial = this._registerMaterial(new THREE.MeshBasicMaterial({
      color: THERMAL_COLORS.midWarm,
      transparent: true,
      opacity: this.lowPower ? 0.055 : 0.082,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    }));
    haloMaterial.name = 'black-hole-photon-halo-material';
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(2.55, this.lowPower ? 0.095 : 0.13, 8, this.lowPower ? 96 : 220),
      haloMaterial,
    );
    halo.name = 'black-hole-photon-halo';
    halo.renderOrder = 8;

    const ringMaterial = this._registerMaterial(new THREE.MeshBasicMaterial({
      color: THERMAL_COLORS.photon,
      transparent: true,
      opacity: this.lowPower ? 0.7 : 0.86,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    }));
    ringMaterial.name = 'black-hole-photon-ring-material';
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.47, this.lowPower ? 0.038 : 0.052, 8, this.lowPower ? 112 : 260),
      ringMaterial,
    );
    ring.name = 'black-hole-photon-ring';
    ring.renderOrder = 9;
    ring.userData.colorTemperatureKelvin = 8_800;
    ring.userData.photonOrbit = true;

    const imageGroup = new THREE.Group();
    imageGroup.name = 'black-hole-lensed-disk-images';
    imageGroup.userData.baseRotationZ = 0.025;
    imageGroup.rotation.z = imageGroup.userData.baseRotationZ;
    [
      { name: 'upper', rotation: 0, brightness: 1.35, opacity: this.lowPower ? 0.5 : 0.68, order: 10 },
      { name: 'lower', rotation: Math.PI, brightness: 0.72, opacity: this.lowPower ? 0.28 : 0.4, order: 8 },
    ].forEach((config) => {
      const material = this._registerAnimatedMaterial(createLensedDiskMaterial({
        themeTint: this.theme.primary,
        brightness: config.brightness,
        opacity: config.opacity,
      }), { themeTint: 'primary' });
      material.name = 'black-hole-lensed-disk-' + config.name + '-material';
      const image = new THREE.Mesh(
        new THREE.TorusGeometry(
          2.72,
          this.lowPower ? 0.045 : 0.062,
          7,
          this.lowPower ? 88 : 180,
          Math.PI * 0.94,
        ),
        material,
      );
      image.name = 'black-hole-lensed-disk-' + config.name;
      image.rotation.z = config.rotation;
      image.renderOrder = config.order;
      image.userData.lensedImage = config.name;
      image.userData.source = 'black-hole-accretion-disk';
      image.userData.colorTemperatureKelvin = config.name === 'upper' ? 7_600 : 4_600;
      imageGroup.add(image);
    });

    group.add(lens, halo, ring, imageGroup);
    this.photonSphere = group;
    this.lensedImages = imageGroup;
    this.system.add(group);
  }

  _buildJets() {
    const group = new THREE.Group();
    group.name = 'black-hole-relativistic-jets';
    group.rotation.set(DISK_TILT.x, DISK_TILT.y, DISK_TILT.z);
    group.userData.visualProminence = 'restrained';

    ['north', 'south'].forEach((direction, index) => {
      const sign = index === 0 ? 1 : -1;
      const material = this._registerAnimatedMaterial(createJetMaterial({
        themeTint: this.theme.primary,
        opacity: this.lowPower ? 0.07 : 0.11,
        direction: sign,
      }), { themeTint: 'primary' });
      material.name = 'black-hole-jet-' + direction + '-material';
      const jet = new THREE.Mesh(
        new THREE.CylinderGeometry(
          this.lowPower ? 0.13 : 0.18,
          0.035,
          11.5,
          this.lowPower ? 7 : 12,
          this.lowPower ? 1 : 3,
          true,
        ),
        material,
      );
      jet.name = 'black-hole-jet-' + direction;
      jet.rotation.x = sign * Math.PI / 2;
      jet.position.z = sign * 6.7;
      jet.renderOrder = 1;
      jet.userData.maximumRadius = this.lowPower ? 0.13 : 0.18;
      jet.userData.opacity = material.uniforms.opacity.value;

      const coreMaterial = this._registerMaterial(new THREE.MeshBasicMaterial({
        color: THERMAL_COLORS.photon,
        transparent: true,
        opacity: this.lowPower ? 0.065 : 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        fog: false,
        toneMapped: false,
      }));
      coreMaterial.name = 'black-hole-jet-core-' + direction + '-material';
      const core = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.045, 10.8, this.lowPower ? 5 : 8, 1, true),
        coreMaterial,
      );
      core.name = 'black-hole-jet-core-' + direction;
      core.rotation.x = sign * Math.PI / 2;
      core.position.z = sign * 6.35;
      core.renderOrder = 2;

      const particles = createJetParticleField({
        count: this.lowPower ? 12 : 60,
        sign,
        rng: this._rng,
        themeTint: this.theme.accent,
        lowPower: this.lowPower,
      });
      particles.name = 'black-hole-jet-particles-' + direction;
      this._registerExistingAnimatedMaterial(particles.material, { themeTint: 'accent' });
      particles.material.name = 'black-hole-jet-particles-' + direction + '-material';
      particles.renderOrder = 3;
      this.particleFields.push(particles);
      group.add(jet, core, particles);
    });

    this.jetGroup = group;
    this.system.add(group);
  }

  _buildLensedStarlight() {
    const dust = createLensedDustField({
      count: this.lowPower ? 80 : 420,
      rng: this._rng,
      themeTint: this.theme.secondary,
      lowPower: this.lowPower,
    });
    dust.name = 'black-hole-lensed-stardust';
    dust.userData.baseRotation = new THREE.Euler(0.035, -0.02, 0.055);
    dust.rotation.copy(dust.userData.baseRotation);
    dust.renderOrder = 0;
    dust.userData.density = 'sparse';
    this._registerExistingAnimatedMaterial(dust.material, { themeTint: 'secondary' });
    dust.material.name = 'black-hole-lensed-stardust-material';
    this.lensedStardust = dust;
    this.particleFields.push(dust);
    this.system.add(dust);

    const orbitGeometry = createOrbitTrailGeometry(this.lowPower ? 1 : 4, this._rng);
    const orbitMaterial = this._registerMaterial(new THREE.LineBasicMaterial({
      color: THERMAL_COLORS.copper,
      transparent: true,
      opacity: this.lowPower ? 0.022 : 0.042,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    }));
    orbitMaterial.name = 'black-hole-curved-orbit-trails-material';
    const trails = new THREE.LineSegments(orbitGeometry, orbitMaterial);
    trails.name = 'black-hole-curved-orbit-trails';
    trails.userData.baseRotationZ = -0.04;
    trails.userData.baseOpacity = orbitMaterial.opacity;
    trails.rotation.z = trails.userData.baseRotationZ;
    trails.renderOrder = 0;
    this.orbitTrails = trails;
    this.system.add(trails);
  }

  _registerMaterial(material, roles = {}) {
    material.userData.blackHoleColorRoles = { ...roles };
    this._materials.push(material);
    return material;
  }

  _registerAnimatedMaterial(material, roles = {}) {
    this._registerMaterial(material, roles);
    this._animatedMaterials.push(material);
    return material;
  }

  _registerExistingAnimatedMaterial(material, roles = {}) {
    return this._registerAnimatedMaterial(material, roles);
  }
}

function createThermalDiskMaterial({ themeTint, opacity, speed, phase, filamentDensity, lowPower }) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      innerHot: { value: new THREE.Color(THERMAL_COLORS.innerHot) },
      midWarm: { value: new THREE.Color(THERMAL_COLORS.midWarm) },
      outerCool: { value: new THREE.Color(THERMAL_COLORS.outerCool) },
      themeTint: { value: new THREE.Color(themeTint) },
      opacity: { value: opacity },
      speed: { value: speed },
      phase: { value: phase },
      filamentDensity: { value: filamentDensity },
      approachingBoost: { value: DOPPLER_PROFILE.approachingBoost },
      recedingFactor: { value: DOPPLER_PROFILE.recedingFactor },
      time: { value: 0 },
      pulse: { value: 1 },
      turbulence: { value: 1 },
      lowPower: { value: lowPower ? 1 : 0 },
    },
    vertexShader: [
      'varying vec2 vUv;',
      'varying vec3 vLocal;',
      'uniform float time;',
      'uniform float speed;',
      'uniform float turbulence;',
      'void main() {',
      '  vUv = uv;',
      '  vLocal = position;',
      '  vec3 transformed = position;',
      '  float ripple = sin(uv.x * 100.0 - time * speed * 8.0 + uv.y * 19.0);',
      '  transformed.z += ripple * 0.012 * turbulence;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'varying vec2 vUv;',
      'varying vec3 vLocal;',
      'uniform vec3 innerHot;',
      'uniform vec3 midWarm;',
      'uniform vec3 outerCool;',
      'uniform vec3 themeTint;',
      'uniform float opacity;',
      'uniform float phase;',
      'uniform float filamentDensity;',
      'uniform float approachingBoost;',
      'uniform float recedingFactor;',
      'uniform float time;',
      'uniform float speed;',
      'uniform float pulse;',
      'uniform float turbulence;',
      'void main() {',
      '  float radius = length(vLocal.xy);',
      '  float radial = clamp((radius - 2.48) / 3.34, 0.0, 1.0);',
      '  float innerEdge = smoothstep(0.0, 0.055, radial);',
      '  float outerEdge = 1.0 - smoothstep(0.82, 1.0, radial);',
      '  float radialEnvelope = innerEdge * outerEdge;',
      '  vec3 thermal = mix(innerHot, midWarm, smoothstep(0.02, 0.48, radial));',
      '  thermal = mix(thermal, outerCool, smoothstep(0.48, 0.98, radial));',
      '  float orbit = vUv.x * 6.2831853;',
      '  float filamentA = 0.5 + 0.5 * sin(orbit * (38.0 * filamentDensity) - time * speed * 9.0 + radial * 47.0 + phase);',
      '  float filamentB = 0.5 + 0.5 * sin(orbit * (83.0 * filamentDensity) + time * speed * 5.0 - radial * 91.0);',
      '  float filaments = mix(0.48, 1.0, filamentA * 0.67 + filamentB * 0.33);',
      '  filaments = mix(0.76, filaments, turbulence);',
      '  float side = clamp(vLocal.x / 5.7, -1.0, 1.0);',
      '  float approaching = smoothstep(-0.82, 0.82, side);',
      '  float relativisticBoost = mix(recedingFactor, approachingBoost, approaching);',
      '  vec3 shifted = mix(outerCool, innerHot, 0.44 + approaching * 0.34);',
      '  thermal = mix(thermal, shifted, 0.16);',
      '  thermal = mix(thermal, themeTint, 0.06);',
      '  float alpha = radialEnvelope * filaments * opacity * mix(0.7, 1.0, approaching);',
      '  vec3 color = thermal * relativisticBoost * filaments * pulse;',
      '  gl_FragColor = vec4(color, alpha);',
      '}',
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  material.userData.thermalProfile = { ...THERMAL_PROFILE };
  material.userData.dopplerProfile = { ...DOPPLER_PROFILE };
  material.userData.themeTintWeight = 0.06;
  return material;
}

function createFresnelLensMaterial({ themeTint, opacity }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      themeTint: { value: new THREE.Color(themeTint) },
      opacity: { value: opacity },
      time: { value: 0 },
      pulse: { value: 1 },
    },
    vertexShader: [
      'varying vec3 vNormal;',
      'varying vec3 vViewDirection;',
      'void main() {',
      '  vec4 worldPosition = modelMatrix * vec4(position, 1.0);',
      '  vNormal = normalize(normalMatrix * normal);',
      '  vViewDirection = normalize(cameraPosition - worldPosition.xyz);',
      '  gl_Position = projectionMatrix * viewMatrix * worldPosition;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'varying vec3 vNormal;',
      'varying vec3 vViewDirection;',
      'uniform vec3 themeTint;',
      'uniform float opacity;',
      'uniform float pulse;',
      'void main() {',
      '  float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDirection))), 4.5);',
      '  vec3 neutral = vec3(0.72, 0.74, 0.76);',
      '  vec3 tint = mix(neutral, themeTint, 0.055);',
      '  gl_FragColor = vec4(tint * pulse, fresnel * opacity);',
      '}',
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
}

function createLensedDiskMaterial({ themeTint, brightness, opacity }) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      innerHot: { value: new THREE.Color(THERMAL_COLORS.innerHot) },
      outerCool: { value: new THREE.Color(THERMAL_COLORS.outerCool) },
      themeTint: { value: new THREE.Color(themeTint) },
      brightness: { value: brightness },
      opacity: { value: opacity },
      time: { value: 0 },
      pulse: { value: 1 },
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = uv;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'varying vec2 vUv;',
      'uniform vec3 innerHot;',
      'uniform vec3 outerCool;',
      'uniform vec3 themeTint;',
      'uniform float brightness;',
      'uniform float opacity;',
      'uniform float time;',
      'uniform float pulse;',
      'void main() {',
      '  float side = smoothstep(0.0, 1.0, vUv.x);',
      '  float fineStructure = 0.72 + 0.28 * sin(vUv.x * 118.0 - time * 0.25);',
      '  vec3 thermal = mix(outerCool, innerHot, 0.42 + side * 0.45);',
      '  thermal = mix(thermal, themeTint, 0.045);',
      '  float edge = smoothstep(0.02, 0.18, vUv.y) * (1.0 - smoothstep(0.82, 0.98, vUv.y));',
      '  gl_FragColor = vec4(thermal * brightness * fineStructure * pulse, edge * opacity);',
      '}',
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  material.userData.themeTintWeight = 0.045;
  material.userData.thermalLensingImage = true;
  return material;
}

function createJetMaterial({ themeTint, opacity, direction }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      coreColor: { value: new THREE.Color(THERMAL_COLORS.photon) },
      themeTint: { value: new THREE.Color(themeTint) },
      opacity: { value: opacity },
      time: { value: 0 },
      pulse: { value: 1 },
      turbulence: { value: 1 },
      direction: { value: direction },
    },
    vertexShader: [
      'varying vec2 vUv;',
      'varying vec3 vLocal;',
      'uniform float time;',
      'uniform float turbulence;',
      'uniform float direction;',
      'void main() {',
      '  vUv = uv;',
      '  vLocal = position;',
      '  vec3 transformed = position;',
      '  float envelope = sin(uv.y * 3.14159265);',
      '  transformed.x += sin(uv.y * 19.0 - time * direction) * 0.008 * envelope * turbulence;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'varying vec2 vUv;',
      'varying vec3 vLocal;',
      'uniform vec3 coreColor;',
      'uniform vec3 themeTint;',
      'uniform float opacity;',
      'uniform float pulse;',
      'void main() {',
      '  float radial = clamp(length(vLocal.xz) / 0.2, 0.0, 1.0);',
      '  float core = pow(1.0 - radial, 2.8);',
      '  float taper = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.72, 1.0, vUv.y));',
      '  vec3 color = mix(coreColor, themeTint, 0.08);',
      '  gl_FragColor = vec4(color * pulse, taper * (0.18 + core * 0.82) * opacity);',
      '}',
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
}

function createParticleMaterial({ themeTint, pointSize, opacity }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      baseColor: { value: new THREE.Color(THERMAL_COLORS.starlight) },
      themeTint: { value: new THREE.Color(themeTint) },
      pointSize: { value: pointSize },
      opacity: { value: opacity },
      time: { value: 0 },
      pulse: { value: 1 },
    },
    vertexShader: [
      'attribute float aSize;',
      'attribute float aPhase;',
      'varying float vBrightness;',
      'uniform float pointSize;',
      'uniform float time;',
      'uniform float pulse;',
      'void main() {',
      '  vBrightness = 0.72 + 0.28 * sin(aPhase + time * 0.42);',
      '  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);',
      '  float attenuation = max(1.0, -viewPosition.z * 0.16);',
      '  gl_PointSize = pointSize * aSize * pulse / attenuation;',
      '  gl_Position = projectionMatrix * viewPosition;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'varying float vBrightness;',
      'uniform vec3 baseColor;',
      'uniform vec3 themeTint;',
      'uniform float opacity;',
      'void main() {',
      '  vec2 center = gl_PointCoord - vec2(0.5);',
      '  float radius = length(center) * 2.0;',
      '  if (radius > 1.0) discard;',
      '  float core = pow(max(0.0, 1.0 - radius), 3.6);',
      '  vec3 color = mix(baseColor, themeTint, 0.07);',
      '  gl_FragColor = vec4(color, core * opacity * vBrightness);',
      '}',
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
}

function createLensedDustField({ count, rng, themeTint, lowPower }) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const stream = index % 7;
    const progress = rng() * 2 - 1;
    const closestApproach = 3.4 + stream * 0.68 + rng() * 1.1;
    const bend = Math.sign(progress || 1) * Math.pow(Math.abs(progress), 0.62) * Math.PI * 1.18;
    const radius = closestApproach + Math.abs(progress) * (8 + rng() * 13);
    const angle = bend + stream * 0.9 + (1 / Math.max(0.45, Math.abs(progress))) * 0.08;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = Math.sin(angle) * radius * (0.6 + rng() * 0.3);
    positions[index * 3 + 2] = (rng() - 0.5) * (7 + Math.abs(progress) * 12);
    sizes[index] = 0.32 + rng() * 0.72 + (rng() > 0.992 ? 0.6 : 0);
    phases[index] = rng() * Math.PI * 2;
  }
  const geometry = particleGeometry(positions, sizes, phases);
  geometry.userData.flow = 'gravitationally-bent-sparse';
  const material = createParticleMaterial({
    themeTint,
    pointSize: lowPower ? 4.4 : 5.2,
    opacity: lowPower ? 0.22 : 0.3,
  });
  return new THREE.Points(geometry, material);
}

function createJetParticleField({ count, sign, rng, themeTint, lowPower }) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const distance = 1.2 + Math.pow(rng(), 0.8) * 11;
    const spread = 0.025 + distance * 0.012;
    const angle = rng() * Math.PI * 2;
    const radius = Math.pow(rng(), 2.3) * spread;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = Math.sin(angle) * radius;
    positions[index * 3 + 2] = sign * distance;
    sizes[index] = 0.3 + rng() * 0.55;
    phases[index] = rng() * Math.PI * 2;
  }
  const geometry = particleGeometry(positions, sizes, phases);
  geometry.userData.flow = sign > 0 ? 'north-relativistic-jet' : 'south-relativistic-jet';
  const material = createParticleMaterial({
    themeTint,
    pointSize: lowPower ? 3.8 : 4.5,
    opacity: lowPower ? 0.12 : 0.18,
  });
  return new THREE.Points(geometry, material);
}

function createOrbitTrailGeometry(trailCount, rng) {
  const segments = 22;
  const positions = [];
  for (let trail = 0; trail < trailCount; trail += 1) {
    const radius = 3.7 + rng() * 7.5;
    const eccentricity = 0.6 + rng() * 0.25;
    const start = rng() * Math.PI * 2;
    const span = 0.28 + rng() * 0.72;
    const depth = (rng() - 0.5) * 4.2;
    for (let segment = 0; segment < segments; segment += 1) {
      const first = start + span * (segment / segments);
      const second = start + span * ((segment + 1) / segments);
      positions.push(
        Math.cos(first) * radius,
        Math.sin(first) * radius * eccentricity,
        depth + Math.sin(first * 2) * 0.22,
        Math.cos(second) * radius,
        Math.sin(second) * radius * eccentricity,
        depth + Math.sin(second * 2) * 0.22,
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  geometry.userData.flow = 'restrained-curved-orbital-streaks';
  return geometry;
}

function particleGeometry(positions, sizes, phases) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function colorHex(value, fallback) {
  try {
    if (value === undefined || value === null) return fallback;
    return new THREE.Color(value).getHex();
  } catch {
    return fallback;
  }
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeSeed(seed) {
  if (Number.isFinite(Number(seed))) return Number(seed) >>> 0;
  let value = 2166136261;
  for (const character of String(seed)) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
