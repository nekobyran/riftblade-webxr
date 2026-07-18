import * as THREE from 'three';

const DEFAULT_THEME = Object.freeze({
  key: 'cosmic',
  primary: 0x54e8ff,
  secondary: 0xc45cff,
  accent: 0xff77d7,
  deep: 0x02030f,
  nebula: 0x2734a8,
  planet: 0x7298ff,
});

const THEME_PALETTES = Object.freeze({
  neon: { primary: 0x44e7ff, secondary: 0xff3df5, accent: 0x43d9ff, deep: 0x070014, nebula: 0x3f1d79, planet: 0x7278ff },
  magma: { primary: 0xff8a20, secondary: 0xffc04d, accent: 0xff542e, deep: 0x110303, nebula: 0x5f1705, planet: 0xff804d },
  orbit: { primary: 0x8be9ff, secondary: 0xd4a8ff, accent: 0xa1f7ff, deep: 0x02141f, nebula: 0x0c4366, planet: 0xa6dfff },
  sakura: { primary: 0xff9fce, secondary: 0xff6fb7, accent: 0x9df4ff, deep: 0x10051d, nebula: 0x5b1e58, planet: 0xffb2d4 },
  abyss: { primary: 0x176b99, secondary: 0x00f5d4, accent: 0x258dff, deep: 0x00040b, nebula: 0x002945, planet: 0x18a9b9 },
  solar: { primary: 0xff9b38, secondary: 0xffb12e, accent: 0xfff1a6, deep: 0x160404, nebula: 0x8d2008, planet: 0xffd463 },
  ice: { primary: 0x9be8ff, secondary: 0xbceeff, accent: 0x7b8cff, deep: 0x030d1d, nebula: 0x174b72, planet: 0xd9fbff },
  jungle: { primary: 0x76e65e, secondary: 0x8cff4f, accent: 0xffdc55, deep: 0x031109, nebula: 0x145127, planet: 0xb6ff6c },
  desert: { primary: 0xffb85c, secondary: 0xff8e3c, accent: 0x70e7ff, deep: 0x1c0808, nebula: 0x9b3c19, planet: 0xffd080 },
  void: { primary: 0x914dff, secondary: 0xe854ff, accent: 0x59fff2, deep: 0x010105, nebula: 0x18052f, planet: 0xb044ff },
});

const STAR_LAYERS = Object.freeze([
  { name: 'near', radius: [8, 17], count: [360, 92], pointSize: 9.2, opacity: 0.96, speed: 0.0062, drift: 0.24, role: 'primary' },
  { name: 'mid', radius: [17, 28], count: [680, 170], pointSize: 7.4, opacity: 0.82, speed: 0.0032, drift: 0.13, role: 'secondary' },
  { name: 'far', radius: [28, 39], count: [1080, 270], pointSize: 6.1, opacity: 0.7, speed: 0.00135, drift: 0.055, role: 'accent' },
]);

const NEBULA_CLOUDS = Object.freeze([
  { position: [-12, 8, -24], scale: [6.8, 3.1, 4.2], role: 'nebula', phase: 0.4 },
  { position: [13, 4, -29], scale: [7.5, 4.4, 3.1], role: 'secondary', phase: 2.1 },
  { position: [0, 14, -34], scale: [9.5, 2.8, 3.8], role: 'primary', phase: 4.2 },
]);

/**
 * Resolve either a RhythmGame theme object or a theme key into the compact
 * palette consumed by the procedural sky. The returned palette contains only
 * numeric sRGB colors so it is safe to pass between game and test code.
 */
export function resolveCosmicTheme(theme = DEFAULT_THEME) {
  const source = typeof theme === 'string' ? { key: theme } : theme || {};
  const key = String(source.key || 'cosmic').toLowerCase();
  const preset = THEME_PALETTES[key] || DEFAULT_THEME;
  const sky = Array.isArray(source.sky) ? source.sky : [];
  return {
    key,
    primary: colorHex(source.primary ?? source.grid, preset.primary),
    secondary: colorHex(source.secondary ?? source.bloom, preset.secondary),
    accent: colorHex(source.accent, preset.accent),
    deep: colorHex(source.deep ?? source.fog ?? sky[0], preset.deep),
    nebula: colorHex(source.nebula ?? sky[1], preset.nebula),
    planet: colorHex(source.planet ?? sky[2], preset.planet),
  };
}

/**
 * A texture-free, procedural 3D universe that can live inside the existing
 * environment sphere. Three spherical star shells provide real head-motion
 * parallax, while shader particles form soft star dust and nebulae.
 */
export class CosmicBackdrop {
  constructor({ theme = DEFAULT_THEME, lowPower = false, reducedMotion = false, seed = 0x51a7c05 } = {}) {
    this.lowPower = Boolean(lowPower);
    this.reducedMotion = Boolean(reducedMotion);
    this.seed = normalizeSeed(seed);
    this.theme = resolveCosmicTheme(theme);
    this.disposed = false;
    this.group = new THREE.Group();
    this.group.name = 'cosmic-backdrop';
    this.group.userData.procedural = true;
    this.group.userData.textureFree = true;
    this.starLayers = [];
    this.nebulae = [];
    this.celestialBodies = [];
    this._materials = [];
    this._rng = mulberry32(this.seed);

    this._buildStarLayers();
    this._buildStardust();
    this._buildNebulae();
    this._buildDistantPlanet();
    this._buildRingGalaxy();
    this.setTheme(this.theme);
  }

  setTheme(theme) {
    if (this.disposed) return this;
    this.theme = resolveCosmicTheme(theme);
    for (const material of this._materials) {
      const role = material.userData.cosmicColorRole || 'primary';
      const color = this.theme[role] ?? this.theme.primary;
      if (material.uniforms?.tint?.value?.setHex) material.uniforms.tint.value.setHex(color);
      else material.color?.setHex?.(color);
    }
    return this;
  }

  /**
   * Updates beat breathing and deterministic slow parallax. Absolute elapsed
   * time is used rather than frame deltas, so a paused tab cannot accumulate a
   * large jump when it resumes.
   */
  update(elapsed = 0, beatPulse = 0) {
    if (this.disposed) return false;
    const time = Math.max(0, finiteNumber(elapsed));
    const beat = THREE.MathUtils.clamp(finiteNumber(beatPulse), 0, 1);
    const motion = this.reducedMotion ? 0 : this.lowPower ? 0.48 : 1;
    const breathe = 1 + beat * (this.reducedMotion ? 0.025 : this.lowPower ? 0.07 : 0.14);

    for (const layer of this.starLayers) {
      const { baseRotation, speed, drift, phase } = layer.userData;
      layer.rotation.set(
        baseRotation.x + Math.sin(time * speed * 0.71 + phase) * speed * 5.5 * motion,
        baseRotation.y + time * speed * motion,
        baseRotation.z + Math.cos(time * speed * 0.43 + phase) * speed * 3.2 * motion,
      );
      layer.position.x = Math.sin(time * speed * 1.7 + phase) * drift * motion;
      layer.position.y = Math.cos(time * speed * 1.11 + phase) * drift * 0.45 * motion;
      if (layer.material.uniforms?.pulse) layer.material.uniforms.pulse.value = breathe;
    }

    if (this.stardust) {
      const base = this.stardust.userData.baseRotation;
      this.stardust.rotation.y = base.y - time * 0.0018 * motion;
      this.stardust.position.z = Math.sin(time * 0.09) * 0.16 * motion;
      this.stardust.material.uniforms.pulse.value = 1 + beat * (this.reducedMotion ? 0.018 : 0.1);
    }

    for (const cloud of this.nebulae) {
      const { baseScale, phase } = cloud.userData;
      const drift = Math.sin(time * 0.045 + phase);
      cloud.rotation.z = cloud.userData.baseRotationZ + time * 0.0011 * motion * (phase % 2 > 1 ? -1 : 1);
      cloud.position.x = cloud.userData.basePosition.x + drift * 0.22 * motion;
      const scale = 1 + beat * (this.reducedMotion ? 0.008 : 0.032) + drift * 0.008 * motion;
      cloud.scale.copy(baseScale).multiplyScalar(scale);
      cloud.material.uniforms.pulse.value = 1 + beat * (this.reducedMotion ? 0.025 : 0.18);
    }

    if (this.planet) {
      this.planet.rotation.y = this.planet.userData.baseRotationY + time * 0.0032 * motion;
      const halo = this.planet.getObjectByName('cosmic-planet-halo');
      if (halo) halo.material.opacity = halo.userData.baseOpacity * (1 + beat * 0.34);
    }
    if (this.galaxy) {
      this.galaxy.rotation.z = this.galaxy.userData.baseRotationZ + time * 0.004 * motion;
      const stars = this.galaxy.getObjectByName('cosmic-galaxy-stars');
      if (stars?.material.uniforms?.pulse) stars.material.uniforms.pulse.value = breathe;
      const core = this.galaxy.getObjectByName('cosmic-galaxy-core');
      if (core) core.scale.setScalar(1 + beat * (this.reducedMotion ? 0.015 : 0.075));
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
    this.starLayers.length = 0;
    this.nebulae.length = 0;
    this.celestialBodies.length = 0;
    this._materials.length = 0;
    this.stardust = null;
    this.planet = null;
    this.galaxy = null;
  }

  _buildStarLayers() {
    for (let index = 0; index < STAR_LAYERS.length; index += 1) {
      const config = STAR_LAYERS[index];
      const count = config.count[this.lowPower ? 1 : 0];
      const geometry = createSphericalParticleGeometry(count, config.radius[0], config.radius[1], this._rng);
      const material = this._registerMaterial(createParticleMaterial({
        color: this.theme[config.role],
        pointSize: config.pointSize * (this.lowPower ? 0.95 : 1),
        opacity: config.opacity,
        soft: false,
      }), config.role);
      const points = new THREE.Points(geometry, material);
      points.name = `cosmic-stars-${config.name}`;
      points.frustumCulled = false;
      points.renderOrder = -18 + index;
      points.userData.layer = config.name;
      points.userData.parallaxDepth = index;
      points.userData.speed = config.speed;
      points.userData.drift = config.drift;
      points.userData.phase = this._rng() * Math.PI * 2;
      points.userData.baseRotation = new THREE.Euler(this._rng() * 0.1, this._rng() * Math.PI * 2, this._rng() * 0.08);
      points.rotation.copy(points.userData.baseRotation);
      this.starLayers.push(points);
      this.group.add(points);
    }
  }

  _buildStardust() {
    const count = this.lowPower ? 84 : 440;
    const geometry = createBoxParticleGeometry(count, new THREE.Vector3(28, 18, 38), this._rng);
    const material = this._registerMaterial(createParticleMaterial({
      color: this.theme.accent,
      pointSize: this.lowPower ? 6.2 : 7.2,
      opacity: this.lowPower ? 0.38 : 0.4,
      soft: true,
    }), 'accent');
    const points = new THREE.Points(geometry, material);
    points.name = 'cosmic-stardust';
    points.position.set(0, 6, -15);
    points.userData.baseRotation = new THREE.Euler(0.08, 0, -0.12);
    points.rotation.copy(points.userData.baseRotation);
    points.renderOrder = -12;
    this.stardust = points;
    this.group.add(points);
  }

  _buildNebulae() {
    const count = this.lowPower ? 46 : this.reducedMotion ? 120 : 190;
    NEBULA_CLOUDS.forEach((config, index) => {
      const geometry = createCloudGeometry(count, this._rng);
      const material = this._registerMaterial(createParticleMaterial({
        color: this.theme[config.role],
        pointSize: this.lowPower ? 40 : 48,
        opacity: this.lowPower ? 0.18 : 0.2,
        soft: true,
      }), config.role);
      const cloud = new THREE.Points(geometry, material);
      cloud.name = `cosmic-nebula-${index + 1}`;
      cloud.position.set(...config.position);
      cloud.scale.set(...config.scale);
      cloud.rotation.z = (index - 1) * 0.27;
      cloud.frustumCulled = false;
      cloud.renderOrder = -20;
      cloud.userData.phase = config.phase;
      cloud.userData.basePosition = cloud.position.clone();
      cloud.userData.baseScale = cloud.scale.clone();
      cloud.userData.baseRotationZ = cloud.rotation.z;
      this.nebulae.push(cloud);
      this.group.add(cloud);
    });
  }

  _buildDistantPlanet() {
    const group = new THREE.Group();
    group.name = 'cosmic-distant-planet';
    group.position.set(-13.5, 9.5, -29.5);
    group.rotation.set(-0.18, 0.38, -0.13);
    group.userData.baseRotationY = group.rotation.y;

    const coreMaterial = this._registerMaterial(new THREE.MeshBasicMaterial({
      color: this.theme.planet,
      transparent: true,
      opacity: 0.82,
      fog: false,
      toneMapped: false,
    }), 'planet');
    const core = new THREE.Mesh(new THREE.SphereGeometry(3.35, this.lowPower ? 18 : 32, this.lowPower ? 12 : 22), coreMaterial);
    core.name = 'cosmic-planet-core';

    const haloMaterial = this._registerMaterial(new THREE.MeshBasicMaterial({
      color: this.theme.secondary,
      transparent: true,
      opacity: this.lowPower ? 0.16 : 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
      toneMapped: false,
    }), 'secondary');
    const halo = new THREE.Mesh(new THREE.SphereGeometry(3.72, this.lowPower ? 16 : 28, this.lowPower ? 10 : 18), haloMaterial);
    halo.name = 'cosmic-planet-halo';
    halo.userData.baseOpacity = haloMaterial.opacity;

    const ringMaterial = this._registerMaterial(new THREE.MeshBasicMaterial({
      color: this.theme.accent,
      transparent: true,
      opacity: this.lowPower ? 0.34 : 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    }), 'accent');
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.6, 5.7, this.lowPower ? 40 : 96), ringMaterial);
    ring.name = 'cosmic-planet-ring';
    ring.rotation.set(1.12, 0.12, 0.28);
    group.add(halo, core, ring);
    this.planet = group;
    this.celestialBodies.push(group);
    this.group.add(group);
  }

  _buildRingGalaxy() {
    const group = new THREE.Group();
    group.name = 'cosmic-ring-galaxy';
    group.position.set(15, 8.2, -31);
    group.rotation.set(0.23, -0.31, 0.2);
    group.userData.baseRotationZ = group.rotation.z;

    const galaxyGeometry = createGalaxyGeometry(this.lowPower ? 120 : 520, this._rng);
    const galaxyMaterial = this._registerMaterial(createParticleMaterial({
      color: this.theme.primary,
      pointSize: this.lowPower ? 8.4 : 9.2,
      opacity: this.lowPower ? 0.68 : 0.8,
      soft: true,
    }), 'primary');
    const stars = new THREE.Points(galaxyGeometry, galaxyMaterial);
    stars.name = 'cosmic-galaxy-stars';
    stars.frustumCulled = false;

    const ringMaterial = this._registerMaterial(new THREE.MeshBasicMaterial({
      color: this.theme.secondary,
      transparent: true,
      opacity: this.lowPower ? 0.26 : 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }), 'secondary');
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.8, this.lowPower ? 0.035 : 0.055, 6, this.lowPower ? 48 : 96), ringMaterial);
    ring.name = 'cosmic-galaxy-ring';

    const coreMaterial = this._registerMaterial(new THREE.MeshBasicMaterial({
      color: this.theme.accent,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }), 'accent');
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.55, this.lowPower ? 10 : 18, this.lowPower ? 7 : 12), coreMaterial);
    core.name = 'cosmic-galaxy-core';
    group.add(stars, ring, core);
    this.galaxy = group;
    this.celestialBodies.push(group);
    this.group.add(group);
  }

  _registerMaterial(material, role) {
    material.userData.cosmicColorRole = role;
    this._materials.push(material);
    return material;
  }
}

function createParticleMaterial({ color, pointSize, opacity, soft }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tint: { value: new THREE.Color(color) },
      pointSize: { value: pointSize },
      opacity: { value: opacity },
      pulse: { value: 1 },
      softness: { value: soft ? 1 : 0 },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aTint;
      varying float vTint;
      uniform float pointSize;
      uniform float pulse;
      void main() {
        vTint = aTint;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        float attenuation = max(1.0, -viewPosition.z * 0.16);
        gl_PointSize = pointSize * aSize * pulse / attenuation;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      varying float vTint;
      uniform vec3 tint;
      uniform float opacity;
      uniform float pulse;
      uniform float softness;
      void main() {
        vec2 delta = gl_PointCoord - vec2(0.5);
        float distanceFromCenter = length(delta) * 2.0;
        if (distanceFromCenter > 1.0) discard;
        float crisp = 1.0 - smoothstep(0.28, 1.0, distanceFromCenter);
        float soft = pow(max(0.0, 1.0 - distanceFromCenter), 2.2);
        float alpha = mix(crisp, soft, softness) * opacity * min(1.18, pulse);
        vec3 color = mix(vec3(1.0), tint, clamp(vTint, 0.18, 1.0));
        gl_FragColor = vec4(color, alpha);
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

function createSphericalParticleGeometry(count, minRadius, maxRadius, rng) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const tints = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const z = rng() * 2 - 1;
    const angle = rng() * Math.PI * 2;
    const planar = Math.sqrt(Math.max(0, 1 - z * z));
    const radius = minRadius + Math.cbrt(rng()) * (maxRadius - minRadius);
    positions[index * 3] = Math.cos(angle) * planar * radius;
    positions[index * 3 + 1] = z * radius;
    positions[index * 3 + 2] = Math.sin(angle) * planar * radius;
    sizes[index] = 0.55 + rng() * 0.78 + (rng() > 0.975 ? 0.9 : 0);
    tints[index] = 0.22 + rng() * 0.78;
  }
  return particleGeometry(positions, sizes, tints);
}

function createBoxParticleGeometry(count, extent, rng) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const tints = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (rng() - 0.5) * extent.x;
    positions[index * 3 + 1] = (rng() - 0.5) * extent.y;
    positions[index * 3 + 2] = (rng() - 0.5) * extent.z;
    sizes[index] = 0.45 + rng() * 0.9;
    tints[index] = 0.38 + rng() * 0.62;
  }
  return particleGeometry(positions, sizes, tints);
}

function createCloudGeometry(count, rng) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const tints = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const radius = Math.min(2.35, Math.abs(gaussian(rng)) * 0.58 + rng() * 0.32);
    const angle = rng() * Math.PI * 2;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = gaussian(rng) * 0.34;
    positions[index * 3 + 2] = Math.sin(angle) * radius * 0.45 + gaussian(rng) * 0.14;
    sizes[index] = 0.55 + rng() * 1.25;
    tints[index] = 0.55 + rng() * 0.45;
  }
  return particleGeometry(positions, sizes, tints);
}

function createGalaxyGeometry(count, rng) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const tints = new Float32Array(count);
  const arms = 3;
  for (let index = 0; index < count; index += 1) {
    const progress = Math.pow(rng(), 0.62);
    const radius = 0.35 + progress * 4.3;
    const arm = index % arms;
    const angle = arm * (Math.PI * 2 / arms) + progress * Math.PI * 3.1 + gaussian(rng) * 0.13;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = Math.sin(angle) * radius * 0.46;
    positions[index * 3 + 2] = gaussian(rng) * (0.18 + progress * 0.08);
    sizes[index] = 0.55 + rng() * 1.05;
    tints[index] = 0.28 + rng() * 0.72;
  }
  return particleGeometry(positions, sizes, tints);
}

function particleGeometry(positions, sizes, tints) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function gaussian(rng) {
  const first = Math.max(1e-7, rng());
  const second = rng();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(Math.PI * 2 * second);
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
