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

const DISK_TILT = Object.freeze({ x: 1.035, y: 0.075, z: -0.135 });
const SYSTEM_POSITION = Object.freeze({ x: 0, y: 6, z: -24 });

/**
 * Converts either a world theme key or a RhythmGame theme object into the
 * compact palette used by the procedural black-hole materials.
 */
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
 * Texture-free, physically layered black-hole scenery for desktop and WebXR.
 *
 * The opaque event horizon writes real depth before the transparent accretion
 * disk. Consequently the far half of the tilted, volumetric torus is hidden by
 * the singularity while the near half remains visible. The remaining effects
 * are procedural shaders and particles; no image or video texture is loaded.
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
    this.particleFields = [];

    this.group = new THREE.Group();
    this.group.name = 'black-hole-backdrop';
    this.group.position.set(SYSTEM_POSITION.x, SYSTEM_POSITION.y, SYSTEM_POSITION.z);
    this.group.userData.procedural = true;
    this.group.userData.textureFree = true;
    this.group.userData.depthLayered = true;
    this.group.userData.adjustableAnchor = true;

    this.system = new THREE.Group();
    this.system.name = 'black-hole-system';
    this.group.add(this.system);

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
    return this;
  }

  /**
   * Applies deterministic absolute-time motion, turbulent plasma flow and a
   * beat pulse. Repeating the same elapsed time produces the same transform.
   */
  update(elapsed = 0, beatPulse = 0) {
    if (this.disposed) return false;
    const time = Math.max(0, finiteNumber(elapsed));
    const beat = THREE.MathUtils.clamp(finiteNumber(beatPulse), 0, 1);
    const motion = this.reducedMotion ? 0 : this.lowPower ? 0.52 : 1;
    const shaderTime = time * motion;

    for (const material of this._animatedMaterials) {
      if (material.uniforms.time) material.uniforms.time.value = shaderTime;
      if (material.uniforms.pulse) material.uniforms.pulse.value = 1 + beat * (this.reducedMotion ? 0.035 : this.lowPower ? 0.12 : 0.23);
      if (material.uniforms.turbulence) material.uniforms.turbulence.value = this.reducedMotion ? 0.08 : this.lowPower ? 0.48 : 1;
    }

    if (this.accretionDisk) {
      this.accretionDisk.rotation.set(
        DISK_TILT.x,
        DISK_TILT.y,
        DISK_TILT.z + time * 0.012 * motion,
      );
      const breathe = 1 + beat * (this.reducedMotion ? 0.012 : this.lowPower ? 0.032 : 0.055);
      this.accretionDisk.scale.set(breathe, breathe, 1 + beat * 0.035);
    }

    if (this.photonSphere) {
      const scale = 1 + beat * (this.reducedMotion ? 0.009 : 0.024);
      this.photonSphere.scale.setScalar(scale);
      const arcs = this.photonSphere.getObjectByName('black-hole-lensing-arcs');
      if (arcs) arcs.rotation.z = arcs.userData.baseRotationZ - time * 0.006 * motion;
    }

    if (this.jetGroup) {
      this.jetGroup.rotation.set(
        DISK_TILT.x,
        DISK_TILT.y,
        DISK_TILT.z + Math.sin(time * 0.08) * 0.012 * motion,
      );
      const jetStretch = 1 + beat * (this.reducedMotion ? 0.025 : 0.085);
      this.jetGroup.scale.set(1, 1, jetStretch);
    }

    if (this.lensedStardust) {
      const base = this.lensedStardust.userData.baseRotation;
      this.lensedStardust.rotation.set(
        base.x + Math.sin(time * 0.025) * 0.014 * motion,
        base.y + time * 0.0035 * motion,
        base.z - time * 0.0018 * motion,
      );
    }
    if (this.orbitTrails) {
      this.orbitTrails.rotation.z = this.orbitTrails.userData.baseRotationZ + time * 0.008 * motion;
      this.orbitTrails.material.opacity = this.orbitTrails.userData.baseOpacity * (1 + beat * 0.5);
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
      if (Array.isArray(object.material)) object.material.forEach((material) => material && materials.add(material));
      else if (object.material) materials.add(object.material);
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
    this.jetGroup = null;
    this.lensedStardust = null;
    this.orbitTrails = null;
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
      new THREE.SphereGeometry(2.34, this.lowPower ? 28 : 64, this.lowPower ? 18 : 42),
      material,
    );
    horizon.name = 'black-hole-event-horizon';
    horizon.renderOrder = 2;
    horizon.userData.opaqueDepthOccluder = true;
    horizon.userData.radius = 2.34;
    this.eventHorizon = horizon;
    this.system.add(horizon);
  }

  _buildPhotonSphere() {
    const group = new THREE.Group();
    group.name = 'black-hole-photon-sphere';

    const lensMaterial = this._registerMaterial(createFresnelMaterial({
      color: this.theme.secondary,
      opacity: this.lowPower ? 0.18 : 0.24,
    }), { tint: 'secondary' });
    lensMaterial.name = 'black-hole-gravitational-lens-material';
    const lens = new THREE.Mesh(
      new THREE.SphereGeometry(3.18, this.lowPower ? 24 : 54, this.lowPower ? 16 : 36),
      lensMaterial,
    );
    lens.name = 'black-hole-gravitational-lens';
    lens.renderOrder = 7;

    const haloMaterial = this._registerMaterial(new THREE.MeshBasicMaterial({
      color: this.theme.hot,
      transparent: true,
      opacity: this.lowPower ? 0.16 : 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    }), { color: 'hot' });
    haloMaterial.name = 'black-hole-photon-halo-material';
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(2.72, this.lowPower ? 0.19 : 0.24, this.lowPower ? 8 : 12, this.lowPower ? 72 : 160),
      haloMaterial,
    );
    halo.name = 'black-hole-photon-halo';
    halo.renderOrder = 8;

    const ringMaterial = this._registerMaterial(new THREE.MeshBasicMaterial({
      color: this.theme.white,
      transparent: true,
      opacity: this.lowPower ? 0.62 : 0.74,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    }), { color: 'white' });
    ringMaterial.name = 'black-hole-photon-ring-material';
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.61, this.lowPower ? 0.052 : 0.075, 8, this.lowPower ? 84 : 192),
      ringMaterial,
    );
    ring.name = 'black-hole-photon-ring';
    ring.renderOrder = 9;

    const arcGroup = new THREE.Group();
    arcGroup.name = 'black-hole-lensing-arcs';
    arcGroup.userData.baseRotationZ = 0.17;
    arcGroup.rotation.z = arcGroup.userData.baseRotationZ;
    const arcConfigs = [
      { radius: 3.02, tube: 0.035, arc: Math.PI * 0.73, rotation: -0.22, role: 'primary', opacity: 0.44 },
      { radius: 3.13, tube: 0.024, arc: Math.PI * 0.48, rotation: Math.PI + 0.38, role: 'accent', opacity: 0.34 },
      { radius: 2.92, tube: 0.021, arc: Math.PI * 0.42, rotation: Math.PI * 1.35, role: 'hot', opacity: 0.4 },
    ];
    arcConfigs.forEach((config, index) => {
      const material = this._registerMaterial(new THREE.MeshBasicMaterial({
        color: this.theme[config.role],
        transparent: true,
        opacity: config.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        fog: false,
        toneMapped: false,
      }), { color: config.role });
      material.name = `black-hole-lensing-arc-${index + 1}-material`;
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(config.radius, config.tube, 6, this.lowPower ? 48 : 96, config.arc),
        material,
      );
      arc.name = `black-hole-lensing-arc-${index + 1}`;
      arc.rotation.z = config.rotation;
      arc.renderOrder = 8;
      arcGroup.add(arc);
    });

    group.add(lens, halo, ring, arcGroup);
    this.photonSphere = group;
    this.system.add(group);
  }

  _buildAccretionDisk() {
    const group = new THREE.Group();
    group.name = 'black-hole-accretion-disk';
    group.rotation.set(DISK_TILT.x, DISK_TILT.y, DISK_TILT.z);
    group.userData.physicallyOccludedBy = 'black-hole-event-horizon';

    const diskLayers = [
      {
        name: 'black-hole-accretion-disk-volume',
        radius: 4.18,
        tube: 2.0,
        thickness: 0.28,
        opacity: this.lowPower ? 0.48 : 0.58,
        speed: 1.0,
        phase: 0,
        colors: ['hot', 'primary'],
        order: 4,
      },
      {
        name: 'black-hole-accretion-disk-plasma',
        radius: 4.48,
        tube: 1.75,
        thickness: 0.15,
        opacity: this.lowPower ? 0.24 : 0.32,
        speed: -0.62,
        phase: 2.7,
        colors: ['white', 'secondary'],
        order: 5,
      },
    ];

    diskLayers.forEach((config, index) => {
      const material = this._registerAnimatedMaterial(createAccretionMaterial({
        colorA: this.theme[config.colors[0]],
        colorB: this.theme[config.colors[1]],
        opacity: config.opacity,
        speed: config.speed,
        phase: config.phase,
        lowPower: this.lowPower,
      }), { colorA: config.colors[0], colorB: config.colors[1] });
      material.name = `${config.name}-material`;
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(
          config.radius,
          config.tube,
          this.lowPower ? 10 : 22,
          this.lowPower ? 96 : 240,
        ),
        material,
      );
      mesh.name = config.name;
      mesh.scale.z = config.thickness;
      mesh.renderOrder = config.order;
      mesh.userData.layer = index;
      mesh.userData.volumetricThickness = config.tube * config.thickness * 2;
      group.add(mesh);
    });

    const innerMaterial = this._registerMaterial(new THREE.MeshBasicMaterial({
      color: this.theme.white,
      transparent: true,
      opacity: this.lowPower ? 0.58 : 0.72,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }), { color: 'white' });
    innerMaterial.name = 'black-hole-accretion-inner-rim-material';
    const innerRim = new THREE.Mesh(
      new THREE.TorusGeometry(2.54, this.lowPower ? 0.105 : 0.14, 8, this.lowPower ? 84 : 180),
      innerMaterial,
    );
    innerRim.name = 'black-hole-accretion-inner-rim';
    innerRim.scale.z = 0.55;
    innerRim.renderOrder = 6;
    group.add(innerRim);

    const outerMaterial = this._registerMaterial(new THREE.MeshBasicMaterial({
      color: this.theme.secondary,
      transparent: true,
      opacity: this.lowPower ? 0.08 : 0.12,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    }), { color: 'secondary' });
    outerMaterial.name = 'black-hole-accretion-outer-glow-material';
    const outerGlow = new THREE.Mesh(
      new THREE.TorusGeometry(5.2, 1.42, this.lowPower ? 8 : 14, this.lowPower ? 72 : 160),
      outerMaterial,
    );
    outerGlow.name = 'black-hole-accretion-outer-glow';
    outerGlow.scale.z = 0.2;
    outerGlow.renderOrder = 3;
    group.add(outerGlow);

    this.accretionDisk = group;
    this.system.add(group);
  }

  _buildJets() {
    const group = new THREE.Group();
    group.name = 'black-hole-relativistic-jets';
    group.rotation.set(DISK_TILT.x, DISK_TILT.y, DISK_TILT.z);

    ['north', 'south'].forEach((direction, index) => {
      const sign = index === 0 ? 1 : -1;
      const material = this._registerAnimatedMaterial(createJetMaterial({
        core: this.theme.white,
        edge: this.theme.primary,
        opacity: this.lowPower ? 0.34 : 0.46,
        direction: sign,
      }), { coreColor: 'white', edgeColor: 'primary' });
      material.name = `black-hole-jet-${direction}-material`;
      const jet = new THREE.Mesh(
        new THREE.CylinderGeometry(
          this.lowPower ? 0.72 : 0.92,
          0.12,
          12.5,
          this.lowPower ? 10 : 20,
          this.lowPower ? 1 : 4,
          true,
        ),
        material,
      );
      jet.name = `black-hole-jet-${direction}`;
      jet.rotation.x = sign * Math.PI / 2;
      jet.position.z = sign * 7.2;
      jet.renderOrder = 1;

      const coreMaterial = this._registerMaterial(new THREE.MeshBasicMaterial({
        color: this.theme.white,
        transparent: true,
        opacity: this.lowPower ? 0.38 : 0.56,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        fog: false,
        toneMapped: false,
      }), { color: 'white' });
      coreMaterial.name = `black-hole-jet-core-${direction}-material`;
      const core = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.16, 11.8, this.lowPower ? 6 : 10, 1, true),
        coreMaterial,
      );
      core.name = `black-hole-jet-core-${direction}`;
      core.rotation.x = sign * Math.PI / 2;
      core.position.z = sign * 6.8;
      core.renderOrder = 2;

      const particles = createJetParticleField({
        count: this.lowPower ? 72 : 420,
        sign,
        rng: this._rng,
        color: this.theme.accent,
        lowPower: this.lowPower,
      });
      particles.name = `black-hole-jet-particles-${direction}`;
      this._registerExistingAnimatedMaterial(particles.material, { tint: 'accent' });
      particles.material.name = `black-hole-jet-particles-${direction}-material`;
      particles.renderOrder = 3;
      this.particleFields.push(particles);
      group.add(jet, core, particles);
    });

    this.jetGroup = group;
    this.system.add(group);
  }

  _buildLensedStarlight() {
    const dust = createLensedDustField({
      count: this.lowPower ? 240 : 1420,
      rng: this._rng,
      color: this.theme.secondary,
      lowPower: this.lowPower,
    });
    dust.name = 'black-hole-lensed-stardust';
    dust.userData.baseRotation = new THREE.Euler(0.08, -0.04, 0.12);
    dust.rotation.copy(dust.userData.baseRotation);
    dust.renderOrder = 0;
    this._registerExistingAnimatedMaterial(dust.material, { tint: 'secondary' });
    dust.material.name = 'black-hole-lensed-stardust-material';
    this.lensedStardust = dust;
    this.particleFields.push(dust);
    this.system.add(dust);

    const orbitGeometry = createOrbitTrailGeometry(this.lowPower ? 7 : 18, this._rng);
    const orbitMaterial = this._registerMaterial(new THREE.LineBasicMaterial({
      color: this.theme.primary,
      transparent: true,
      opacity: this.lowPower ? 0.12 : 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    }), { color: 'primary' });
    orbitMaterial.name = 'black-hole-curved-orbit-trails-material';
    const trails = new THREE.LineSegments(orbitGeometry, orbitMaterial);
    trails.name = 'black-hole-curved-orbit-trails';
    trails.userData.baseRotationZ = -0.08;
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

function createAccretionMaterial({ colorA, colorB, opacity, speed, phase, lowPower }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      colorA: { value: new THREE.Color(colorA) },
      colorB: { value: new THREE.Color(colorB) },
      time: { value: 0 },
      pulse: { value: 1 },
      turbulence: { value: 1 },
      opacity: { value: opacity },
      speed: { value: speed },
      phase: { value: phase },
      lowPower: { value: lowPower ? 1 : 0 },
    },
    vertexShader: `
      varying vec3 vLocal;
      varying vec3 vViewPosition;
      uniform float time;
      uniform float turbulence;
      uniform float speed;
      uniform float phase;
      void main() {
        vLocal = position;
        float radius = length(position.xy);
        float angle = atan(position.y, position.x);
        vec3 transformed = position;
        float corrugation = sin(angle * 13.0 - time * speed * 1.9 + radius * 3.7 + phase)
          + 0.45 * sin(angle * 29.0 + time * speed * 1.1 - radius * 6.1);
        transformed.z += corrugation * 0.045 * turbulence;
        vec4 viewPosition = modelViewMatrix * vec4(transformed, 1.0);
        vViewPosition = viewPosition.xyz;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vLocal;
      varying vec3 vViewPosition;
      uniform vec3 colorA;
      uniform vec3 colorB;
      uniform float time;
      uniform float pulse;
      uniform float turbulence;
      uniform float opacity;
      uniform float speed;
      uniform float phase;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      void main() {
        float radius = length(vLocal.xy);
        float angle = atan(vLocal.y, vLocal.x);
        float radial = smoothstep(2.08, 3.05, radius) * (1.0 - smoothstep(5.55, 6.35, radius));
        float spiralA = sin(angle * 10.0 - time * speed * 2.35 + radius * 4.45 + phase);
        float spiralB = sin(angle * 23.0 + time * speed * 1.18 - radius * 7.2 - phase);
        float cells = hash21(floor(vec2(angle * 20.0, radius * 8.0) + time * speed));
        float turbulenceBand = 0.46 + 0.29 * spiralA + 0.15 * spiralB + 0.18 * cells * turbulence;
        float innerHeat = 1.0 - smoothstep(2.15, 5.8, radius);
        float relativisticBeaming = mix(0.52, 1.55, smoothstep(-0.9, 0.85, normalize(vViewPosition).x));
        float vertical = 1.0 - smoothstep(0.04, 2.05, abs(vLocal.z));
        vec3 plasma = mix(colorB, colorA, clamp(innerHeat * 1.3 + spiralA * 0.12, 0.0, 1.0));
        plasma = mix(plasma, vec3(1.0, 0.98, 0.9), pow(innerHeat, 4.0) * 0.65);
        float alpha = radial * vertical * clamp(turbulenceBand, 0.12, 1.0) * opacity;
        gl_FragColor = vec4(plasma * relativisticBeaming * pulse, alpha * min(1.25, pulse));
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
}

function createFresnelMaterial({ color, opacity }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tint: { value: new THREE.Color(color) },
      opacity: { value: opacity },
      pulse: { value: 1 },
      time: { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDirection;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDirection = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vViewDirection;
      uniform vec3 tint;
      uniform float opacity;
      uniform float pulse;
      void main() {
        float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDirection))), 3.2);
        float razor = pow(fresnel, 3.0);
        vec3 color = mix(tint, vec3(1.0), razor * 0.78);
        gl_FragColor = vec4(color * pulse, (fresnel * 0.72 + razor * 0.5) * opacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
}

function createJetMaterial({ core, edge, opacity, direction }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      coreColor: { value: new THREE.Color(core) },
      edgeColor: { value: new THREE.Color(edge) },
      opacity: { value: opacity },
      time: { value: 0 },
      pulse: { value: 1 },
      turbulence: { value: 1 },
      direction: { value: direction },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vLocal;
      uniform float time;
      uniform float turbulence;
      uniform float direction;
      void main() {
        vUv = uv;
        vLocal = position;
        vec3 transformed = position;
        float envelope = sin(uv.y * 3.14159265);
        float twist = sin(uv.y * 25.0 - time * 3.2 * direction) * 0.045 * envelope * turbulence;
        transformed.x += twist;
        transformed.z += cos(uv.y * 19.0 + time * 2.7 * direction) * 0.035 * envelope * turbulence;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vLocal;
      uniform vec3 coreColor;
      uniform vec3 edgeColor;
      uniform float opacity;
      uniform float time;
      uniform float pulse;
      uniform float direction;
      void main() {
        float radial = abs(sin(atan(vLocal.z, vLocal.x) * 0.5));
        float core = pow(1.0 - radial, 2.2);
        float taper = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.78, 1.0, vUv.y));
        float streaks = 0.65 + 0.35 * sin(vUv.y * 72.0 - time * 7.0 * direction + radial * 9.0);
        vec3 color = mix(edgeColor, coreColor, core);
        float alpha = taper * (0.42 + core * 0.58) * (0.72 + streaks * 0.28) * opacity;
        gl_FragColor = vec4(color * pulse, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
}

function createParticleMaterial({ color, pointSize, opacity }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tint: { value: new THREE.Color(color) },
      pointSize: { value: pointSize },
      opacity: { value: opacity },
      time: { value: 0 },
      pulse: { value: 1 },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aPhase;
      varying float vBrightness;
      uniform float pointSize;
      uniform float time;
      uniform float pulse;
      void main() {
        vBrightness = 0.62 + 0.38 * sin(aPhase + time * 1.8);
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        float attenuation = max(1.0, -viewPosition.z * 0.12);
        gl_PointSize = pointSize * aSize * pulse / attenuation;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      varying float vBrightness;
      uniform vec3 tint;
      uniform float opacity;
      uniform float pulse;
      void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float radius = length(center) * 2.0;
        if (radius > 1.0) discard;
        float core = pow(max(0.0, 1.0 - radius), 2.4);
        float halo = pow(max(0.0, 1.0 - radius), 0.85) * 0.34;
        vec3 color = mix(tint, vec3(1.0), core * 0.72);
        gl_FragColor = vec4(color * pulse, (core + halo) * opacity * vBrightness);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
}

function createLensedDustField({ count, rng, color, lowPower }) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const stream = index % 9;
    const progress = rng();
    const incoming = (progress - 0.5) * 2;
    const impact = 3.1 + stream * 0.46 + rng() * 0.8;
    const bend = Math.sign(incoming || 1) * Math.pow(Math.abs(incoming), 0.58) * Math.PI * 1.34;
    const radius = impact + Math.abs(incoming) * (5.4 + rng() * 7.5);
    const warp = 1.0 / Math.max(0.32, Math.abs(incoming));
    const angle = bend + stream * 0.69 + warp * 0.11;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = Math.sin(angle) * radius * (0.64 + rng() * 0.28);
    positions[index * 3 + 2] = (rng() - 0.5) * (4.2 + Math.abs(incoming) * 7.5);
    sizes[index] = 0.45 + rng() * 1.15 + (rng() > 0.985 ? 1.1 : 0);
    phases[index] = rng() * Math.PI * 2;
  }
  const geometry = particleGeometry(positions, sizes, phases);
  geometry.userData.flow = 'gravitationally-bent';
  const material = createParticleMaterial({
    color,
    pointSize: lowPower ? 7.2 : 8.5,
    opacity: lowPower ? 0.46 : 0.58,
  });
  return new THREE.Points(geometry, material);
}

function createJetParticleField({ count, sign, rng, color, lowPower }) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const distance = 1 + Math.pow(rng(), 0.78) * 13;
    const spread = 0.06 + distance * 0.055;
    const angle = rng() * Math.PI * 2;
    const radius = Math.pow(rng(), 1.8) * spread;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = Math.sin(angle) * radius;
    positions[index * 3 + 2] = sign * distance;
    sizes[index] = 0.45 + rng() * 0.9;
    phases[index] = rng() * Math.PI * 2;
  }
  const geometry = particleGeometry(positions, sizes, phases);
  geometry.userData.flow = sign > 0 ? 'north-relativistic-jet' : 'south-relativistic-jet';
  const material = createParticleMaterial({
    color,
    pointSize: lowPower ? 6.4 : 7.8,
    opacity: lowPower ? 0.38 : 0.52,
  });
  return new THREE.Points(geometry, material);
}

function createOrbitTrailGeometry(trailCount, rng) {
  const segments = 18;
  const positions = [];
  for (let trail = 0; trail < trailCount; trail += 1) {
    const radius = 3.35 + rng() * 7.8;
    const eccentricity = 0.55 + rng() * 0.34;
    const start = rng() * Math.PI * 2;
    const span = 0.45 + rng() * 1.2;
    const depth = (rng() - 0.5) * 5.5;
    for (let segment = 0; segment < segments; segment += 1) {
      const first = start + span * (segment / segments);
      const second = start + span * ((segment + 1) / segments);
      positions.push(
        Math.cos(first) * radius,
        Math.sin(first) * radius * eccentricity,
        depth + Math.sin(first * 2.0) * 0.35,
        Math.cos(second) * radius,
        Math.sin(second) * radius * eccentricity,
        depth + Math.sin(second * 2.0) * 0.35,
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  geometry.userData.flow = 'curved-orbital-streaks';
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
