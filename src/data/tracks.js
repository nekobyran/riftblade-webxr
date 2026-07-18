import { CutDirection, Hand } from '../shared/contracts.js';

const LANES = Object.freeze([-1.5, -0.5, 0.5, 1.5]);
// Runtime rendering exposes two ergonomically safe strike heights in both XR and touch modes.
const ROWS = Object.freeze([0, 1]);
const DIRECTIONS = Object.freeze([
  CutDirection.DOWN,
  CutDirection.UP,
  CutDirection.LEFT,
  CutDirection.RIGHT,
  CutDirection.DOWN_LEFT,
  CutDirection.DOWN_RIGHT,
  CutDirection.UP_LEFT,
  CutDirection.UP_RIGHT,
]);

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const roundTime = (value) => Number(value.toFixed(3));

const hashSeed = (text) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const mulberry32 = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = (items, index) => items[((index % items.length) + items.length) % items.length];

export const TRACKS = deepFreeze([
  {
    id: 'neon-tide-run',
    title: 'Neon Tide Run',
    artist: 'RIFT//BLADE Ensemble',
    bpm: 132,
    duration: 78,
    previewStart: 17.4,
    metadata: {
      titleZh: '霓虹潮汐',
      style: 'liquid synthwave sprint',
      difficulty: 'cruiser',
      energy: 0.72,
      description: 'Bright arpeggios surf over a rubbery analog bass line and rolling hand-clap backbeat.',
      unlockHint: 'Default training route through the coast-side data current.',
    },
    palette: {
      background: '#071527',
      horizon: '#2de2e6',
      primary: '#ff3cac',
      secondary: '#784ba0',
      bladeLeft: '#5cf2ff',
      bladeRight: '#ff7ad9',
      warning: '#fff275',
    },
    environment: {
      theme: 'neon-ocean',
      biome: 'rain-slick neon causeway',
      sky: 'indigo storm ceiling with cyan lightning veins',
      floor: 'mirror-black glass lanes with magenta wave reflections',
      landmarks: ['tidal hologram pylons', 'low-poly moon buoys', 'distant skyline equalizer'],
      fog: { color: '#12324d', density: 0.42, pulseRate: 0.5 },
      particles: { type: 'water sparks', color: '#2de2e6', density: 0.64, speed: 0.75 },
      lighting: { key: '#2de2e6', rim: '#ff3cac', exposure: 1.05 },
    },
    damageStyle: {
      name: 'static surf crackle',
      hitColor: '#5cf2ff',
      missColor: '#ff3cac',
      vignette: '#250019',
      cameraKick: 0.18,
      haptics: [18, 22, 34],
      shader: { aberration: 0.35, scanlineBurst: 0.52, dropletSmear: 0.4 },
    },
    music: {
      profile: 'neon-liquid',
      seed: 'neon-tide-run-v1',
      key: 'F# minor',
      scale: ['F#', 'A', 'B', 'C#', 'E'],
      swing: 0.06,
      groove: 'four-on-the-floor with offbeat clap splashes',
      instruments: {
        lead: { wave: 'sawtooth', octave: 5, envelope: [0.005, 0.08, 0.42, 0.12], pattern: 'rising tide arpeggio' },
        bass: { wave: 'triangle', octave: 2, envelope: [0.004, 0.1, 0.78, 0.2], pattern: 'syncopated undertow' },
        pad: { wave: 'sine', octave: 3, envelope: [0.4, 1.2, 0.55, 1.4], pattern: 'wide suspended shimmer' },
        percussion: { kick: 'short sine thump', snare: 'pink-noise splash', hats: 'filtered glass ticks' },
      },
      arrangement: [
        { section: 'wake', from: 0, to: 16, intensity: 0.52, motif: [0, 2, 4, 2] },
        { section: 'current', from: 16, to: 40, intensity: 0.74, motif: [0, 1, 3, 4, 3, 1] },
        { section: 'breaker', from: 40, to: 62, intensity: 0.9, motif: [4, 3, 2, 0, 2, 4, 1, 3] },
        { section: 'afterglow', from: 62, to: 78, intensity: 0.68, motif: [0, 2, 1, 4] },
      ],
      recipe: {
        noteStrideBeats: 0.5,
        chordEveryBeats: 8,
        accentEveryBeats: 4,
        laneMotion: 'sine-crossing mirrored hands',
        rowMotion: 'wave crest low-mid-high',
        densityCurve: [0.5, 0.68, 0.9, 0.62],
      },
    },
  },
  {
    id: 'ember-circuit-choir',
    title: 'Ember Circuit Choir',
    artist: 'RIFT//BLADE Ensemble',
    bpm: 104,
    duration: 84,
    previewStart: 24,
    metadata: {
      titleZh: '余烬回路圣咏',
      style: 'industrial ritual downtempo',
      difficulty: 'sentinel',
      energy: 0.66,
      description: 'Granular choir pads, furnace drums, and heavy sub pulses form a ceremonial machine march.',
      unlockHint: 'Stabilize the forge gate without overheating the shields.',
    },
    palette: {
      background: '#140b08',
      horizon: '#ff8a00',
      primary: '#ff3d00',
      secondary: '#ffd166',
      bladeLeft: '#ffb703',
      bladeRight: '#fb5607',
      warning: '#9b2226',
    },
    environment: {
      theme: 'ember-forge',
      biome: 'subterranean forge cathedral',
      sky: 'black vaulted roof crossed by molten cable constellations',
      floor: 'basalt plates separated by orange heat seams',
      landmarks: ['choir-reactor columns', 'slow piston arches', 'ash halo portals'],
      fog: { color: '#3d1308', density: 0.58, pulseRate: 0.31 },
      particles: { type: 'embers and soot glyphs', color: '#ff8a00', density: 0.72, speed: 0.38 },
      lighting: { key: '#ff6d00', rim: '#ffd166', exposure: 0.92 },
    },
    damageStyle: {
      name: 'molten armor fracture',
      hitColor: '#ffd166',
      missColor: '#ff3d00',
      vignette: '#2b0500',
      cameraKick: 0.28,
      haptics: [35, 18, 45, 20],
      shader: { aberration: 0.18, heatWarp: 0.7, emberBurst: 0.62 },
    },
    music: {
      profile: 'forge-ritual',
      seed: 'ember-circuit-choir-v1',
      key: 'D Phrygian',
      scale: ['D', 'Eb', 'F', 'G', 'A', 'Bb', 'C'],
      swing: 0.12,
      groove: 'half-time furnace stomp with triplet ghost hits',
      instruments: {
        lead: { wave: 'square', octave: 4, envelope: [0.01, 0.16, 0.36, 0.2], pattern: 'call-and-response brass sparks' },
        bass: { wave: 'sawtooth', octave: 1, envelope: [0.008, 0.18, 0.86, 0.32], pattern: 'descending anvil drone' },
        pad: { wave: 'triangle', octave: 2, envelope: [0.8, 1.8, 0.7, 2.1], pattern: 'granular choir cluster' },
        percussion: { kick: 'deep bloom hammer', snare: 'gated ash plate', hats: 'chain-link triplets' },
      },
      arrangement: [
        { section: 'ignition', from: 0, to: 20, intensity: 0.48, motif: [0, 1, 3, 1] },
        { section: 'procession', from: 20, to: 44, intensity: 0.67, motif: [3, 2, 0, 1, 5] },
        { section: 'overheat', from: 44, to: 68, intensity: 0.86, motif: [6, 5, 3, 1, 0, 2] },
        { section: 'cinders', from: 68, to: 84, intensity: 0.6, motif: [0, 3, 1, 0] },
      ],
      recipe: {
        noteStrideBeats: 0.75,
        chordEveryBeats: 6,
        accentEveryBeats: 3,
        laneMotion: 'heavy pendulum with center feints',
        rowMotion: 'low forge strikes rising into choir answers',
        densityCurve: [0.42, 0.61, 0.84, 0.57],
      },
    },
  },
  {
    id: 'glass-orbit-monsoon',
    title: 'Glass Orbit Monsoon',
    artist: 'RIFT//BLADE Ensemble',
    bpm: 148,
    duration: 92,
    previewStart: 31.2,
    metadata: {
      titleZh: '玻璃轨道季风',
      style: 'zero-g tabla drum and bass',
      difficulty: 'vanguard',
      energy: 0.88,
      description: 'Fast liquid breaks orbit bell melodies while monsoon drones bend around a crystalline station.',
      unlockHint: 'Ride the outer ring and keep both blades in counter-rotation.',
    },
    palette: {
      background: '#030712',
      horizon: '#a7f3d0',
      primary: '#38bdf8',
      secondary: '#c084fc',
      bladeLeft: '#a7f3d0',
      bladeRight: '#f0abfc',
      warning: '#facc15',
    },
    environment: {
      theme: 'glass-orbit',
      biome: 'orbital rain garden',
      sky: 'star field refracted through rotating glass petals',
      floor: 'transparent hex-ring track over storm clouds',
      landmarks: ['monsoon turbine halos', 'floating bell shards', 'aurora data ribbons'],
      fog: { color: '#0f2a44', density: 0.36, pulseRate: 0.76 },
      particles: { type: 'raindrop prisms', color: '#a7f3d0', density: 0.82, speed: 1.05 },
      lighting: { key: '#38bdf8', rim: '#c084fc', exposure: 1.12 },
    },
    damageStyle: {
      name: 'crystal pressure shatter',
      hitColor: '#a7f3d0',
      missColor: '#c084fc',
      vignette: '#090426',
      cameraKick: 0.22,
      haptics: [12, 12, 28, 12, 44],
      shader: { aberration: 0.55, prismSplit: 0.76, rainRipple: 0.5 },
    },
    music: {
      profile: 'orbit-breaks',
      seed: 'glass-orbit-monsoon-v1',
      key: 'A Lydian dominant',
      scale: ['A', 'B', 'C#', 'D#', 'E', 'F#', 'G'],
      swing: 0.03,
      groove: '170-feel broken beat phrased at 148 BPM with tabla rolls',
      instruments: {
        lead: { wave: 'sine', octave: 6, envelope: [0.002, 0.05, 0.34, 0.18], pattern: 'orbiting glass bell canon' },
        bass: { wave: 'square', octave: 2, envelope: [0.004, 0.08, 0.72, 0.16], pattern: 'reese-like counter-rotation' },
        pad: { wave: 'sawtooth', octave: 3, envelope: [0.5, 1.1, 0.45, 1.6], pattern: 'monsoon pressure drone' },
        percussion: { kick: 'tight sub drop', snare: 'cracked rim prism', hats: 'tabla rain rolls' },
      },
      arrangement: [
        { section: 'airlock', from: 0, to: 18, intensity: 0.58, motif: [0, 3, 4, 6] },
        { section: 'spin-up', from: 18, to: 42, intensity: 0.78, motif: [6, 4, 2, 5, 3, 1] },
        { section: 'monsoon break', from: 42, to: 74, intensity: 0.96, motif: [0, 2, 5, 6, 4, 1, 3, 5] },
        { section: 'deorbit', from: 74, to: 92, intensity: 0.74, motif: [5, 3, 1, 0, 4] },
      ],
      recipe: {
        noteStrideBeats: 0.375,
        chordEveryBeats: 7.5,
        accentEveryBeats: 3.75,
        laneMotion: 'counter-rotating orbital spirals',
        rowMotion: 'tabla roll staircases and zero-g drops',
        densityCurve: [0.58, 0.78, 0.96, 0.72],
      },
    },
  },
  {
    id: 'sakura-ion-reverie',
    title: 'Sakura Ion Reverie',
    artist: 'RIFT//BLADE Ensemble',
    bpm: 126,
    duration: 86,
    previewStart: 22.8,
    metadata: {
      titleZh: '樱离子梦',
      style: 'future kagura and luminous garage',
      difficulty: 'cruiser',
      energy: 0.7,
      description: 'Plucked pentatonic phrases bloom into warm future-garage chords, brushed drums, and a singing sub line.',
      unlockHint: 'Follow the falling petals until the shrine gate resolves from light.',
    },
    palette: {
      background: '#160d25',
      horizon: '#ffb7d5',
      primary: '#ff6fb5',
      secondary: '#8b7dff',
      bladeLeft: '#ffd6e8',
      bladeRight: '#9d8cff',
      warning: '#fff1a8',
    },
    environment: {
      theme: 'sakura',
      biome: 'floating ion blossom shrine',
      sky: 'violet dawn crossed by slow aurora calligraphy',
      floor: 'lacquer-black mirror steps over a luminous cloud sea',
      landmarks: ['petal torii procession', 'holographic bell trees', 'moonlit koi constellations'],
      fog: { color: '#3b1f55', density: 0.4, pulseRate: 0.44 },
      particles: { type: 'charged sakura petals', color: '#ffb7d5', density: 0.78, speed: 0.44 },
      lighting: { key: '#ff8fc8', rim: '#8b7dff', exposure: 1.04 },
    },
    damageStyle: {
      name: 'petal seal rupture',
      hitColor: '#ffd6e8',
      missColor: '#8b7dff',
      vignette: '#280b31',
      cameraKick: 0.14,
      haptics: [14, 10, 24, 16],
      shader: { aberration: 0.22, petalScatter: 0.76, inkBloom: 0.42 },
    },
    music: {
      profile: 'sakura-garage',
      seed: 'sakura-ion-reverie-v2',
      key: 'C# pentatonic minor',
      scale: ['C#', 'E', 'F#', 'G#', 'B'],
      swing: 0.15,
      groove: 'two-step garage with brushed kagura accents',
      instruments: {
        lead: { wave: 'triangle', octave: 5, envelope: [0.003, 0.1, 0.38, 0.24], pattern: 'petal-shaped pentatonic replies' },
        bass: { wave: 'sine', octave: 2, envelope: [0.006, 0.16, 0.82, 0.28], pattern: 'warm two-step sub answers' },
        pad: { wave: 'sawtooth', octave: 3, envelope: [0.5, 1.4, 0.62, 1.8], pattern: 'softly detuned suspended lantern chords' },
        percussion: { kick: 'rounded silk kick', snare: 'brushed wood clap', hats: 'petal shaker lattice' },
      },
      arrangement: [
        { section: 'first blossom', from: 0, to: 18, intensity: 0.44, motif: [0, 2, 1, 4] },
        { section: 'lantern walk', from: 18, to: 42, intensity: 0.69, motif: [0, 3, 4, 2, 1] },
        { section: 'ion bloom', from: 42, to: 70, intensity: 0.91, motif: [4, 2, 3, 0, 1, 3] },
        { section: 'petals home', from: 70, to: 86, intensity: 0.58, motif: [2, 1, 0, 4] },
      ],
      recipe: {
        noteStrideBeats: 0.5,
        chordEveryBeats: 8,
        accentEveryBeats: 4,
        laneMotion: 'soft crossing fans and mirrored petal arcs',
        rowMotion: 'floating low-high calligraphy strokes',
        densityCurve: [0.43, 0.66, 0.9, 0.55],
      },
    },
  },
  {
    id: 'abyss-rail-frenzy',
    title: 'Abyss Rail Frenzy',
    artist: 'RIFT//BLADE Ensemble',
    bpm: 174,
    duration: 80,
    previewStart: 27.5,
    metadata: {
      titleZh: '深渊轨道狂潮',
      style: 'neuro drum and bass trench run',
      difficulty: 'apex',
      energy: 0.97,
      description: 'Precision breaks and a growling elastic bass tear through a bioluminescent deep-sea transit tube.',
      unlockHint: 'Keep the rail core stable while the trench wakes around you.',
    },
    palette: {
      background: '#02070d',
      horizon: '#00f5d4',
      primary: '#00bbf9',
      secondary: '#f15bb5',
      bladeLeft: '#00f5d4',
      bladeRight: '#f15bb5',
      warning: '#fee440',
    },
    environment: {
      theme: 'abyss',
      biome: 'hadal maglev tunnel',
      sky: 'black ocean pressure field alive with colossal silhouettes',
      floor: 'transparent acceleration rail above volcanic vents',
      landmarks: ['leviathan pulse ribs', 'sonar gate rings', 'bioluminescent cable forests'],
      fog: { color: '#001d2d', density: 0.68, pulseRate: 0.94 },
      particles: { type: 'plankton data sparks', color: '#00f5d4', density: 0.9, speed: 1.25 },
      lighting: { key: '#00bbf9', rim: '#f15bb5', exposure: 1.08 },
    },
    damageStyle: {
      name: 'pressure hull implosion',
      hitColor: '#00f5d4',
      missColor: '#f15bb5',
      vignette: '#000914',
      cameraKick: 0.34,
      haptics: [10, 8, 18, 8, 36, 12],
      shader: { aberration: 0.68, pressureRing: 0.88, sonarTear: 0.7 },
    },
    music: {
      profile: 'abyss-neuro',
      seed: 'abyss-rail-frenzy-v2',
      key: 'E harmonic minor',
      scale: ['E', 'F#', 'G', 'A', 'B', 'C', 'D#'],
      swing: 0.02,
      groove: 'tight two-step breaks with sixteenth-note neuro bass edits',
      instruments: {
        lead: { wave: 'square', octave: 5, envelope: [0.002, 0.04, 0.26, 0.08], pattern: 'sonar alarm fragments' },
        bass: { wave: 'sawtooth', octave: 1, envelope: [0.003, 0.08, 0.92, 0.18], pattern: 'formant rail growl' },
        pad: { wave: 'sine', octave: 2, envelope: [0.8, 1.5, 0.5, 2.3], pattern: 'submerged pressure chord' },
        percussion: { kick: 'compressed rail punch', snare: 'wide pressure crack', hats: 'surgical titanium spray' },
      },
      arrangement: [
        { section: 'sonar lock', from: 0, to: 14, intensity: 0.56, motif: [0, 4, 2, 6] },
        { section: 'rail launch', from: 14, to: 34, intensity: 0.82, motif: [0, 2, 5, 3, 6, 1] },
        { section: 'leviathan', from: 34, to: 66, intensity: 1, motif: [6, 4, 1, 5, 2, 0, 3, 6] },
        { section: 'surface burn', from: 66, to: 80, intensity: 0.78, motif: [5, 3, 1, 0] },
      ],
      recipe: {
        noteStrideBeats: 0.375,
        chordEveryBeats: 8,
        accentEveryBeats: 2,
        laneMotion: 'high-speed rail switches and hand alternation',
        rowMotion: 'compressed breakbeat staircases',
        densityCurve: [0.58, 0.82, 0.98, 0.75],
      },
    },
  },
  {
    id: 'helios-lift',
    title: 'Helios Lift',
    artist: 'RIFT//BLADE Ensemble',
    bpm: 124,
    duration: 88,
    previewStart: 32,
    metadata: {
      titleZh: '日神升空',
      style: 'progressive solar house anthem',
      difficulty: 'vanguard',
      energy: 0.84,
      description: 'A patient filtered pulse rises into radiant major-seventh chords and a soaring solar-plasma hook.',
      unlockHint: 'Climb the corona elevator before the dawn flare peaks.',
    },
    palette: {
      background: '#110b03',
      horizon: '#ffd166',
      primary: '#ff9f1c',
      secondary: '#ff4d6d',
      bladeLeft: '#fff3b0',
      bladeRight: '#ff758f',
      warning: '#ffffff',
    },
    environment: {
      theme: 'solar',
      biome: 'solar corona elevator',
      sky: 'gold plasma ocean curled around a newborn horizon',
      floor: 'ascending prism bridge with radiant energy ribs',
      landmarks: ['corona lift rings', 'sunspot obelisks', 'wing-shaped flare collectors'],
      fog: { color: '#5c2606', density: 0.34, pulseRate: 0.52 },
      particles: { type: 'solar motes and flare ribbons', color: '#ffd166', density: 0.76, speed: 0.82 },
      lighting: { key: '#fff3b0', rim: '#ff4d6d', exposure: 1.2 },
    },
    damageStyle: {
      name: 'corona shield flare',
      hitColor: '#fff3b0',
      missColor: '#ff4d6d',
      vignette: '#421000',
      cameraKick: 0.2,
      haptics: [16, 24, 16, 36],
      shader: { aberration: 0.24, bloomFlash: 0.9, flareArc: 0.74 },
    },
    music: {
      profile: 'solar-house',
      seed: 'helios-lift-v2',
      key: 'B major',
      scale: ['B', 'C#', 'D#', 'E', 'F#', 'G#', 'A#'],
      swing: 0.04,
      groove: 'progressive four-on-the-floor with rising offbeat bass',
      instruments: {
        lead: { wave: 'sawtooth', octave: 5, envelope: [0.008, 0.13, 0.48, 0.28], pattern: 'wide ascending corona hook' },
        bass: { wave: 'square', octave: 2, envelope: [0.005, 0.1, 0.78, 0.2], pattern: 'pumping offbeat solar pulse' },
        pad: { wave: 'sawtooth', octave: 3, envelope: [0.35, 1.2, 0.65, 1.5], pattern: 'radiant major-seventh lift' },
        percussion: { kick: 'deep clean club kick', snare: 'sunburst clap stack', hats: 'open corona breath' },
      },
      arrangement: [
        { section: 'blue hour', from: 0, to: 20, intensity: 0.4, motif: [0, 2, 4, 6] },
        { section: 'first light', from: 20, to: 44, intensity: 0.68, motif: [0, 4, 2, 5, 3] },
        { section: 'corona rise', from: 44, to: 72, intensity: 0.94, motif: [0, 2, 4, 6, 5, 3, 1] },
        { section: 'golden orbit', from: 72, to: 88, intensity: 0.7, motif: [4, 2, 1, 0] },
      ],
      recipe: {
        noteStrideBeats: 0.5,
        chordEveryBeats: 8,
        accentEveryBeats: 4,
        laneMotion: 'ascending mirrored wings',
        rowMotion: 'steady lift into broad chorus sweeps',
        densityCurve: [0.4, 0.66, 0.93, 0.68],
      },
    },
  },
  {
    id: 'cryo-cathedral-lullaby',
    title: 'Cryo Cathedral Lullaby',
    artist: 'RIFT//BLADE Ensemble',
    bpm: 92,
    duration: 96,
    previewStart: 35,
    metadata: {
      titleZh: '冰晶圣堂摇篮曲',
      style: 'glacial trip-hop chamber ambient',
      difficulty: 'drifter',
      energy: 0.52,
      description: 'Felt-glass keys, distant choir harmonics, and a patient trip-hop heartbeat echo through blue ice.',
      unlockHint: 'Wake the sleeping archive without cracking its frozen choir.',
    },
    palette: {
      background: '#030b1c',
      horizon: '#a8dadc',
      primary: '#48cae4',
      secondary: '#b8c0ff',
      bladeLeft: '#caf0f8',
      bladeRight: '#c8b6ff',
      warning: '#fefae0',
    },
    environment: {
      theme: 'ice',
      biome: 'frozen memory cathedral',
      sky: 'deep blue vault filled with slow crystalline auroras',
      floor: 'translucent ice nave above dormant star archives',
      landmarks: ['frost organ pillars', 'suspended memory candles', 'faceted whale-song windows'],
      fog: { color: '#0a2a4d', density: 0.54, pulseRate: 0.24 },
      particles: { type: 'snow code and breath crystals', color: '#caf0f8', density: 0.6, speed: 0.2 },
      lighting: { key: '#90e0ef', rim: '#c8b6ff', exposure: 0.94 },
    },
    damageStyle: {
      name: 'frost memory fracture',
      hitColor: '#caf0f8',
      missColor: '#b8c0ff',
      vignette: '#06132d',
      cameraKick: 0.1,
      haptics: [22, 42, 18],
      shader: { aberration: 0.15, frostVein: 0.84, breathBlur: 0.52 },
    },
    music: {
      profile: 'cryo-trip',
      seed: 'cryo-cathedral-lullaby-v2',
      key: 'G Dorian',
      scale: ['G', 'A', 'Bb', 'C', 'D', 'E', 'F'],
      swing: 0.18,
      groove: 'slow trip-hop pocket with spacious ghost percussion',
      instruments: {
        lead: { wave: 'sine', octave: 5, envelope: [0.01, 0.2, 0.44, 0.48], pattern: 'felt-glass lullaby questions' },
        bass: { wave: 'triangle', octave: 1, envelope: [0.01, 0.3, 0.8, 0.55], pattern: 'patient glacial heartbeat' },
        pad: { wave: 'sine', octave: 3, envelope: [1.2, 2.4, 0.72, 3.2], pattern: 'cathedral choir overtones' },
        percussion: { kick: 'soft snowbound thud', snare: 'distant ice clap', hats: 'granular frost whisper' },
      },
      arrangement: [
        { section: 'snow hush', from: 0, to: 24, intensity: 0.3, motif: [0, 4, 2, 1] },
        { section: 'memory candles', from: 24, to: 50, intensity: 0.5, motif: [0, 2, 5, 3] },
        { section: 'choir thaw', from: 50, to: 78, intensity: 0.72, motif: [4, 5, 2, 0, 3] },
        { section: 'blue sleep', from: 78, to: 96, intensity: 0.4, motif: [3, 1, 0, 4] },
      ],
      recipe: {
        noteStrideBeats: 0.625,
        chordEveryBeats: 8,
        accentEveryBeats: 4,
        laneMotion: 'slow chapel pendulums',
        rowMotion: 'breathing arcs with quiet low rests',
        densityCurve: [0.3, 0.48, 0.7, 0.38],
      },
    },
  },
  {
    id: 'jade-canopy-heartbeat',
    title: 'Jade Canopy Heartbeat',
    artist: 'RIFT//BLADE Ensemble',
    bpm: 118,
    duration: 82,
    previewStart: 20,
    metadata: {
      titleZh: '翡翠天幕心跳',
      style: 'organic jungle electro and hand-drum funk',
      difficulty: 'sentinel',
      energy: 0.76,
      description: 'Living hand drums converse with wooden mallets, elastic bass, and a bright canopy whistle motif.',
      unlockHint: 'Match the pulse of the colossal seed reactor.',
    },
    palette: {
      background: '#04130d',
      horizon: '#80ed99',
      primary: '#2dc653',
      secondary: '#00b4d8',
      bladeLeft: '#b7efc5',
      bladeRight: '#48cae4',
      warning: '#ffd60a',
    },
    environment: {
      theme: 'jungle',
      biome: 'sentient rainforest reactor',
      sky: 'layered emerald canopy opening onto a turquoise nebula',
      floor: 'woven root circuit suspended over glowing water',
      landmarks: ['breathing seed towers', 'vine percussion arches', 'hummingbird light swarms'],
      fog: { color: '#0b3d2a', density: 0.46, pulseRate: 0.61 },
      particles: { type: 'pollen fireflies', color: '#80ed99', density: 0.86, speed: 0.58 },
      lighting: { key: '#80ed99', rim: '#00b4d8', exposure: 1.02 },
    },
    damageStyle: {
      name: 'thorn pulse sting',
      hitColor: '#b7efc5',
      missColor: '#00b4d8',
      vignette: '#031f14',
      cameraKick: 0.17,
      haptics: [12, 20, 12, 30, 12],
      shader: { aberration: 0.2, vineSnap: 0.72, pollenBurst: 0.82 },
    },
    music: {
      profile: 'jade-organic',
      seed: 'jade-canopy-heartbeat-v2',
      key: 'D Mixolydian',
      scale: ['D', 'E', 'F#', 'G', 'A', 'B', 'C'],
      swing: 0.11,
      groove: 'syncopated hand-drum funk over an organic electro pulse',
      instruments: {
        lead: { wave: 'triangle', octave: 5, envelope: [0.004, 0.08, 0.4, 0.2], pattern: 'canopy whistle and wooden mallet dialogue' },
        bass: { wave: 'sine', octave: 2, envelope: [0.005, 0.13, 0.84, 0.26], pattern: 'elastic root-network syncopation' },
        pad: { wave: 'triangle', octave: 3, envelope: [0.7, 1.4, 0.58, 2], pattern: 'breathing leaf harmonics' },
        percussion: { kick: 'hollow seed drum', snare: 'layered palm clap', hats: 'rattling pod shaker' },
      },
      arrangement: [
        { section: 'dew pulse', from: 0, to: 16, intensity: 0.42, motif: [0, 3, 1, 4] },
        { section: 'root dance', from: 16, to: 38, intensity: 0.68, motif: [0, 4, 2, 5, 3] },
        { section: 'canopy heart', from: 38, to: 66, intensity: 0.9, motif: [6, 4, 2, 0, 3, 5, 1] },
        { section: 'night pollen', from: 66, to: 82, intensity: 0.6, motif: [4, 2, 0, 3] },
      ],
      recipe: {
        noteStrideBeats: 0.5,
        chordEveryBeats: 6,
        accentEveryBeats: 3,
        laneMotion: 'hand-drum conversations across the canopy',
        rowMotion: 'root-level syncopation rising into bird calls',
        densityCurve: [0.42, 0.66, 0.9, 0.58],
      },
    },
  },
  {
    id: 'dune-crown-overture',
    title: 'Dune Crown Overture',
    artist: 'RIFT//BLADE Ensemble',
    bpm: 112,
    duration: 94,
    previewStart: 29,
    metadata: {
      titleZh: '沙冠序曲',
      style: 'cinematic desert electro overture',
      difficulty: 'vanguard',
      energy: 0.8,
      description: 'Low frame drums, bowed synth strings, and heroic modal brass climb a city-sized singing dune.',
      unlockHint: 'Raise the buried crown before the glass storm arrives.',
    },
    palette: {
      background: '#180b05',
      horizon: '#ffba49',
      primary: '#f77f00',
      secondary: '#9d4edd',
      bladeLeft: '#ffd166',
      bladeRight: '#c77dff',
      warning: '#e63946',
    },
    environment: {
      theme: 'desert',
      biome: 'singing desert megastructure',
      sky: 'copper eclipse wrapped in violet glass storms',
      floor: 'shifting geometric sand over buried royal circuitry',
      landmarks: ['colossal crown ribs', 'levitating sandstone choirs', 'stormglass banners'],
      fog: { color: '#5f260c', density: 0.52, pulseRate: 0.4 },
      particles: { type: 'gold sand and glass sparks', color: '#ffba49', density: 0.8, speed: 0.72 },
      lighting: { key: '#ffd166', rim: '#9d4edd', exposure: 1.06 },
    },
    damageStyle: {
      name: 'stormglass scouring',
      hitColor: '#ffd166',
      missColor: '#9d4edd',
      vignette: '#350c05',
      cameraKick: 0.3,
      haptics: [38, 16, 28, 16],
      shader: { aberration: 0.32, sandBlast: 0.78, glassScars: 0.66 },
    },
    music: {
      profile: 'dune-cinematic',
      seed: 'dune-crown-overture-v2',
      key: 'C Phrygian dominant',
      scale: ['C', 'Db', 'E', 'F', 'G', 'Ab', 'Bb'],
      swing: 0.08,
      groove: 'processional frame drums with cinematic electronic drive',
      instruments: {
        lead: { wave: 'sawtooth', octave: 4, envelope: [0.015, 0.2, 0.5, 0.34], pattern: 'heroic modal brass ascent' },
        bass: { wave: 'triangle', octave: 1, envelope: [0.007, 0.2, 0.9, 0.4], pattern: 'crown-sized pedal tones' },
        pad: { wave: 'sawtooth', octave: 2, envelope: [0.9, 1.8, 0.68, 2.5], pattern: 'bowed storm-string horizon' },
        percussion: { kick: 'low ceremonial frame drum', snare: 'sandstone ensemble strike', hats: 'glass-grain rattles' },
      },
      arrangement: [
        { section: 'buried sigil', from: 0, to: 22, intensity: 0.4, motif: [0, 1, 4, 2] },
        { section: 'crown ascent', from: 22, to: 48, intensity: 0.68, motif: [0, 2, 4, 5, 3] },
        { section: 'glass storm', from: 48, to: 78, intensity: 0.94, motif: [6, 4, 2, 0, 1, 3, 5] },
        { section: 'eclipse throne', from: 78, to: 94, intensity: 0.72, motif: [4, 3, 1, 0] },
      ],
      recipe: {
        noteStrideBeats: 0.5,
        chordEveryBeats: 6,
        accentEveryBeats: 3,
        laneMotion: 'monumental outward arcs and center strikes',
        rowMotion: 'low processional blows into heroic rises',
        densityCurve: [0.4, 0.67, 0.93, 0.7],
      },
    },
  },
  {
    id: 'pixel-void-overdrive',
    title: 'Pixel Void Overdrive',
    artist: 'RIFT//BLADE Ensemble',
    bpm: 160,
    duration: 76,
    previewStart: 18.5,
    metadata: {
      titleZh: '像素虚空超驰',
      style: 'chiptune hyperspace electro',
      difficulty: 'apex',
      energy: 0.93,
      description: 'Playful pulse-wave arpeggios, crunchy bit drums, and a huge modern sub race through a collapsing arcade cosmos.',
      unlockHint: 'Clear the final cartridge before the void reaches zero lives.',
    },
    palette: {
      background: '#070018',
      horizon: '#00f5ff',
      primary: '#ff00e5',
      secondary: '#7b2cff',
      bladeLeft: '#00f5ff',
      bladeRight: '#ff4ded',
      warning: '#f9f871',
    },
    environment: {
      theme: 'void',
      biome: 'collapsing arcade hyperspace',
      sky: 'voxel constellations folding into an infinite scanline tunnel',
      floor: 'reactive pixel grid with impossible perspective jumps',
      landmarks: ['boss-gate wireframes', 'orbiting score glyphs', 'glitch comet cartridges'],
      fog: { color: '#18004a', density: 0.44, pulseRate: 0.88 },
      particles: { type: 'pixel shrapnel and score stars', color: '#00f5ff', density: 0.92, speed: 1.2 },
      lighting: { key: '#00f5ff', rim: '#ff00e5', exposure: 1.1 },
    },
    damageStyle: {
      name: 'cartridge glitch crash',
      hitColor: '#00f5ff',
      missColor: '#ff00e5',
      vignette: '#21002d',
      cameraKick: 0.26,
      haptics: [8, 8, 8, 28, 8],
      shader: { aberration: 0.74, pixelSort: 0.94, scanlineBurst: 0.88 },
    },
    music: {
      profile: 'pixel-chip',
      seed: 'pixel-void-overdrive-v2',
      key: 'F minor',
      scale: ['F', 'G', 'Ab', 'Bb', 'C', 'Db', 'Eb'],
      swing: 0,
      groove: 'sixteenth-note arcade drive with halftime power accents',
      instruments: {
        lead: { wave: 'square', octave: 6, envelope: [0.001, 0.035, 0.28, 0.06], pattern: 'rapid coin-op arpeggio cascades' },
        bass: { wave: 'square', octave: 2, envelope: [0.002, 0.06, 0.78, 0.12], pattern: 'pulse-width boss bass' },
        pad: { wave: 'triangle', octave: 3, envelope: [0.18, 0.8, 0.48, 1.1], pattern: 'wide hyperspace continue chords' },
        percussion: { kick: 'bit-crushed power kick', snare: 'noise-register clap', hats: 'one-bit clock spray' },
      },
      arrangement: [
        { section: 'insert coin', from: 0, to: 14, intensity: 0.5, motif: [0, 2, 4, 6] },
        { section: 'stage rush', from: 14, to: 34, intensity: 0.78, motif: [0, 1, 4, 2, 6, 3] },
        { section: 'boss overdrive', from: 34, to: 62, intensity: 0.98, motif: [6, 4, 2, 5, 3, 1, 0, 4] },
        { section: 'high score', from: 62, to: 76, intensity: 0.76, motif: [4, 2, 1, 0] },
      ],
      recipe: {
        noteStrideBeats: 0.375,
        chordEveryBeats: 8,
        accentEveryBeats: 2,
        laneMotion: 'arcade zigzags and boss-pattern mirrors',
        rowMotion: 'rapid pixel stairs with power-note drops',
        densityCurve: [0.52, 0.78, 0.98, 0.74],
      },
    },
  },
]);

export function getTrack(id) {
  return TRACKS.find((track) => track.id === id);
}

const getSection = (track, time) =>
  track.music.arrangement.find((section) => time >= section.from && time < section.to) ??
  track.music.arrangement.at(-1);

function shouldEmit(track, beat, section, randomValue) {
  const recipe = track.music.recipe;
  const normalizedBeat = beat / (track.bpm / 60);
  const sectionProgress = clamp((normalizedBeat - section.from) / Math.max(0.001, section.to - section.from), 0, 1);
  const wave = 0.5 + Math.sin((beat * 0.73 + section.intensity * 3.1) * Math.PI) * 0.5;
  const density = clamp(section.intensity * 0.64 + wave * 0.24 + recipe.densityCurve[0] * 0.08, 0.25, 0.98);
  if (beat < 4) return beat % 1 === 0;
  if (sectionProgress > 0.82) return randomValue < density + 0.08;
  return randomValue < density;
}

function makeNote(track, time, index, beat, random) {
  const section = getSection(track, time);
  const motif = section.motif;
  const motifDegree = pick(motif, index + Math.floor(beat));
  const laneWave = Math.sin((beat * 0.41 + motifDegree * 0.37 + track.metadata.energy) * Math.PI);
  const laneBase = Math.round(((laneWave + 1) / 2) * (LANES.length - 1));
  const laneJitter = random() > 0.78 ? (random() > 0.5 ? 1 : -1) : 0;
  const lane = LANES[clamp(laneBase + laneJitter, 0, LANES.length - 1)];
  const row = ROWS[(motifDegree + index + Math.floor(beat / 2)) % ROWS.length];
  const hand = lane < 0 ? Hand.LEFT : Hand.RIGHT;
  const directionOffset = hand === Hand.LEFT ? 0 : 3;
  const direction = pick(DIRECTIONS, motifDegree + index + directionOffset + (row * 2));
  const beatRemainder = beat % track.music.recipe.accentEveryBeats;
  const accent = beatRemainder < 0.001 || track.music.recipe.accentEveryBeats - beatRemainder < 0.001 || random() > 0.9;

  return {
    id: `${track.id}-${String(index).padStart(4, '0')}`,
    time: roundTime(time),
    lane,
    row,
    hand,
    direction,
    ...(accent ? { accent: true } : {}),
  };
}

export function createBeatmap(trackOrId) {
  if (trackOrId && typeof trackOrId === 'object' && Array.isArray(trackOrId.beatmap)) {
    const trackId = trackOrId.id || 'custom-rift';
    return trackOrId.beatmap
      .filter((note) => Number.isFinite(note?.time) && Number.isFinite(note?.lane))
      .map((note, index) => {
        const lane = LANES.reduce((nearest, candidate) =>
          Math.abs(candidate - note.lane) < Math.abs(nearest - note.lane) ? candidate : nearest, LANES[0]);
        const row = clamp(Math.round(Number(note.row) || 0), 0, 1);
        return {
          ...note,
          time: roundTime(clamp(note.time, 0, Math.max(0, Number(trackOrId.duration) || note.time))),
          lane,
          row,
          hand: note.hand === Hand.LEFT || note.hand === Hand.RIGHT ? note.hand : lane < 0 ? Hand.LEFT : Hand.RIGHT,
          direction: DIRECTIONS.includes(note.direction) ? note.direction : pick(DIRECTIONS, index + row * 3 + LANES.indexOf(lane)),
        };
      })
      .sort((first, second) => first.time - second.time || first.lane - second.lane)
      .map((note, index) => ({ ...note, id: `${trackId}-${String(index).padStart(4, '0')}` }));
  }
  const track = typeof trackOrId === 'string' ? getTrack(trackOrId) : trackOrId;
  if (!track) {
    throw new Error(`Unknown track: ${String(trackOrId)}`);
  }

  const random = mulberry32(hashSeed(track.music.seed));
  const secondsPerBeat = 60 / track.bpm;
  const stride = track.music.recipe.noteStrideBeats;
  const notes = [];
  const lastBeat = Math.floor(((track.duration - 1.25) / secondsPerBeat) / stride) * stride;

  for (let beat = 4; beat <= lastBeat; beat = roundTime(beat + stride)) {
    const time = beat * secondsPerBeat;
    const section = getSection(track, time);
    const roll = random();
    if (!shouldEmit(track, beat, section, roll)) continue;

    notes.push(makeNote(track, time, notes.length, beat, random));

    const chordRemainder = beat % track.music.recipe.chordEveryBeats;
    const isChord = chordRemainder < 0.001 || track.music.recipe.chordEveryBeats - chordRemainder < 0.001;
    if (isChord && time + 0.045 < track.duration - 0.75) {
      const pair = makeNote(track, time + 0.045, notes.length, beat + 0.125, random);
      notes.push({
        ...pair,
        id: `${track.id}-${String(notes.length).padStart(4, '0')}`,
        lane: pair.lane < 0 ? Math.abs(pair.lane) : -pair.lane,
        hand: pair.hand === Hand.LEFT ? Hand.RIGHT : Hand.LEFT,
        direction: pair.direction === CutDirection.LEFT ? CutDirection.RIGHT : pair.direction === CutDirection.RIGHT ? CutDirection.LEFT : pair.direction,
        accent: true,
      });
    }
  }

  return notes
    .sort((first, second) => first.time - second.time || first.lane - second.lane)
    .map((note, index) => ({ ...note, id: `${track.id}-${String(index).padStart(4, '0')}` }));
}
