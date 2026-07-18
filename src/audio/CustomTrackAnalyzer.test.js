import { describe, expect, it, vi } from 'vitest';
import { CutDirection, Hand } from '../shared/contracts.js';
import {
  CUSTOM_AUDIO_LIMITS,
  CustomAudioError,
  analyzeAudioBuffer,
  analyzePcm,
  createCustomTrack,
  decodeAndAnalyzeFile,
  generateBeatmapFromAnalysis,
  validateAudioFile,
} from './CustomTrackAnalyzer.js';

function makeClickTrack({ bpm = 120, duration = 16, sampleRate = 8000, stereo = false } = {}) {
  const length = Math.round(duration * sampleRate);
  const left = new Float32Array(length);
  const right = stereo ? new Float32Array(length) : null;
  const interval = 60 / bpm;

  for (let index = 0; index < length; index += 1) {
    const bed = Math.sin((index / sampleRate) * Math.PI * 2 * 110) * 0.018;
    left[index] = bed;
    if (right) right[index] = bed * 0.92;
  }
  for (let time = 0.5; time < duration - 0.2; time += interval) {
    const start = Math.round(time * sampleRate);
    for (let index = 0; index < Math.round(sampleRate * 0.022); index += 1) {
      const value = Math.exp(-index / (sampleRate * 0.004)) * (index % 2 === 0 ? 0.86 : -0.7);
      left[start + index] = value;
      if (right) right[start + index] = value * (Math.round(time / interval) % 2 ? 0.58 : 0.95);
    }
  }
  return { channels: right ? [left, right] : [left], sampleRate, duration };
}

function asAudioBuffer(pcm) {
  return {
    numberOfChannels: pcm.channels.length,
    sampleRate: pcm.sampleRate,
    duration: pcm.duration,
    getChannelData: (index) => pcm.channels[index],
  };
}

describe('custom audio validation and PCM analysis', () => {
  it('detects a stable click tempo and exposes deterministic onset features', () => {
    for (const bpm of [90, 120, 174]) {
      const pcm = makeClickTrack({ bpm, stereo: true });
      const first = analyzePcm(pcm, undefined);
      const second = analyzeAudioBuffer(asAudioBuffer(pcm));

      expect(first.bpm).toBeGreaterThanOrEqual(bpm - 3);
      expect(first.bpm).toBeLessThanOrEqual(bpm + 3);
      expect(first.tempoConfidence).toBeGreaterThan(0.2);
      expect(first.onsets.length).toBeGreaterThan(20);
      expect(first.duration).toBe(16);
      expect(first.channels).toBe(2);
      expect(second.bpm).toBe(first.bpm);
      expect(second.onsets).toEqual(first.onsets);
    }
  });

  it('measures phase-opposed stereo energy instead of cancelling audible PCM', () => {
    const mono = makeClickTrack({ bpm: 120 });
    const inverted = Float32Array.from(mono.channels[0], (sample) => -sample);
    const analysis = analyzePcm({ ...mono, channels: [mono.channels[0], inverted] }, undefined);
    expect(analysis.rms).toBeGreaterThan(0.01);
    expect(analysis.onsets.length).toBeGreaterThan(20);
    expect(analysis.bpm).toBeGreaterThanOrEqual(118);
    expect(analysis.bpm).toBeLessThanOrEqual(122);
  });

  it('rejects too-short, silent, invalid-rate, and excessive-channel PCM', () => {
    const short = makeClickTrack({ duration: 4 });
    expect(() => analyzePcm(short, undefined)).toThrowError(expect.objectContaining({ code: 'AUDIO_TOO_SHORT' }));
    expect(() => analyzePcm({ channels: [new Float32Array(8000 * 10)], sampleRate: 8000 }, undefined))
      .toThrowError(expect.objectContaining({ code: 'SILENT_AUDIO' }));
    expect(() => analyzePcm({ channels: [new Float32Array(10000)], sampleRate: 2000 }, undefined, { limits: { minDuration: 1 } }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_SAMPLE_RATE' }));
    const manyChannels = Array.from({ length: CUSTOM_AUDIO_LIMITS.maxChannels + 1 }, () => new Float32Array(8000 * 9).fill(0.1));
    expect(() => analyzePcm({ channels: manyChannels, sampleRate: 8000 }, undefined))
      .toThrowError(expect.objectContaining({ code: 'TOO_MANY_CHANNELS' }));
    expect(() => analyzePcm({ channels: [new Float32Array(100).fill(0.1)], sampleRate: 8000 }, undefined, {
      limits: { minDuration: 0.001, maxDecodedSamples: 99 },
    })).toThrowError(expect.objectContaining({ code: 'DECODED_AUDIO_TOO_LARGE' }));
  });

  it('enforces local file type and size boundaries without reading the file', () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(2));
    expect(validateAudioFile({ name: 'mix.wav', type: 'audio/wav', size: 1024, arrayBuffer })).toMatchObject({ name: 'mix.wav' });
    expect(validateAudioFile({ name: 'limit.flac', type: '', size: CUSTOM_AUDIO_LIMITS.maxBytes, arrayBuffer })).toMatchObject({ size: CUSTOM_AUDIO_LIMITS.maxBytes });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(() => validateAudioFile({ name: 'payload.exe', type: 'application/octet-stream', size: 4, arrayBuffer }))
      .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_TYPE' }));
    expect(() => validateAudioFile({ name: 'payload.bin', type: '', size: 4, arrayBuffer }))
      .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_TYPE' }));
    expect(() => validateAudioFile({ name: 'empty.wav', type: 'audio/wav', size: 0, arrayBuffer }))
      .toThrowError(expect.objectContaining({ code: 'EMPTY_FILE' }));
    expect(() => validateAudioFile({ name: 'huge.mp3', type: 'audio/mpeg', size: CUSTOM_AUDIO_LIMITS.maxBytes + 1, arrayBuffer }))
      .toThrowError(expect.objectContaining({ code: 'FILE_TOO_LARGE' }));
    expect(() => validateAudioFile(null)).toThrow(CustomAudioError);
  });

  it('accepts the exact decoded-duration boundary and rejects one sample beyond it', () => {
    const exact = new Float32Array(80).fill(0.1);
    const limits = { minDuration: 0.005, maxDuration: 0.01 };
    expect(analyzePcm({ channels: [exact], sampleRate: 8000 }, undefined, { limits }).duration).toBe(0.01);
    expect(() => analyzePcm({ channels: [new Float32Array(81).fill(0.1)], sampleRate: 8000 }, undefined, { limits }))
      .toThrowError(expect.objectContaining({ code: 'AUDIO_TOO_LONG' }));
    expect(CUSTOM_AUDIO_LIMITS.maxDuration).toBe(8 * 60);
    expect(CUSTOM_AUDIO_LIMITS.maxBytes).toBe(48 * 1024 * 1024);
  });
});

describe('custom beatmap and track generation', () => {
  it('maps detected rhythm to a deterministic, two-row, four-lane eight-direction chart', () => {
    const pcm = makeClickTrack({ bpm: 120, stereo: true });
    const analysis = analyzePcm(pcm, undefined);
    const first = generateBeatmapFromAnalysis(analysis, { id: 'custom-test', seed: 'same-seed' });
    const second = generateBeatmapFromAnalysis(analysis, { id: 'custom-test', seed: 'same-seed' });
    const lanes = new Set([-1.5, -0.5, 0.5, 1.5]);
    const directions = new Set(Object.values(CutDirection));

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(25);
    for (const note of first) {
      expect(lanes.has(note.lane)).toBe(true);
      expect([0, 1]).toContain(note.row);
      expect([Hand.LEFT, Hand.RIGHT]).toContain(note.hand);
      expect(directions.has(note.direction)).toBe(true);
    }
  });

  it('creates a complete in-memory track contract with its original AudioBuffer', () => {
    const pcm = makeClickTrack({ bpm: 120 });
    const buffer = asAudioBuffer(pcm);
    const analysis = analyzeAudioBuffer(buffer);
    const track = createCustomTrack(buffer, analysis, { fileName: 'My_Night-Drive.wav' });

    expect(track.id).toMatch(/^custom-my-night-drive-/);
    expect(track.title).toBe('My Night Drive');
    expect(track.metadata.titleZh).toBe(track.title);
    expect(track.audioBuffer).toBe(buffer);
    expect(track.beatmap.length).toBeGreaterThan(25);
    expect(track.environment.theme).toBe('custom');
    expect(track.metadata.description).toContain('120 BPM');
  });

  it('decodes, analyzes, and closes an owned temporary context', async () => {
    const pcm = makeClickTrack({ bpm: 120 });
    const buffer = asAudioBuffer(pcm);
    const close = vi.fn(async () => undefined);
    const decodeAudioData = vi.fn(async () => buffer);
    const file = {
      name: 'Local Pulse.wav',
      type: 'audio/wav',
      size: 2048,
      arrayBuffer: vi.fn(async () => new ArrayBuffer(16)),
    };
    class DecoderContext {
      decodeAudioData(...args) { return decodeAudioData(...args); }
      close() { return close(); }
    }

    const result = await decodeAndAnalyzeFile(file, { audioContextFactory: DecoderContext });
    expect(result.track.title).toBe('Local Pulse');
    expect(result.audioBuffer).toBe(buffer);
    expect(result.analysis.bpm).toBeGreaterThanOrEqual(118);
    expect(file.arrayBuffer).toHaveBeenCalledOnce();
    expect(decodeAudioData).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('supports callback-only decoding with one local decode and leaves a provided context open', async () => {
    const pcm = makeClickTrack({ bpm: 120 });
    const buffer = asAudioBuffer(pcm);
    const decodeAudioData = vi.fn((_encoded, succeed) => succeed(buffer));
    const close = vi.fn();
    const context = { decodeAudioData, close };
    const file = {
      name: 'Legacy Decoder.ogg',
      type: 'audio/ogg',
      size: 4096,
      arrayBuffer: vi.fn(async () => new ArrayBuffer(16)),
    };

    const result = await decodeAndAnalyzeFile(file, context);
    expect(result.track.title).toBe('Legacy Decoder');
    expect(decodeAudioData).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it('reports local read failures without attempting decode', async () => {
    const decodeAudioData = vi.fn();
    const context = { decodeAudioData };
    const file = {
      name: 'Broken.wav',
      type: 'audio/wav',
      size: 12,
      arrayBuffer: vi.fn(async () => { throw new Error('permission lost'); }),
    };

    await expect(decodeAndAnalyzeFile(file, context)).rejects.toMatchObject({ code: 'READ_FAILED' });
    expect(decodeAudioData).not.toHaveBeenCalled();
  });
});
