import { describe, expect, it, vi } from 'vitest';
import { TRACKS, createBeatmap } from '../data/tracks.js';
import { ProceduralMusic } from './ProceduralMusic.js';

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
    this.type = 'lowpass';
  }
}

class FakeOscillator extends FakeNode {
  constructor(owner) {
    super();
    this.owner = owner;
    this.frequency = new FakeParam(440);
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

class FakeAudioContext {
  constructor() {
    this.currentTime = 10;
    this.destination = new FakeNode();
    this.state = 'running';
    this.startedOscillators = [];
    this.gains = [];
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
  it('schedules immediate notes through a master gain and can pause, mute, and dispose', () => {
    const track = TRACKS[2];
    const firstNote = createBeatmap(track)[0];
    const music = new ProceduralMusic({ audioContextFactory: FakeAudioContext, lookAheadSeconds: 0.3, tickMs: 1000 });

    music.start(track, firstNote.time - 0.02);
    const context = music.context;
    expect(context).toBeInstanceOf(FakeAudioContext);
    expect(context.startedOscillators.length).toBeGreaterThan(0);
    expect(context.startedOscillators[0].started[0]).toBeGreaterThanOrEqual(context.currentTime);

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
});
