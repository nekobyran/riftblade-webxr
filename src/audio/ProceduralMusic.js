import { createBeatmap } from '../data/tracks.js';

const DEFAULT_LOOKAHEAD_SECONDS = 0.22;
const DEFAULT_TICK_MS = 60;

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
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

const frequencyFor = (track, note) => {
  const scale = track?.music?.scale?.length ? track.music.scale : ['A'];
  const lead = track?.music?.instruments?.lead ?? {};
  const octave = Number.isFinite(lead.octave) ? lead.octave : 4;
  const degree = Math.abs(Math.round(note.row * 2 + (note.lane + 1.5))) % scale.length;
  const midi = midiForNote(scale[degree], octave + (note.accent ? 1 : 0));
  return 440 * 2 ** ((midi - 69) / 12);
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
    this.track = null;
    this.beatmap = [];
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
    this.beatmap = createBeatmap(track);
    this.offsetSeconds = clamp(offsetSeconds, 0, Math.max(0, track.duration - 0.1));
    this._ensureAudioGraph();
    this.anchorSeconds = this._now();
    this.phase = 'playing';
    this.scheduledIndex = this._findScheduleIndex(this.offsetSeconds);
    this.scheduledMusicStep = this._findMusicStep(this.offsetSeconds);
    safeCall(this.context, 'resume');
    this._applyMasterLevel();
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
    return this;
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
    this.track = null;
    this.beatmap = [];
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
        safeCall(this.masterGain, 'connect', this.context.destination);
      }
    } catch {
      this.context = null;
      this.masterGain = null;
    }
  }

  _applyMasterLevel() {
    const level = this.muted ? 0 : 0.18 * (0.35 + this.intensity * 0.65);
    const gain = this.masterGain?.gain;
    if (!gain) return;
    const at = this.context?.currentTime ?? 0;
    if (typeof gain.setTargetAtTime === 'function') gain.setTargetAtTime(level, at, 0.015);
    else gain.value = level;
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

    const horizon = trackTime + this.lookAheadSeconds * (0.85 + this.intensity * 0.3);
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
      const note = this.beatmap[this.scheduledIndex];
      const when = (this.context?.currentTime ?? this._now()) + Math.max(0, note.time - trackTime);
      this._scheduleNote(note, when);
      this.scheduledIndex += 1;
    }
  }

  _scheduleMusicStep(stepIndex, trackTime, when) {
    if (!this.context || !this.masterGain || !this.track) return;
    const id = this.track.id;
    const beatStep = stepIndex % 16;
    const beat = Math.floor(stepIndex / 4);
    const section = this.track.music?.arrangement?.find((candidate) => trackTime >= candidate.from && trackTime < candidate.to)
      ?? this.track.music?.arrangement?.at?.(-1)
      ?? { intensity: 0.7, motif: [0, 2, 4, 1] };
    const energy = clamp(section.intensity * (0.55 + this.intensity * 0.45), 0.12, 1.35);

    if (id === 'ember-circuit-choir') {
      if ([0, 6, 10].includes(beatStep)) this._scheduleKick(when, 0.82 * energy, beatStep === 0 ? 58 : 48);
      if (beatStep === 8) this._scheduleNoise(when, 0.19 * energy, 0.22, 920, 'bandpass');
      if ([3, 7, 11, 15].includes(beatStep)) this._scheduleNoise(when, 0.055 * energy, 0.055, 3100, 'highpass');
      if (beatStep % 8 === 0) this._scheduleBass(when, 36.7 * (beatStep === 8 ? 1.122 : 1), 0.46, 0.2 * energy, 'sawtooth', 420);
      if (stepIndex % 32 === 0) this._schedulePad(when, [73.42, 87.31, 110], 2.6, 0.045 * energy, 'triangle');
      if (beatStep === 12) this._scheduleMetalHit(when, 176 + (beat % 3) * 22, 0.13 * energy);
      return;
    }

    if (id === 'glass-orbit-monsoon') {
      if ([0, 6, 10].includes(beatStep)) this._scheduleKick(when, 0.72 * energy, beatStep === 0 ? 72 : 54);
      if ([4, 12].includes(beatStep)) this._scheduleNoise(when, 0.18 * energy, 0.14, 1850, 'bandpass');
      if ([1, 3, 5, 7, 9, 11, 13, 15].includes(beatStep)) this._scheduleNoise(when, 0.035 * energy, 0.035, 5900 + (beatStep % 4) * 800, 'highpass');
      if ([2, 5, 11, 14].includes(beatStep)) this._scheduleTabla(when, 155 + beatStep * 7, 0.075 * energy);
      if (beatStep % 4 === 0) this._scheduleBass(when, beat % 4 === 3 ? 61.74 : 55, 0.2, 0.13 * energy, 'square', 760);
      if (stepIndex % 64 === 0) this._schedulePad(when, [110, 138.59, 164.81], 3.8, 0.032 * energy, 'sine');
      return;
    }

    // Neon Tide Run: a bright four-on-the-floor pulse with syncopated glass hats.
    if (beatStep % 4 === 0) this._scheduleKick(when, 0.66 * energy, beatStep === 0 ? 68 : 58);
    if ([4, 12].includes(beatStep)) this._scheduleNoise(when, 0.15 * energy, 0.12, 2200, 'bandpass');
    if (beatStep % 2 === 1) this._scheduleNoise(when, 0.03 * energy, 0.035, 7200, 'highpass');
    if ([0, 3, 8, 11].includes(beatStep)) {
      const bassDegrees = [46.25, 55, 61.74, 69.3];
      this._scheduleBass(when, bassDegrees[(beat + beatStep) % bassDegrees.length], 0.19, 0.12 * energy, 'triangle', 920);
    }
    if (stepIndex % 64 === 0) this._schedulePad(when, [92.5, 110, 138.59], 3.5, 0.032 * energy, 'sine');
  }

  _scheduleNote(note, when) {
    if (!this.context || !this.masterGain) return;
    const oscillator = safeCall(this.context, 'createOscillator');
    const gainNode = safeCall(this.context, 'createGain');
    const filter = safeCall(this.context, 'createBiquadFilter');
    if (!oscillator || !gainNode) return;

    oscillator.type = this.track?.music?.instruments?.lead?.wave ?? 'sine';
    if (oscillator.frequency) {
      if (typeof oscillator.frequency.setValueAtTime === 'function') oscillator.frequency.setValueAtTime(frequencyFor(this.track, note), when);
      else oscillator.frequency.value = frequencyFor(this.track, note);
    }

    if (filter) {
      filter.type = 'lowpass';
      if (filter.frequency) {
        const cutoff = note.accent ? 2800 + this.intensity * 1400 : 1600 + this.intensity * 900;
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
    const peak = (note.accent ? 0.16 : 0.09) * (0.45 + this.intensity * 0.55);
    const duration = note.accent ? 0.18 : 0.11;
    if (gain) {
      if (typeof gain.setValueAtTime === 'function') gain.setValueAtTime(0.0001, when);
      if (typeof gain.exponentialRampToValueAtTime === 'function') gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), when + 0.012);
      if (typeof gain.exponentialRampToValueAtTime === 'function') gain.exponentialRampToValueAtTime(0.0001, when + duration);
      else gain.value = peak;
    }

    this.activeNodes.add(oscillator);
    oscillator.onended = () => this.activeNodes.delete(oscillator);
    safeCall(oscillator, 'start', when);
    safeCall(oscillator, 'stop', when + duration + 0.02);
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
    oscillator.frequency?.setValueAtTime?.(frequency, when);
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
      oscillator.frequency?.setValueAtTime?.(frequency, when);
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
    oscillator.frequency?.setValueAtTime?.(frequency * 1.75, when);
    oscillator.frequency?.exponentialRampToValueAtTime?.(frequency, when + 0.055);
    gainNode.gain?.setValueAtTime?.(Math.max(0.0001, level), when);
    gainNode.gain?.exponentialRampToValueAtTime?.(0.0001, when + 0.11);
    safeCall(oscillator, 'connect', gainNode);
    safeCall(gainNode, 'connect', this.masterGain);
    this._startNode(oscillator, when, when + 0.13);
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
      let previous = 0;
      for (let index = 0; index < channel.length; index += 1) {
        const white = Math.random() * 2 - 1;
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
  }
}
