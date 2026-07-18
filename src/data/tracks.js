import { CutDirection, Hand } from '../shared/contracts.js';

const LANES = Object.freeze([-1.5, -0.5, 0.5, 1.5]);
const ROWS = Object.freeze([0, 1, 2]);
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
