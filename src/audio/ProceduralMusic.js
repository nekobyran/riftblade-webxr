import { createBeatmap } from '../data/tracks.js';

const DEFAULT_LOOKAHEAD_SECONDS = 0.22;
const DEFAULT_TICK_MS = 60;

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

/**
 * Ten deliberately different arrangements. Every recipe has a drum pocket,
 * bass phrase, chord pad, and authored lead motif; the chart is therefore free
 * to stay gameplay data instead of becoming a second, duplicated synth layer.
 */
export const MUSIC_PROFILE_RECIPES = deepFreeze({
  'neon-liquid': {
    kicks: [0, 4, 8, 12], snares: [4, 12], hats: [1, 3, 5, 7, 9, 11, 13, 15],
    bass: [0, 3, 8, 11], bassDegrees: [0, 2, 3, 4], bassOctave: 2, bassWave: 'triangle', bassCutoff: 920,
    padEvery: 64, padDegrees: [0, 2, 4], padDuration: 3.5, padWave: 'sine',
    melody: [0, 2, 5, 7, 10, 13, 15], melodyDegrees: [0, 2, 4, 3, 2, 4, 1], melodySteps: 1.45, melodyLevel: 0.055,
  },
  'forge-ritual': {
    kicks: [0, 6, 10], snares: [8], hats: [3, 7, 11, 15],
    bass: [0, 8], bassDegrees: [0, 1, 5, 0], bassOctave: 1, bassWave: 'sawtooth', bassCutoff: 420, bassDuration: 0.46,
    padEvery: 32, padDegrees: [0, 2, 4], padDuration: 2.6, padWave: 'triangle',
    melody: [0, 6, 8, 14], melodyDegrees: [0, 1, 3, 5], melodySteps: 2.4, melodyLevel: 0.05,
    special: { type: 'metal', steps: [12], level: 0.12 },
  },
  'orbit-breaks': {
    kicks: [0, 6, 10], snares: [4, 12], hats: [1, 3, 5, 7, 9, 11, 13, 15],
    bass: [0, 4, 8, 12], bassDegrees: [0, 4, 2, 5], bassOctave: 2, bassWave: 'square', bassCutoff: 760,
    padEvery: 64, padDegrees: [0, 2, 4], padDuration: 3.8, padWave: 'sine',
    melody: [0, 3, 5, 7, 9, 11, 14], melodyDegrees: [0, 4, 2, 6, 5, 3, 1], melodySteps: 1.2, melodyLevel: 0.047,
    special: { type: 'tabla', steps: [2, 5, 11, 14], level: 0.07 },
  },
  'sakura-garage': {
    kicks: [0, 7, 10], snares: [4, 12], hats: [2, 5, 7, 10, 13, 15],
    bass: [0, 6, 10, 14], bassDegrees: [0, 3, 1, 4], bassOctave: 2, bassWave: 'sine', bassCutoff: 680, bassDuration: 0.3,
    padEvery: 32, padDegrees: [0, 2, 4, 1], padDuration: 2.9, padWave: 'sawtooth',
    melody: [0, 3, 6, 10, 13], melodyDegrees: [0, 2, 4, 3, 1], melodySteps: 1.75, melodyLevel: 0.052,
    special: { type: 'wood', steps: [3, 11], level: 0.055 },
  },
  'abyss-neuro': {
    kicks: [0, 3, 10], snares: [4, 12], hats: [1, 2, 5, 7, 9, 11, 13, 14, 15],
    bass: [0, 2, 6, 9, 11, 14], bassDegrees: [0, 0, 5, 2, 6, 1], bassOctave: 1, bassWave: 'sawtooth', bassCutoff: 540, bassDuration: 0.14,
    padEvery: 64, padDegrees: [0, 2, 5], padDuration: 2.7, padWave: 'sine',
    melody: [0, 2, 7, 9, 11, 14], melodyDegrees: [0, 6, 4, 1, 5, 2], melodySteps: 0.9, melodyLevel: 0.038,
    special: { type: 'sonar', steps: [7, 15], level: 0.045 },
  },
  'solar-house': {
    kicks: [0, 4, 8, 12], snares: [4, 12], hats: [2, 6, 10, 14], openHats: [6, 14],
    bass: [2, 6, 10, 14], bassDegrees: [0, 4, 5, 3], bassOctave: 2, bassWave: 'square', bassCutoff: 830, bassDuration: 0.24,
    padEvery: 32, padDegrees: [0, 2, 4, 6], padDuration: 3.4, padWave: 'sawtooth',
    melody: [0, 2, 4, 7, 8, 10, 12, 14], melodyDegrees: [0, 2, 4, 6, 5, 4, 2, 1], melodySteps: 1.6, melodyLevel: 0.056,
  },
  'cryo-trip': {
    kicks: [0, 10], snares: [8], hats: [3, 7, 11, 15],
    bass: [0, 7, 12], bassDegrees: [0, 3, 5], bassOctave: 1, bassWave: 'triangle', bassCutoff: 520, bassDuration: 0.52,
    padEvery: 32, padDegrees: [0, 2, 4, 6], padDuration: 5.2, padWave: 'sine',
    melody: [0, 6, 10, 14], melodyDegrees: [0, 4, 2, 5], melodySteps: 3.2, melodyLevel: 0.042,
    special: { type: 'ice', steps: [6, 14], level: 0.035 },
  },
  'jade-organic': {
    kicks: [0, 5, 10, 14], snares: [4, 12], hats: [2, 6, 9, 13, 15],
    bass: [0, 3, 7, 10, 13], bassDegrees: [0, 4, 2, 5, 3], bassOctave: 2, bassWave: 'sine', bassCutoff: 740, bassDuration: 0.28,
    padEvery: 48, padDegrees: [0, 2, 4], padDuration: 3.6, padWave: 'triangle',
    melody: [0, 3, 5, 8, 11, 13, 15], melodyDegrees: [0, 4, 2, 5, 3, 1, 4], melodySteps: 1.35, melodyLevel: 0.05,
    special: { type: 'tabla', steps: [1, 6, 11, 15], level: 0.06 },
  },
  'dune-cinematic': {
    kicks: [0, 6, 12], snares: [4, 10], hats: [3, 7, 11, 15],
    bass: [0, 6, 12], bassDegrees: [0, 4, 1, 5], bassOctave: 1, bassWave: 'triangle', bassCutoff: 480, bassDuration: 0.48,
    padEvery: 32, padDegrees: [0, 2, 4], padDuration: 4.4, padWave: 'sawtooth',
    melody: [0, 4, 7, 10, 14], melodyDegrees: [0, 1, 4, 5, 3], melodySteps: 2.5, melodyLevel: 0.052,
    special: { type: 'frame', steps: [2, 8, 14], level: 0.085 },
  },
  'pixel-chip': {
    kicks: [0, 4, 8, 11, 12], snares: [4, 12], hats: [1, 3, 5, 7, 9, 11, 13, 15],
    bass: [0, 2, 4, 7, 8, 10, 12, 14], bassDegrees: [0, 2, 4, 6, 5, 3, 1, 4], bassOctave: 2, bassWave: 'square', bassCutoff: 1150, bassDuration: 0.12,
    padEvery: 32, padDegrees: [0, 2, 4], padDuration: 2.1, padWave: 'triangle',
    melody: [0, 1, 2, 4, 6, 7, 8, 10, 12, 13, 15], melodyDegrees: [0, 2, 4, 6, 4, 2, 1, 3, 5, 6, 3], melodySteps: 0.72, melodyLevel: 0.033,
    special: { type: 'chip', steps: [6, 15], level: 0.04 },
  },
});

export const MUSIC_MASTERING = deepFreeze({
  synthBaseGain: 0.16,
  customBaseGain: 0.62,
  intensityFloor: 0.35,
  intensityScale: 0.65,
  compressor: { threshold: -18, knee: 12, ratio: 5, attack: 0.004, release: 0.16 },
  customCompressor: { threshold: -3, knee: 4, ratio: 2, attack: 0.012, release: 0.12 },
  limiter: { threshold: -1, knee: 0, ratio: 20, attack: 0.001, release: 0.08, ceilingDb: -1 },
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const hashSeed = (text) => {
  let hash = 2166136261;
  for (let index = 0; index < String(text).length; index += 1) {
    hash ^= String(text).charCodeAt(index);
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
const nowFromClock = (clock) => {
  if (clock && typeof clock.now === 'function') return clock.now() / 1000;
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now() / 1000;
  return Date.now() / 1000;
};

const midiForNote = (noteName, octave) => {
  const match = /^([A-G])(#|b)?/.exec(noteName);
  if (!match) return 69;
  const semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return (octave + 1) * 12 + semitones[match[1]] + accidental;
};

export function clampAudibleFrequency(value, sampleRate = 48000) {
  const nyquist = Math.max(1000, (Number(sampleRate) || 48000) * 0.5 - 1);
  return Math.min(20000, nyquist, Math.max(20, Number(value) || 440));
}

const DEFAULT_SCALE = Object.freeze(['A', 'B', 'C#', 'D', 'E', 'F#', 'G#']);

const frequencyForDegree = (track, degree, octave) => {
  const scale = track?.music?.scale?.length ? track.music.scale : DEFAULT_SCALE;
  const normalized = Math.round(degree);
  const wrapped = ((normalized % scale.length) + scale.length) % scale.length;
  const octaveShift = Math.floor(normalized / scale.length);
  const midi = midiForNote(scale[wrapped], octave + octaveShift);
  return clampAudibleFrequency(440 * 2 ** ((midi - 69) / 12));
};

const frequencyFor = (track, note) => {
  const scale = track?.music?.scale?.length ? track.music.scale : DEFAULT_SCALE;
  const lead = track?.music?.instruments?.lead ?? {};
  const octave = Number.isFinite(lead.octave) ? lead.octave : 4;
  const degree = Math.abs(Math.round(note.row * 2 + (note.lane + 1.5))) % scale.length;
  const midi = midiForNote(scale[degree], octave + (note.accent ? 1 : 0));
  return clampAudibleFrequency(440 * 2 ** ((midi - 69) / 12));
};

function safeCall(target, method, ...args) {
  try {
    if (target && typeof target[method] === 'function') return target[method](...args);
  } catch {
    // A partial Web Audio implementation should degrade silently rather than breaking gameplay.
  }
  return undefined;
}

export class ProceduralMusic {
  constructor({ eventTarget, audioContextFactory, clock, lookAheadSeconds = DEFAULT_LOOKAHEAD_SECONDS, tickMs = DEFAULT_TICK_MS } = {}) {
    this.eventTarget = eventTarget;
    this.audioContextFactory = audioContextFactory;
    this.clock = clock;
    this.lookAheadSeconds = lookAheadSeconds;
    this.tickMs = tickMs;

    this.context = null;
    this.masterGain = null;
    this.masterCompressor = null;
    this.masterLimiter = null;
    this.masterCeiling = null;
    this.track = null;
    this.beatmap = [];
    this.customBuffer = null;
    this.customSource = null;
    this.phase = 'stopped';
    this.offsetSeconds = 0;
    this.anchorSeconds = 0;
    this.scheduledIndex = 0;
    this.scheduledMusicStep = 0;
    this.timer = null;
    this.activeNodes = new Set();
    this.noiseBuffer = null;
    this.intensity = 1;
    this.muted = false;
    this.disposed = false;
  }

  start(track, offsetSeconds = 0) {
    this._clearTimer();
    this._stopActiveNodes();
    this.disposed = false;
    this.track = track;
    this.noiseBuffer = null;
    this.customBuffer = track?.audioBuffer ?? track?.customAudioBuffer ?? track?.audio?.buffer ?? null;
    try {
      this.beatmap = createBeatmap(track);
    } catch {
      this.beatmap = [];
    }
    const duration = Number(track?.duration) || Number(this.customBuffer?.duration) || 0;
    this.offsetSeconds = clamp(offsetSeconds, 0, Math.max(0, duration - 0.1));
    this._ensureAudioGraph();
    this._configureMastering();
    this.anchorSeconds = this._now();
    this.phase = 'playing';
    this.scheduledIndex = this._findScheduleIndex(this.offsetSeconds);
    this.scheduledMusicStep = this._findMusicStep(this.offsetSeconds);
    safeCall(this.context, 'resume');
    this._applyMasterLevel();
    this._startCustomSource();
    this._scheduleWindow();
    this._armTimer();
    return this;
  }

  pause() {
    if (this.phase !== 'playing') return this.getTime();
    this.offsetSeconds = this.getTime();
    this.phase = 'paused';
    this._clearTimer();
    this._stopActiveNodes();
    safeCall(this.context, 'suspend');
    return this.offsetSeconds;
  }

  resume() {
    if (this.phase !== 'paused' || !this.track) return this;
    this.anchorSeconds = this._now();
    this.phase = 'playing';
    this.scheduledIndex = this._findScheduleIndex(this.offsetSeconds);
    this.scheduledMusicStep = this._findMusicStep(this.offsetSeconds);
    safeCall(this.context, 'resume');
    this._startCustomSource();
    this._scheduleWindow();
    this._armTimer();
    return this;
  }

  stop() {
    this._clearTimer();
    this._stopActiveNodes();
    this.phase = 'stopped';
    this.offsetSeconds = 0;
    this.anchorSeconds = this._now();
    this.scheduledIndex = 0;
    this.scheduledMusicStep = 0;
    this.customSource = null;
    return this;
  }

  startCustom(audioBuffer, trackOrOptions = {}, offsetSeconds = 0) {
    const track = trackOrOptions?.id
      ? { ...trackOrOptions, audioBuffer, duration: Number(trackOrOptions.duration) || Number(audioBuffer?.duration) || 0 }
      : {
          id: 'custom-audio',
          title: trackOrOptions?.title || 'Custom Rift',
          artist: trackOrOptions?.artist || 'LOCAL // YOU',
          bpm: Number(trackOrOptions?.bpm) || 120,
          duration: Number(audioBuffer?.duration) || Number(trackOrOptions?.duration) || 0,
          beatmap: Array.isArray(trackOrOptions?.beatmap) ? trackOrOptions.beatmap : [],
          audioBuffer,
          music: { profile: 'custom-audio', scale: ['A'], instruments: { lead: { wave: 'sine', octave: 4 } } },
        };
    return this.start(track, offsetSeconds);
  }

  getTime() {
    if (!this.track) return 0;
    if (this.phase === 'playing') {
      return clamp(this.offsetSeconds + (this._now() - this.anchorSeconds), 0, this.track.duration);
    }
    if (this.phase === 'paused') return clamp(this.offsetSeconds, 0, this.track.duration);
    return 0;
  }

  setIntensity(value) {
    this.intensity = clamp(value, 0, 1.5);
    this._applyMasterLevel();
    return this;
  }

  setMuted(value) {
    this.muted = Boolean(value);
    this._applyMasterLevel();
    return this;
  }

  dispose() {
    this.stop();
    this.disposed = true;
    safeCall(this.context, 'close');
    this.context = null;
    this.masterGain = null;
    this.masterCompressor = null;
    this.masterLimiter = null;
    this.masterCeiling = null;
    this.track = null;
    this.beatmap = [];
    this.customBuffer = null;
    this.customSource = null;
    this.noiseBuffer = null;
    return this;
  }

  _now() {
    if (this.context && Number.isFinite(this.context.currentTime)) return this.context.currentTime;
    return nowFromClock(this.clock);
  }

  _ensureAudioGraph() {
    if (this.context || this.disposed) return;
    const ContextCtor = this.audioContextFactory ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!ContextCtor) return;

    try {
      this.context = new ContextCtor();
      if (typeof this.context.createGain === 'function') {
        this.masterGain = this.context.createGain();
        this.masterCompressor = safeCall(this.context, 'createDynamicsCompressor') ?? null;
        this.masterLimiter = safeCall(this.context, 'createDynamicsCompressor') ?? null;
        this.masterCeiling = safeCall(this.context, 'createWaveShaper') ?? null;
        if (this.masterCeiling) {
          const ceiling = 10 ** (MUSIC_MASTERING.limiter.ceilingDb / 20);
          this.masterCeiling.curve = Float32Array.from({ length: 4096 }, (_unused, index) => {
            const input = index / 2047.5 - 1;
            return clamp(input, -ceiling, ceiling);
          });
          this.masterCeiling.oversample = '4x';
        }

        let output = this.masterGain;
        if (this.masterCompressor) output = safeCall(output, 'connect', this.masterCompressor) ?? this.masterCompressor;
        if (this.masterLimiter) output = safeCall(output, 'connect', this.masterLimiter) ?? this.masterLimiter;
        if (this.masterCeiling) output = safeCall(output, 'connect', this.masterCeiling) ?? this.masterCeiling;
        safeCall(output, 'connect', this.context.destination);
      }
    } catch {
      this.context = null;
      this.masterGain = null;
      this.masterCompressor = null;
      this.masterLimiter = null;
      this.masterCeiling = null;
    }
  }

  _configureMastering() {
    const at = this.context?.currentTime || 0;
    const compressorConfig = this.customBuffer ? MUSIC_MASTERING.customCompressor : MUSIC_MASTERING.compressor;
    if (this.masterCompressor) {
      this.masterCompressor.threshold?.setValueAtTime?.(compressorConfig.threshold, at);
      this.masterCompressor.knee?.setValueAtTime?.(compressorConfig.knee, at);
      this.masterCompressor.ratio?.setValueAtTime?.(compressorConfig.ratio, at);
      this.masterCompressor.attack?.setValueAtTime?.(compressorConfig.attack, at);
      this.masterCompressor.release?.setValueAtTime?.(compressorConfig.release, at);
    }
    if (this.masterLimiter) {
      const limiterConfig = MUSIC_MASTERING.limiter;
      this.masterLimiter.threshold?.setValueAtTime?.(limiterConfig.threshold, at);
      this.masterLimiter.knee?.setValueAtTime?.(limiterConfig.knee, at);
      this.masterLimiter.ratio?.setValueAtTime?.(limiterConfig.ratio, at);
      this.masterLimiter.attack?.setValueAtTime?.(limiterConfig.attack, at);
      this.masterLimiter.release?.setValueAtTime?.(limiterConfig.release, at);
    }
  }

  _applyMasterLevel() {
    const base = this.customBuffer ? MUSIC_MASTERING.customBaseGain : MUSIC_MASTERING.synthBaseGain;
    const level = this.muted ? 0 : base * (MUSIC_MASTERING.intensityFloor + this.intensity * MUSIC_MASTERING.intensityScale);
    const gain = this.masterGain?.gain;
    if (!gain) return;
    const at = this.context?.currentTime ?? 0;
    if (typeof gain.setTargetAtTime === 'function') gain.setTargetAtTime(level, at, 0.015);
    else gain.value = level;
  }

  _startCustomSource() {
    if (!this.customBuffer || !this.context || !this.masterGain || this.phase !== 'playing' || this.customSource) return;
    const source = safeCall(this.context, 'createBufferSource');
    if (!source) return;
    source.buffer = this.customBuffer;
    safeCall(source, 'connect', this.masterGain);
    this.customSource = source;
    this.activeNodes.add(source);
    source.onended = () => {
      this.activeNodes.delete(source);
      if (this.customSource === source) this.customSource = null;
    };
    safeCall(source, 'start', this.context.currentTime ?? this._now(), clamp(this.offsetSeconds, 0, Math.max(0, this.customBuffer.duration - 0.02)));
  }

  _findScheduleIndex(time) {
    const guard = Math.max(0, time - 0.04);
    return this.beatmap.findIndex((note) => note.time >= guard) === -1
      ? this.beatmap.length
      : this.beatmap.findIndex((note) => note.time >= guard);
  }

  _findMusicStep(time) {
    const step = this._stepDuration();
    return Math.max(0, Math.floor(Math.max(0, time - 0.02) / step));
  }

  _stepDuration() {
    return 60 / (Number(this.track?.bpm) || 120) / 4;
  }

  _armTimer() {
    this._clearTimer();
    if (this.phase !== 'playing') return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this._scheduleWindow();
      if (this.phase === 'playing') this._armTimer();
    }, this.tickMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  _clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  _scheduleWindow() {
    if (this.phase !== 'playing' || !this.track) return;
    const trackTime = this.getTime();
    if (trackTime >= this.track.duration) {
      this.stop();
      return;
    }

    const horizon = Math.min(this.track.duration, trackTime + this.lookAheadSeconds * (0.85 + this.intensity * 0.3));
    if (this.customBuffer) {
      // The uploaded recording is already the complete arrangement. Do not layer
      // synthesized lead notes over music the player chose; gameplay consumes the
      // attached beatmap independently.
      while (this.scheduledIndex < this.beatmap.length && this.beatmap[this.scheduledIndex].time <= horizon) {
        this.scheduledIndex += 1;
      }
      return;
    }
    const stepDuration = this._stepDuration();
    while (this.scheduledMusicStep * stepDuration <= horizon) {
      const stepTime = this.scheduledMusicStep * stepDuration;
      if (stepTime >= trackTime - 0.025) {
        const when = (this.context?.currentTime ?? this._now()) + Math.max(0, stepTime - trackTime);
        this._scheduleMusicStep(this.scheduledMusicStep, stepTime, when);
      }
      this.scheduledMusicStep += 1;
    }
    while (this.scheduledIndex < this.beatmap.length && this.beatmap[this.scheduledIndex].time <= horizon) {
      // Chart notes drive blocks and scoring. The authored profile motif below is
      // the one musical lead, preventing dense charts from doubling the melody.
      this.scheduledIndex += 1;
    }
  }

  _scheduleMusicStep(stepIndex, trackTime, when) {
    if (!this.context || !this.masterGain || !this.track) return;
    const beatStep = stepIndex % 16;
    const beat = Math.floor(stepIndex / 4);
    const bar = Math.floor(stepIndex / 16);
    const section = this.track.music?.arrangement?.find((candidate) => trackTime >= candidate.from && trackTime < candidate.to)
      ?? this.track.music?.arrangement?.at?.(-1)
      ?? { intensity: 0.7, motif: [0, 2, 4, 1] };
    const energy = clamp(section.intensity * (0.55 + this.intensity * 0.45), 0.12, 1.35);
    const profile = this.track.music?.profile ?? 'neon-liquid';
    const pattern = MUSIC_PROFILE_RECIPES[profile] ?? MUSIC_PROFILE_RECIPES['neon-liquid'];
    const swing = clamp(Number(this.track.music?.swing) || 0, 0, 0.24);
    const swungWhen = when + (stepIndex % 2 === 1 ? this._stepDuration() * swing : 0);
    const motif = section.motif?.length ? section.motif : [0, 2, 4, 1];
    const harmonicRoot = motif[Math.floor(bar / 2) % motif.length] ?? 0;

    if (pattern.kicks.includes(beatStep)) {
      this._scheduleKick(swungWhen, (beatStep === 0 ? 0.72 : 0.58) * energy, beatStep === 0 ? 64 : 52);
    }
    if (pattern.snares.includes(beatStep) && energy > 0.28) {
      const lowSnare = profile === 'forge-ritual' || profile === 'dune-cinematic';
      this._scheduleNoise(swungWhen, (lowSnare ? 0.16 : 0.12) * energy, lowSnare ? 0.19 : 0.12, lowSnare ? 1050 : 2100, 'bandpass');
    }
    if (pattern.hats.includes(beatStep) && energy > 0.38) {
      const open = pattern.openHats?.includes(beatStep);
      this._scheduleNoise(swungWhen, (open ? 0.045 : 0.026) * energy, open ? 0.13 : 0.038, 5600 + (beatStep % 4) * 520, 'highpass');
    }

    const bassIndex = pattern.bass.indexOf(beatStep);
    if (bassIndex >= 0 && energy > 0.26) {
      const degree = (pattern.bassDegrees[(bassIndex + bar) % pattern.bassDegrees.length] ?? 0) + harmonicRoot;
      const bassFrequency = frequencyForDegree(this.track, degree, pattern.bassOctave ?? this.track.music?.instruments?.bass?.octave ?? 2);
      this._scheduleBass(
        swungWhen,
        bassFrequency,
        pattern.bassDuration ?? Math.min(0.3, this._stepDuration() * 1.7),
        0.105 * energy,
        pattern.bassWave ?? this.track.music?.instruments?.bass?.wave ?? 'triangle',
        pattern.bassCutoff ?? 760,
      );
    }

    if (stepIndex % pattern.padEvery === 0) {
      const padOctave = this.track.music?.instruments?.pad?.octave ?? 3;
      const chord = pattern.padDegrees.map((degree) => frequencyForDegree(this.track, degree + harmonicRoot, padOctave));
      this._schedulePad(swungWhen, chord, pattern.padDuration, 0.026 * energy, pattern.padWave ?? 'sine');
    }

    const melodyIndex = pattern.melody.indexOf(beatStep);
    if (melodyIndex >= 0 && energy > 0.24) {
      const degree = harmonicRoot + pattern.melodyDegrees[(melodyIndex + bar) % pattern.melodyDegrees.length];
      const lead = this.track.music?.instruments?.lead ?? {};
      const frequency = frequencyForDegree(this.track, degree, pattern.melodyOctave ?? lead.octave ?? 4);
      this._scheduleLead(
        swungWhen,
        frequency,
        this._stepDuration() * pattern.melodySteps,
        pattern.melodyLevel * energy,
        pattern.melodyWave ?? lead.wave ?? 'sine',
        lead.envelope,
      );
    }

    if (pattern.special?.steps.includes(beatStep) && energy > 0.42) {
      const level = pattern.special.level * energy;
      if (pattern.special.type === 'metal') this._scheduleMetalHit(swungWhen, 154 + (beat % 3) * 19, level);
      else if (pattern.special.type === 'tabla' || pattern.special.type === 'frame' || pattern.special.type === 'wood') {
        this._scheduleTabla(swungWhen, pattern.special.type === 'frame' ? 92 : 145 + beatStep * 5, level);
      } else if (pattern.special.type === 'sonar' || pattern.special.type === 'ice') {
        const octave = pattern.special.type === 'ice' ? 6 : 5;
        this._scheduleBell(swungWhen, frequencyForDegree(this.track, harmonicRoot + beatStep % 5, octave), level);
      } else if (pattern.special.type === 'chip') {
        this._scheduleBass(swungWhen, frequencyForDegree(this.track, beatStep % 7, 5), 0.075, level, 'square', 2800);
      }
    }
  }

  _scheduleLead(when, frequency, duration, level, wave = 'sine', envelope = undefined) {
    if (!this.context || !this.masterGain) return;
    const oscillator = safeCall(this.context, 'createOscillator');
    const gainNode = safeCall(this.context, 'createGain');
    const filter = safeCall(this.context, 'createBiquadFilter');
    if (!oscillator || !gainNode) return;

    oscillator.type = ['sine', 'triangle', 'sawtooth', 'square'].includes(wave) ? wave : 'sine';
    if (oscillator.frequency) {
      const audibleFrequency = clampAudibleFrequency(frequency, this.context?.sampleRate);
      if (typeof oscillator.frequency.setValueAtTime === 'function') oscillator.frequency.setValueAtTime(audibleFrequency, when);
      else oscillator.frequency.value = audibleFrequency;
    }

    if (filter) {
      filter.type = 'lowpass';
      if (filter.frequency) {
        const cutoff = 1900 + this.intensity * 1050;
        if (typeof filter.frequency.setValueAtTime === 'function') filter.frequency.setValueAtTime(cutoff, when);
        else filter.frequency.value = cutoff;
      }
      safeCall(oscillator, 'connect', filter);
      safeCall(filter, 'connect', gainNode);
    } else {
      safeCall(oscillator, 'connect', gainNode);
    }
    safeCall(gainNode, 'connect', this.masterGain);

    const gain = gainNode.gain;
    const shape = Array.isArray(envelope) ? envelope : [0.006, 0.08, 0.4, 0.14];
    const attack = clamp(Number(shape[0]) || 0.006, 0.002, 0.12);
    const release = clamp(Number(shape[3]) || 0.14, 0.07, 0.65);
    const audibleDuration = clamp(Math.max(duration, release), attack + 0.04, 0.72);
    const peak = clamp(level, 0.0001, 0.14);
    if (gain) {
      if (typeof gain.setValueAtTime === 'function') gain.setValueAtTime(0.0001, when);
      if (typeof gain.exponentialRampToValueAtTime === 'function') gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), when + attack);
      if (typeof gain.exponentialRampToValueAtTime === 'function') gain.exponentialRampToValueAtTime(0.0001, when + audibleDuration);
      else gain.value = peak;
    }

    this.activeNodes.add(oscillator);
    oscillator.onended = () => this.activeNodes.delete(oscillator);
    safeCall(oscillator, 'start', when);
    safeCall(oscillator, 'stop', when + audibleDuration + 0.02);
  }

  _scheduleNote(note, when) {
    const lead = this.track?.music?.instruments?.lead ?? {};
    this._scheduleLead(
      when,
      frequencyFor(this.track, note),
      note.accent ? 0.26 : 0.16,
      (note.accent ? 0.09 : 0.052) * (0.45 + this.intensity * 0.55),
      lead.wave,
      lead.envelope,
    );
  }

  _scheduleKick(when, level = 0.6, tailFrequency = 52) {
    const oscillator = safeCall(this.context, 'createOscillator');
    const gainNode = safeCall(this.context, 'createGain');
    if (!oscillator || !gainNode) return;
    oscillator.type = 'sine';
    oscillator.frequency?.setValueAtTime?.(155, when);
    oscillator.frequency?.exponentialRampToValueAtTime?.(Math.max(32, tailFrequency), when + 0.095);
    gainNode.gain?.setValueAtTime?.(Math.max(0.0001, 0.32 * level), when);
    gainNode.gain?.exponentialRampToValueAtTime?.(0.0001, when + 0.24);
    safeCall(oscillator, 'connect', gainNode);
    safeCall(gainNode, 'connect', this.masterGain);
    this._startNode(oscillator, when, when + 0.26);
  }

  _scheduleBass(when, frequency, duration, level, type = 'triangle', cutoff = 760) {
    const oscillator = safeCall(this.context, 'createOscillator');
    const gainNode = safeCall(this.context, 'createGain');
    const filter = safeCall(this.context, 'createBiquadFilter');
    if (!oscillator || !gainNode) return;
    oscillator.type = type;
    oscillator.frequency?.setValueAtTime?.(clampAudibleFrequency(frequency, this.context?.sampleRate), when);
    if (filter) {
      filter.type = 'lowpass';
      filter.frequency?.setValueAtTime?.(cutoff, when);
      safeCall(oscillator, 'connect', filter);
      safeCall(filter, 'connect', gainNode);
    } else safeCall(oscillator, 'connect', gainNode);
    safeCall(gainNode, 'connect', this.masterGain);
    gainNode.gain?.setValueAtTime?.(0.0001, when);
    gainNode.gain?.exponentialRampToValueAtTime?.(Math.max(0.0001, level), when + 0.012);
    gainNode.gain?.exponentialRampToValueAtTime?.(0.0001, when + duration);
    this._startNode(oscillator, when, when + duration + 0.025);
  }

  _schedulePad(when, frequencies, duration, level, type = 'sine') {
    const bus = safeCall(this.context, 'createGain');
    const filter = safeCall(this.context, 'createBiquadFilter');
    if (!bus) return;
    bus.gain?.setValueAtTime?.(0.0001, when);
    bus.gain?.exponentialRampToValueAtTime?.(Math.max(0.0001, level), when + 0.55);
    bus.gain?.exponentialRampToValueAtTime?.(0.0001, when + duration);
    if (filter) {
      filter.type = 'lowpass';
      filter.frequency?.setValueAtTime?.(1350, when);
      safeCall(bus, 'connect', filter);
      safeCall(filter, 'connect', this.masterGain);
    } else safeCall(bus, 'connect', this.masterGain);
    frequencies.forEach((frequency, index) => {
      const oscillator = safeCall(this.context, 'createOscillator');
      if (!oscillator) return;
      oscillator.type = type;
      oscillator.frequency?.setValueAtTime?.(clampAudibleFrequency(frequency, this.context?.sampleRate), when);
      if (oscillator.detune) oscillator.detune.value = (index - 1) * 5;
      safeCall(oscillator, 'connect', bus);
      this._startNode(oscillator, when, when + duration + 0.03);
    });
  }

  _scheduleNoise(when, level, duration, cutoff, filterType = 'bandpass') {
    const buffer = this._getNoiseBuffer();
    const source = safeCall(this.context, 'createBufferSource');
    const gainNode = safeCall(this.context, 'createGain');
    const filter = safeCall(this.context, 'createBiquadFilter');
    if (!buffer || !source || !gainNode) return;
    source.buffer = buffer;
    if (filter) {
      filter.type = filterType;
      filter.frequency?.setValueAtTime?.(cutoff, when);
      if (filter.Q) filter.Q.value = filterType === 'bandpass' ? 1.3 : 0.6;
      safeCall(source, 'connect', filter);
      safeCall(filter, 'connect', gainNode);
    } else safeCall(source, 'connect', gainNode);
    safeCall(gainNode, 'connect', this.masterGain);
    gainNode.gain?.setValueAtTime?.(Math.max(0.0001, level), when);
    gainNode.gain?.exponentialRampToValueAtTime?.(0.0001, when + duration);
    this._startNode(source, when, when + duration + 0.01);
  }

  _scheduleMetalHit(when, frequency, level) {
    [1, 1.414, 2.37].forEach((ratio, index) => {
      this._scheduleBass(when, frequency * ratio, 0.32 + index * 0.06, level / (index + 1), 'square', 3600);
    });
  }

  _scheduleTabla(when, frequency, level) {
    const oscillator = safeCall(this.context, 'createOscillator');
    const gainNode = safeCall(this.context, 'createGain');
    if (!oscillator || !gainNode) return;
    oscillator.type = 'sine';
    oscillator.frequency?.setValueAtTime?.(clampAudibleFrequency(frequency * 1.75, this.context?.sampleRate), when);
    oscillator.frequency?.exponentialRampToValueAtTime?.(clampAudibleFrequency(frequency, this.context?.sampleRate), when + 0.055);
    gainNode.gain?.setValueAtTime?.(Math.max(0.0001, level), when);
    gainNode.gain?.exponentialRampToValueAtTime?.(0.0001, when + 0.11);
    safeCall(oscillator, 'connect', gainNode);
    safeCall(gainNode, 'connect', this.masterGain);
    this._startNode(oscillator, when, when + 0.13);
  }

  _scheduleBell(when, frequency, level) {
    [1, 2.01, 3.98].forEach((ratio, index) => {
      const oscillator = safeCall(this.context, 'createOscillator');
      const gainNode = safeCall(this.context, 'createGain');
      if (!oscillator || !gainNode) return;
      oscillator.type = index === 0 ? 'sine' : 'triangle';
      oscillator.frequency?.setValueAtTime?.(clampAudibleFrequency(frequency * ratio, this.context?.sampleRate), when);
      const partialLevel = Math.max(0.0001, level / (1 + index * 1.8));
      gainNode.gain?.setValueAtTime?.(partialLevel, when);
      gainNode.gain?.exponentialRampToValueAtTime?.(0.0001, when + 0.48 + index * 0.12);
      safeCall(oscillator, 'connect', gainNode);
      safeCall(gainNode, 'connect', this.masterGain);
      this._startNode(oscillator, when, when + 0.64 + index * 0.12);
    });
  }

  _startNode(node, startAt, stopAt) {
    this.activeNodes.add(node);
    node.onended = () => this.activeNodes.delete(node);
    safeCall(node, 'start', startAt);
    safeCall(node, 'stop', stopAt);
  }

  _getNoiseBuffer() {
    if (this.noiseBuffer) return this.noiseBuffer;
    if (!this.context?.createBuffer) return null;
    try {
      const sampleRate = this.context.sampleRate || 44100;
      const buffer = this.context.createBuffer(1, sampleRate, sampleRate);
      const channel = buffer.getChannelData(0);
      const random = mulberry32(hashSeed(this.track?.music?.seed ?? this.track?.id ?? 'riftblade-noise'));
      let previous = 0;
      for (let index = 0; index < channel.length; index += 1) {
        const white = random() * 2 - 1;
        previous = previous * 0.82 + white * 0.18;
        channel[index] = white * 0.7 + previous * 0.3;
      }
      this.noiseBuffer = buffer;
      return buffer;
    } catch {
      return null;
    }
  }

  _stopActiveNodes() {
    for (const node of this.activeNodes) safeCall(node, 'stop', 0);
    this.activeNodes.clear();
    this.customSource = null;
  }
}
