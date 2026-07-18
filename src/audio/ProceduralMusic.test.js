import { describe, expect, it, vi } from 'vitest';
import { TRACKS, createBeatmap } from '../data/tracks.js';
import { MUSIC_MASTERING, MUSIC_PROFILE_RECIPES, ProceduralMusic, clampAudibleFrequency } from './ProceduralMusic.js';

class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.events.push(['set', value, time]);
  }

  setTargetAtTime(value, time, constant) {
    this.value = value;
    this.events.push(['target', value, time, constant]);
  }

  exponentialRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push(['ramp', value, time]);
  }
}

class FakeNode {
  constructor() {
    this.connections = [];
  }

  connect(target) {
    this.connections.push(target);
    return target;
  }
}

class FakeGain extends FakeNode {
  constructor() {
    super();
    this.gain = new FakeParam(1);
  }
}

class FakeFilter extends FakeNode {
  constructor() {
    super();
    this.frequency = new FakeParam(1200);
    this.Q = new FakeParam(1);
    this.type = 'lowpass';
  }
}

class FakeDynamics extends FakeNode {
  constructor() {
    super();
    this.threshold = new FakeParam(-24);
    this.knee = new FakeParam(30);
    this.ratio = new FakeParam(12);
    this.attack = new FakeParam(0.003);
    this.release = new FakeParam(0.25);
  }
}

class FakeWaveShaper extends FakeNode {
  constructor() {
    super();
    this.curve = null;
    this.oversample = 'none';
  }
}

class FakeOscillator extends FakeNode {
  constructor(owner) {
    super();
    this.owner = owner;
    this.frequency = new FakeParam(440);
    this.detune = new FakeParam(0);
    this.type = 'sine';
    this.started = [];
    this.stopped = [];
    this.onended = null;
  }

  start(time) {
    this.started.push(time);
    this.owner.startedOscillators.push(this);
  }

  stop(time) {
    this.stopped.push(time);
    if (this.onended) this.onended();
  }
}

class FakeBufferSource extends FakeNode {
  constructor(owner) {
    super();
    this.owner = owner;
    this.buffer = null;
    this.started = [];
    this.stopped = [];
    this.onended = null;
  }

  start(...args) {
    this.started.push(args);
    this.owner.startedSources.push(this);
  }

  stop(time) {
    this.stopped.push(time);
    if (this.onended) this.onended();
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 10;
    this.destination = new FakeNode();
    this.state = 'running';
    this.sampleRate = 8000;
    this.startedOscillators = [];
    this.startedSources = [];
    this.gains = [];
    this.compressors = [];
  }

  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createOscillator() {
    return new FakeOscillator(this);
  }

  createBiquadFilter() {
    return new FakeFilter();
  }

  createDynamicsCompressor() {
    const compressor = new FakeDynamics();
    this.compressors.push(compressor);
    return compressor;
  }

  createWaveShaper() {
    return new FakeWaveShaper();
  }

  createBuffer(numberOfChannels, length, sampleRate) {
    const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    return {
      numberOfChannels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (index) => channels[index],
    };
  }

  createBufferSource() {
    return new FakeBufferSource(this);
  }

  resume() {
    this.state = 'running';
  }

  suspend() {
    this.state = 'suspended';
  }

  close() {
    this.state = 'closed';
  }
}

describe('ProceduralMusic fallback transport', () => {
  it('runs without AudioContext and preserves deterministic time through pause/resume/stop', () => {
    const originalAudioContext = globalThis.AudioContext;
    const originalWebkitAudioContext = globalThis.webkitAudioContext;
    delete globalThis.AudioContext;
    delete globalThis.webkitAudioContext;

    let now = 1000;
    const music = new ProceduralMusic({ clock: { now: () => now }, tickMs: 10 });

    try {
      expect(() => music.start(TRACKS[0], 5)).not.toThrow();
      now += 2500;
      expect(music.getTime()).toBeCloseTo(7.5, 3);
      expect(music.pause()).toBeCloseTo(7.5, 3);
      now += 4000;
      expect(music.getTime()).toBeCloseTo(7.5, 3);
      music.resume();
      now += 1000;
      expect(music.getTime()).toBeCloseTo(8.5, 3);
      expect(music.setIntensity(2).intensity).toBe(1.5);
      expect(music.setIntensity(-1).intensity).toBe(0);
      expect(music.setMuted(true).muted).toBe(true);
      expect(music.stop().getTime()).toBe(0);
      expect(() => music.dispose()).not.toThrow();
    } finally {
      if (originalAudioContext) globalThis.AudioContext = originalAudioContext;
      else delete globalThis.AudioContext;
      if (originalWebkitAudioContext) globalThis.webkitAudioContext = originalWebkitAudioContext;
      else delete globalThis.webkitAudioContext;
    }
  });
});

describe('ProceduralMusic Web Audio scheduling', () => {
  it('clamps every generated partial below the context Nyquist limit', () => {
    expect(clampAudibleFrequency(112640, 48000)).toBe(20000);
    expect(clampAudibleFrequency(28160, 8000)).toBe(3999);
    expect(clampAudibleFrequency(-1, 48000)).toBe(20);
  });

  it('keeps pre-master gain conservative before compression and brickwall limiting', () => {
    const maximumIntensityFactor = MUSIC_MASTERING.intensityFloor + 1.5 * MUSIC_MASTERING.intensityScale;
    expect(MUSIC_MASTERING.synthBaseGain * maximumIntensityFactor).toBeLessThan(0.25);
    expect(MUSIC_MASTERING.customBaseGain * maximumIntensityFactor).toBeLessThan(0.85);
    expect(MUSIC_MASTERING.compressor.threshold).toBeLessThanOrEqual(-12);
    expect(MUSIC_MASTERING.limiter.threshold).toBeLessThanOrEqual(-1);
    expect(MUSIC_MASTERING.limiter.ratio).toBeGreaterThanOrEqual(20);
  });

  it('schedules immediate notes through a master gain and can pause, mute, and dispose', () => {
    const track = TRACKS[2];
    const firstNote = createBeatmap(track)[0];
    const music = new ProceduralMusic({ audioContextFactory: FakeAudioContext, lookAheadSeconds: 0.3, tickMs: 1000 });

    music.start(track, firstNote.time - 0.02);
    const context = music.context;
    expect(context).toBeInstanceOf(FakeAudioContext);
    expect(context.startedOscillators.length).toBeGreaterThan(0);
    expect(context.startedOscillators[0].started[0]).toBeGreaterThanOrEqual(context.currentTime);
    expect(context.compressors).toHaveLength(2);
    expect(music.masterGain.connections).toContain(music.masterCompressor);
    expect(music.masterCompressor.connections).toContain(music.masterLimiter);
    expect(music.masterLimiter.connections).toContain(music.masterCeiling);
    expect(music.masterCeiling.connections).toContain(context.destination);
    expect(music.masterCeiling.oversample).toBe('4x');
    expect(Math.max(...music.masterCeiling.curve)).toBeLessThan(1);
    expect(music.masterCompressor.threshold.value).toBe(MUSIC_MASTERING.compressor.threshold);
    expect(music.masterLimiter.threshold.value).toBe(MUSIC_MASTERING.limiter.threshold);
    expect(music.masterLimiter.ratio.value).toBeGreaterThanOrEqual(20);

    music.setMuted(true);
    expect(music.masterGain.gain.value).toBe(0);
    music.setIntensity(0.5);
    music.setMuted(false);
    expect(music.masterGain.gain.value).toBeGreaterThan(0);

    context.currentTime += 1.25;
    expect(music.getTime()).toBeCloseTo(firstNote.time + 1.23, 2);
    music.pause();
    expect(context.state).toBe('suspended');
    music.resume();
    expect(context.state).toBe('running');
    music.dispose();
    expect(context.state).toBe('closed');
    expect(music.context).toBeNull();
  });

  it('degrades if Web Audio construction fails', () => {
    const music = new ProceduralMusic({
      audioContextFactory: class BrokenContext {
        constructor() {
          throw new Error('blocked by browser policy');
        }
      },
    });
    expect(() => music.start(TRACKS[1], 0)).not.toThrow();
    expect(music.context).toBeNull();
    music.dispose();
  });

  it('executes drums, bass, pads and authored melody for every distinct profile', () => {
    expect(new Set(TRACKS.map((track) => track.music.profile))).toEqual(new Set(Object.keys(MUSIC_PROFILE_RECIPES)));

    for (const track of TRACKS) {
      const recipe = MUSIC_PROFILE_RECIPES[track.music.profile];
      expect(recipe.kicks.length).toBeGreaterThan(0);
      expect(recipe.snares.length).toBeGreaterThan(0);
      expect(recipe.hats.length).toBeGreaterThan(0);
      expect(recipe.bass.length).toBeGreaterThan(0);
      expect(recipe.bassDegrees.length).toBeGreaterThan(0);
      expect(recipe.padDegrees.length).toBeGreaterThanOrEqual(3);
      expect(recipe.melody.length).toBe(recipe.melodyDegrees.length);
      expect(recipe.melodyLevel).toBeLessThanOrEqual(0.06);

      const music = new ProceduralMusic();
      music.context = { currentTime: 0 };
      music.masterGain = {};
      music.track = track;
      const kick = vi.spyOn(music, '_scheduleKick').mockImplementation(() => undefined);
      const noise = vi.spyOn(music, '_scheduleNoise').mockImplementation(() => undefined);
      const bass = vi.spyOn(music, '_scheduleBass').mockImplementation(() => undefined);
      const pad = vi.spyOn(music, '_schedulePad').mockImplementation(() => undefined);
      const lead = vi.spyOn(music, '_scheduleLead').mockImplementation(() => undefined);

      for (let step = 0; step < 64; step += 1) {
        music._scheduleMusicStep(step, step * music._stepDuration(), step * music._stepDuration());
      }

      expect(kick, `${track.id} kick`).toHaveBeenCalled();
      expect(noise, `${track.id} snare/hats`).toHaveBeenCalled();
      expect(bass, `${track.id} bass`).toHaveBeenCalled();
      expect(pad, `${track.id} pad`).toHaveBeenCalled();
      expect(lead, `${track.id} melody`).toHaveBeenCalled();
    }
  });

  it('plays uploaded AudioBuffer once, resumes at its transport offset, and never adds synth layers', () => {
    const audioBuffer = { duration: 24, getChannelData: () => new Float32Array(1) };
    const music = new ProceduralMusic({ audioContextFactory: FakeAudioContext, lookAheadSeconds: 0.5, tickMs: 1000 });
    const synth = vi.spyOn(music, '_scheduleMusicStep');

    music.startCustom(audioBuffer, {
      id: 'custom-transport',
      title: 'Local Track',
      bpm: 120,
      beatmap: [{ time: 3.2, lane: -0.5, row: 0, direction: 'down' }],
    }, 3);
    const context = music.context;
    const firstSource = context.startedSources.find((source) => source.buffer === audioBuffer);
    expect(firstSource.started[0]).toEqual([10, 3]);
    expect(music.masterCompressor.threshold.value).toBe(MUSIC_MASTERING.customCompressor.threshold);
    expect(music.masterCompressor.ratio.value).toBe(MUSIC_MASTERING.customCompressor.ratio);
    expect(synth).not.toHaveBeenCalled();

    context.currentTime += 2.5;
    expect(music.pause()).toBeCloseTo(5.5, 3);
    expect(firstSource.stopped).toEqual([0]);
    music.resume();
    const uploadedSources = context.startedSources.filter((source) => source.buffer === audioBuffer);
    expect(uploadedSources).toHaveLength(2);
    expect(uploadedSources[1].started[0]).toEqual([12.5, 5.5]);
    music.resume();
    expect(context.startedSources.filter((source) => source.buffer === audioBuffer)).toHaveLength(2);

    music.stop();
    expect(uploadedSources[1].stopped).toEqual([0]);
    expect(music.getTime()).toBe(0);
    expect(synth).not.toHaveBeenCalled();

    music.start(TRACKS[0], 0);
    expect(music.masterCompressor.threshold.value).toBe(MUSIC_MASTERING.compressor.threshold);
    music.dispose();
  });
});
