import { CutDirection, Hand } from '../shared/contracts.js';

const LANES = Object.freeze([-1.5, -0.5, 0.5, 1.5]);
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

export const CUSTOM_AUDIO_LIMITS = Object.freeze({
  maxBytes: 48 * 1024 * 1024,
  minDuration: 8,
  maxDuration: 8 * 60,
  minSampleRate: 8000,
  maxSampleRate: 192000,
  maxChannels: 8,
  maxDecodedSamples: 64 * 1024 * 1024,
  maxNotes: 1800,
});

export class CustomAudioError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CustomAudioError';
    this.code = code;
    this.details = details;
  }
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const round = (value, precision = 3) => Number(value.toFixed(precision));
const median = (values) => percentile(values, 0.5);

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const index = clamp(Math.round((sorted.length - 1) * ratio), 0, sorted.length - 1);
  return sorted[index];
}

function hashSeed(text) {
  let hash = 2166136261;
  for (let index = 0; index < String(text).length; index += 1) {
    hash ^= String(text).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function mergeLimits(overrides = {}) {
  return { ...CUSTOM_AUDIO_LIMITS, ...overrides };
}

function assertDuration(duration, limits) {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new CustomAudioError('INVALID_DURATION', 'The decoded audio has no playable duration.');
  }
  if (duration < limits.minDuration) {
    throw new CustomAudioError('AUDIO_TOO_SHORT', `Choose a song at least ${limits.minDuration} seconds long.`, {
      duration,
      minimum: limits.minDuration,
    });
  }
  if (duration > limits.maxDuration) {
    throw new CustomAudioError('AUDIO_TOO_LONG', `Choose a song no longer than ${Math.round(limits.maxDuration / 60)} minutes.`, {
      duration,
      maximum: limits.maxDuration,
    });
  }
}

export function validateAudioFile(file, limitOverrides = {}) {
  const limits = mergeLimits(limitOverrides);
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new CustomAudioError('INVALID_FILE', 'Choose a local audio file to continue.');
  }

  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) {
    throw new CustomAudioError('EMPTY_FILE', 'The selected audio file is empty.');
  }
  if (size > limits.maxBytes) {
    throw new CustomAudioError('FILE_TOO_LARGE', `The file exceeds the ${Math.round(limits.maxBytes / 1024 / 1024)} MB local limit.`, {
      size,
      maximum: limits.maxBytes,
    });
  }

  const name = typeof file.name === 'string' ? file.name : 'Custom Rift';
  const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  const supportedExtension = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i.test(name);
  if (!type.startsWith('audio/') && !supportedExtension) {
    throw new CustomAudioError('UNSUPPORTED_TYPE', 'Use an MP3, WAV, OGG, M4A, AAC, FLAC, or WebM audio file.', { type });
  }

  return { name, type, size, limits };
}

function normalizePcm(channelsOrDescriptor, sampleRate) {
  let channels = channelsOrDescriptor;
  let resolvedSampleRate = sampleRate;

  if (channelsOrDescriptor && !Array.isArray(channelsOrDescriptor) && !ArrayBuffer.isView(channelsOrDescriptor)) {
    channels = channelsOrDescriptor.channels;
    resolvedSampleRate = channelsOrDescriptor.sampleRate ?? sampleRate;
  }
  if (ArrayBuffer.isView(channels)) channels = [channels];
  if (!Array.isArray(channels) || !channels.length || channels.some((channel) => !ArrayBuffer.isView(channel))) {
    throw new CustomAudioError('INVALID_PCM', 'PCM analysis requires one or more typed-array channels.');
  }

  const length = Math.min(...channels.map((channel) => channel.length));
  if (!length) throw new CustomAudioError('INVALID_PCM', 'The decoded audio contains no samples.');

  return { channels, sampleRate: Number(resolvedSampleRate), length };
}

function extractFrames(channels, sampleRate, length) {
  const frameRate = 100;
  const hopSize = Math.max(64, Math.round(sampleRate / frameRate));
  const frameSize = hopSize * 2;
  const sampleStride = Math.max(1, Math.round(sampleRate / 16000));
  const frameCount = Math.max(1, Math.ceil(length / hopSize));
  const energy = new Float32Array(frameCount);
  const high = new Float32Array(frameCount);
  const balance = new Float32Array(frameCount);
  let absolutePeak = 0;
  let totalSquares = 0;
  let totalSamples = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const from = frame * hopSize;
    const to = Math.min(length, from + frameSize);
    let frameSquares = 0;
    let difference = 0;
    let frameSamples = 0;
    let leftSquares = 0;
    let rightSquares = 0;

    for (let index = from; index < to; index += sampleStride) {
      let sampleSquares = 0;
      let sampleDifference = 0;
      const previousIndex = Math.max(from, index - sampleStride);
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
        const value = clamp(Number(channels[channelIndex][index]) || 0, -1, 1);
        const previous = clamp(Number(channels[channelIndex][previousIndex]) || 0, -1, 1);
        sampleSquares += value * value;
        sampleDifference += Math.abs(value - previous);
        absolutePeak = Math.max(absolutePeak, Math.abs(value));
        if (channelIndex === 0) leftSquares += value * value;
        if (channelIndex === 1) rightSquares += value * value;
      }
      frameSquares += sampleSquares / channels.length;
      difference += sampleDifference / channels.length;
      frameSamples += 1;
    }

    const rms = Math.sqrt(frameSquares / Math.max(1, frameSamples));
    energy[frame] = rms;
    high[frame] = difference / Math.max(1, frameSamples);
    if (channels.length > 1) {
      balance[frame] = clamp((rightSquares - leftSquares) / Math.max(1e-8, rightSquares + leftSquares), -1, 1);
    }
    totalSquares += frameSquares;
    totalSamples += frameSamples;
  }

  return {
    energy,
    high,
    balance,
    frameRate: sampleRate / hopSize,
    peak: absolutePeak,
    rms: Math.sqrt(totalSquares / Math.max(1, totalSamples)),
  };
}

function extractOnsets(frames) {
  const { energy, high, balance, frameRate } = frames;
  const novelty = new Float32Array(energy.length);
  for (let index = 0; index < energy.length; index += 1) {
    let localMean = 0;
    let localCount = 0;
    for (let previous = Math.max(0, index - 10); previous < index; previous += 1) {
      localMean += energy[previous];
      localCount += 1;
    }
    localMean /= Math.max(1, localCount);
    const energyRise = Math.max(0, energy[index] - Math.max(localMean, energy[Math.max(0, index - 1)] * 0.72));
    const highRise = Math.max(0, high[index] - high[Math.max(0, index - 1)] * 0.6);
    novelty[index] = energyRise * 0.78 + highRise * 0.22;
  }

  const noveltyValues = Array.from(novelty);
  const floor = median(noveltyValues);
  const highMark = percentile(noveltyValues, 0.88);
  const threshold = Math.max(0.00008, floor + (highMark - floor) * 0.34);
  const maxNovelty = Math.max(threshold, percentile(noveltyValues, 0.98));
  const energyReference = Math.max(1e-7, percentile(Array.from(energy), 0.95));
  const minimumFrames = Math.max(5, Math.round(frameRate * 0.085));
  const onsets = [];

  for (let index = 1; index < novelty.length - 1; index += 1) {
    if (novelty[index] < threshold || novelty[index] < novelty[index - 1] || novelty[index] < novelty[index + 1]) continue;
    const onset = {
      time: round(index / frameRate, 4),
      strength: round(clamp(novelty[index] / maxNovelty, 0, 1), 4),
      energy: round(clamp(energy[index] / energyReference, 0, 1), 4),
      brightness: round(clamp(high[index] / Math.max(1e-7, energy[index] * 1.75), 0, 1), 4),
      balance: round(balance[index], 4),
    };
    const previous = onsets.at(-1);
    if (previous && (index - previous.frame) < minimumFrames) {
      if (onset.strength > previous.strength) onsets[onsets.length - 1] = { ...onset, frame: index };
    } else {
      onsets.push({ ...onset, frame: index });
    }
  }

  return { novelty, onsets: onsets.map(({ frame: _frame, ...onset }) => onset), threshold };
}

export function estimateTempo(onsets, { minimum = 70, maximum = 180, fallback = 120 } = {}) {
  if (!Array.isArray(onsets) || onsets.length < 3) {
    return { bpm: fallback, confidence: 0, beatOffset: 0 };
  }

  const bins = new Map();
  for (let index = 0; index < onsets.length; index += 1) {
    for (let next = index + 1; next < Math.min(onsets.length, index + 7); next += 1) {
      const interval = onsets[next].time - onsets[index].time;
      if (interval < 0.18 || interval > 2.4) continue;
      let bpm = 60 / interval;
      while (bpm < minimum) bpm *= 2;
      while (bpm > maximum) bpm /= 2;
      if (bpm < minimum || bpm > maximum) continue;
      const bin = Math.round(bpm * 2) / 2;
      // Adjacent transients are the strongest evidence for fast material. A
      // square-root falloff over-weighted two/four-beat gaps and mislabeled
      // 170-class drum-and-bass as half-time 85 BPM.
      const distanceWeight = 1 / (next - index);
      const strength = Math.sqrt((onsets[index].strength || 0.25) * (onsets[next].strength || 0.25));
      bins.set(bin, (bins.get(bin) || 0) + distanceWeight * strength);
    }
  }

  if (!bins.size) return { bpm: fallback, confidence: 0, beatOffset: 0 };
  const smoothed = [...bins.keys()].map((bpm) => {
    const score = (bins.get(bpm) || 0)
      + (bins.get(bpm - 0.5) || 0) * 0.72
      + (bins.get(bpm + 0.5) || 0) * 0.72
      + (bins.get(bpm - 1) || 0) * 0.32
      + (bins.get(bpm + 1) || 0) * 0.32;
    return { bpm, score };
  }).sort((first, second) => second.score - first.score || Math.abs(first.bpm - 120) - Math.abs(second.bpm - 120));

  const best = smoothed[0];
  const total = smoothed.reduce((sum, candidate) => sum + candidate.score, 0);
  const bpm = round(best.bpm, 1);
  const period = 60 / bpm;
  let beatOffset = 0;
  let bestPhaseScore = -1;

  for (const candidate of onsets.slice().sort((first, second) => second.strength - first.strength).slice(0, 24)) {
    const phase = ((candidate.time % period) + period) % period;
    let score = 0;
    for (const onset of onsets) {
      const normalized = ((onset.time - phase) % period + period) % period;
      const distance = Math.min(normalized, period - normalized);
      score += (onset.strength || 0.2) * Math.exp(-(distance * distance) / 0.0032);
    }
    if (score > bestPhaseScore) {
      bestPhaseScore = score;
      beatOffset = phase;
    }
  }

  return {
    bpm,
    confidence: round(clamp(best.score / Math.max(1e-8, total) * 5, 0, 1), 3),
    beatOffset: round(beatOffset, 4),
  };
}

/**
 * Deterministic, allocation-conscious PCM analysis. This pure entry point makes the
 * local uploader testable without a browser or network connection.
 */
export function analyzePcm(channelsOrDescriptor, sampleRate, options = {}) {
  const limits = mergeLimits(options.limits);
  const pcm = normalizePcm(channelsOrDescriptor, sampleRate);
  if (!Number.isFinite(pcm.sampleRate) || pcm.sampleRate < limits.minSampleRate || pcm.sampleRate > limits.maxSampleRate) {
    throw new CustomAudioError('INVALID_SAMPLE_RATE', 'The decoded sample rate is outside the supported range.', {
      sampleRate: pcm.sampleRate,
    });
  }
  if (pcm.channels.length > limits.maxChannels) {
    throw new CustomAudioError('TOO_MANY_CHANNELS', `Audio with more than ${limits.maxChannels} channels is not supported.`);
  }
  const decodedSamples = pcm.length * pcm.channels.length;
  if (decodedSamples > limits.maxDecodedSamples) {
    throw new CustomAudioError('DECODED_AUDIO_TOO_LARGE', 'This decoded song needs too much memory for stable VR playback.', {
      samples: decodedSamples,
      maximum: limits.maxDecodedSamples,
    });
  }

  const duration = pcm.length / pcm.sampleRate;
  assertDuration(duration, limits);
  const frames = extractFrames(pcm.channels, pcm.sampleRate, pcm.length);
  if (frames.peak < 0.0001 || frames.rms < 0.00001) {
    throw new CustomAudioError('SILENT_AUDIO', 'This file is silent or too quiet to generate a reliable beatmap.');
  }

  const onsetResult = extractOnsets(frames);
  const tempo = estimateTempo(onsetResult.onsets, options.tempo);
  const energyValues = Array.from(frames.energy);
  return {
    duration: round(duration, 4),
    sampleRate: pcm.sampleRate,
    channels: pcm.channels.length,
    bpm: tempo.bpm,
    tempoConfidence: tempo.confidence,
    beatOffset: tempo.beatOffset,
    peak: round(frames.peak, 5),
    rms: round(frames.rms, 5),
    energy: {
      mean: round(energyValues.reduce((sum, value) => sum + value, 0) / Math.max(1, energyValues.length), 5),
      peak: round(Math.max(...energyValues), 5),
      frameRate: round(frames.frameRate, 4),
      envelope: frames.energy,
    },
    onsets: onsetResult.onsets,
  };
}

export function analyzeAudioBuffer(audioBuffer, options = {}) {
  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') {
    throw new CustomAudioError('INVALID_AUDIO_BUFFER', 'A decoded AudioBuffer is required for analysis.');
  }
  const numberOfChannels = Number(audioBuffer.numberOfChannels) || 0;
  const channels = Array.from({ length: numberOfChannels }, (_unused, index) => audioBuffer.getChannelData(index));
  return analyzePcm({ channels, sampleRate: audioBuffer.sampleRate }, undefined, options);
}

function envelopeValueAt(analysis, time) {
  const envelope = analysis.energy?.envelope;
  const frameRate = analysis.energy?.frameRate;
  if (!envelope?.length || !frameRate) return clamp(analysis.rms * 8, 0.2, 0.8);
  return clamp(envelope[Math.min(envelope.length - 1, Math.max(0, Math.round(time * frameRate)))] / Math.max(1e-7, analysis.energy.peak), 0, 1);
}

export function generateBeatmapFromAnalysis(analysis, options = {}) {
  if (!analysis || !Number.isFinite(analysis.duration) || !Number.isFinite(analysis.bpm)) {
    throw new CustomAudioError('INVALID_ANALYSIS', 'A valid audio analysis is required to generate a beatmap.');
  }
  const limits = mergeLimits(options.limits);
  const id = options.id || 'custom-rift';
  const seed = hashSeed(options.seed || `${id}:${analysis.duration}:${analysis.bpm}`);
  const random = mulberry32(seed);
  const beatDuration = 60 / clamp(analysis.bpm, 60, 200);
  const halfBeat = beatDuration / 2;
  const onsets = Array.isArray(analysis.onsets)
    ? analysis.onsets.filter((onset) => Number.isFinite(onset?.time)).slice().sort((first, second) => first.time - second.time)
    : [];
  const candidates = [];
  const firstTime = Math.max(0.5, Number(analysis.beatOffset) || 0);
  let nearestOnsetIndex = 0;

  for (let time = firstTime; time < analysis.duration - 0.55; time += halfBeat) {
    while (
      nearestOnsetIndex + 1 < onsets.length
      && Math.abs(onsets[nearestOnsetIndex + 1].time - time) <= Math.abs(onsets[nearestOnsetIndex].time - time)
    ) nearestOnsetIndex += 1;
    const nearestOnset = onsets[nearestOnsetIndex] ?? null;
    const nearest = {
      onset: nearestOnset,
      distance: nearestOnset ? Math.abs(nearestOnset.time - time) : Number.POSITIVE_INFINITY,
    };
    const energy = envelopeValueAt(analysis, time);
    const stepIndex = Math.round((time - firstTime) / halfBeat);
    const pulse = nearest.distance <= Math.min(0.14, halfBeat * 0.42) ? nearest.onset : null;
    const requiredQuarter = stepIndex % 2 === 0;
    if (!pulse && !requiredQuarter && random() > energy * 0.82) continue;
    if (!pulse && requiredQuarter && energy < 0.045 && random() > 0.3) continue;
    candidates.push({
      time: pulse ? pulse.time : time,
      strength: pulse?.strength ?? (0.34 + energy * 0.38),
      energy: pulse?.energy ?? energy,
      brightness: pulse?.brightness ?? clamp(0.25 + energy * 0.5, 0, 1),
      balance: pulse?.balance ?? 0,
      gridIndex: stepIndex,
    });
  }

  for (const onset of onsets) {
    if (onset.time < 0.5 || onset.time >= analysis.duration - 0.55 || onset.strength < 0.72) continue;
    if (candidates.some((candidate) => Math.abs(candidate.time - onset.time) < 0.085)) continue;
    candidates.push({ ...onset, gridIndex: Math.round((onset.time - firstTime) / halfBeat) });
  }

  candidates.sort((first, second) => first.time - second.time || second.strength - first.strength);
  const notes = [];
  let previousTime = -Infinity;
  for (const candidate of candidates) {
    if (notes.length >= limits.maxNotes || candidate.time - previousTime < 0.085) continue;
    const panBias = clamp(candidate.balance || 0, -1, 1);
    let laneIndex;
    if (Math.abs(panBias) > 0.28) laneIndex = panBias < 0 ? (random() > 0.35 ? 0 : 1) : (random() > 0.35 ? 3 : 2);
    else laneIndex = Math.floor(random() * LANES.length);
    const lane = LANES[clamp(laneIndex, 0, LANES.length - 1)];
    const row = candidate.brightness > 0.58 ? 1 : (random() > 0.68 ? 1 : 0);
    const directionSeed = candidate.gridIndex + laneIndex * 3 + (row ? 5 : 0) + Math.floor(random() * 3);
    const directionIndex = ((directionSeed % DIRECTIONS.length) + DIRECTIONS.length) % DIRECTIONS.length;
    const accent = candidate.strength >= 0.73 || candidate.gridIndex % 8 === 0;
    notes.push({
      id: `${id}-${String(notes.length).padStart(4, '0')}`,
      time: round(candidate.time),
      lane,
      row,
      hand: lane < 0 ? Hand.LEFT : Hand.RIGHT,
      direction: DIRECTIONS[directionIndex],
      ...(accent ? { accent: true } : {}),
    });
    previousTime = candidate.time;
  }

  if (notes.length < Math.max(8, analysis.duration / 4)) {
    throw new CustomAudioError('INSUFFICIENT_RHYTHM', 'Not enough rhythmic detail was found to create a playable beatmap.', {
      notes: notes.length,
    });
  }
  return notes.map((note, index) => ({ ...note, id: `${id}-${String(index).padStart(4, '0')}` }));
}

function safeTitle(name) {
  return String(name || 'Custom Rift')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64) || 'Custom Rift';
}

function safeId(name, analysis) {
  const slug = safeTitle(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'song';
  return `custom-${slug}-${hashSeed(`${name}:${analysis.duration}:${analysis.bpm}`).toString(36).slice(0, 5)}`;
}

/**
 * Builds the same track contract used by built-ins while retaining the decoded
 * AudioBuffer only in memory. `analysisOrOptions` may be a precomputed analysis
 * or an options object; no upload or persistence occurs.
 */
export function createCustomTrack(audioBuffer, analysisOrOptions = {}, maybeOptions = {}) {
  const hasAnalysis = Array.isArray(analysisOrOptions?.onsets) && Number.isFinite(analysisOrOptions?.duration);
  const analysis = hasAnalysis ? analysisOrOptions : analyzeAudioBuffer(audioBuffer, analysisOrOptions.analysisOptions);
  const options = hasAnalysis ? maybeOptions : analysisOrOptions;
  const title = safeTitle(options.title || options.fileName);
  const id = options.id || safeId(options.fileName || title, analysis);
  const beatmap = generateBeatmapFromAnalysis(analysis, { id, seed: options.seed, limits: options.limits });
  const energy = clamp(analysis.rms * 9 + analysis.energy.mean * 4, 0.35, 1);

  return {
    id,
    title,
    artist: options.artist || 'LOCAL // YOU',
    bpm: analysis.bpm,
    duration: analysis.duration,
    previewStart: clamp(options.previewStart ?? analysis.duration * 0.24, 1, analysis.duration - 1),
    isCustom: true,
    audioBuffer,
    beatmap,
    analysis,
    metadata: {
      titleZh: title,
      style: 'locally analyzed custom audio',
      difficulty: energy > 0.78 ? 'apex' : energy > 0.58 ? 'vanguard' : 'cruiser',
      energy: round(energy, 3),
      description: `Generated locally from ${analysis.onsets.length} detected transients at approximately ${analysis.bpm} BPM.`,
      unlockHint: 'Your audio never leaves this device.',
    },
    palette: {
      background: '#070817',
      horizon: '#72f2eb',
      primary: '#7b61ff',
      secondary: '#ff4fb8',
      bladeLeft: '#72f2eb',
      bladeRight: '#ff7ac8',
      warning: '#ffe66d',
    },
    environment: {
      theme: 'custom',
      biome: 'adaptive spectrum chamber',
      sky: 'audio-reactive aurora shaped by the uploaded waveform',
      floor: 'acrylic frequency grid with onset shockwaves',
      landmarks: ['tempo halo', 'spectrum prisms', 'waveform horizon'],
      fog: { color: '#17143f', density: 0.42, pulseRate: round(analysis.bpm / 240, 3) },
      particles: { type: 'spectrum motes', color: '#72f2eb', density: round(0.45 + energy * 0.4, 3), speed: round(0.4 + energy * 0.65, 3) },
      lighting: { key: '#72f2eb', rim: '#ff4fb8', exposure: round(0.92 + energy * 0.18, 3) },
    },
    damageStyle: {
      name: 'waveform overload',
      hitColor: '#72f2eb',
      missColor: '#ff4fb8',
      vignette: '#1d0731',
      cameraKick: round(0.12 + energy * 0.14, 3),
      haptics: [12, 16, 24, 12],
      shader: { aberration: 0.38, waveformTear: 0.8, spectrumBurst: 0.7 },
    },
    music: {
      profile: 'custom-audio',
      seed: `analysis-${hashSeed(id).toString(36)}`,
      key: 'detected source harmony',
      scale: ['A', 'C', 'D', 'E', 'G'],
      swing: 0,
      groove: `${analysis.bpm} BPM locally detected pulse`,
      instruments: {
        lead: { wave: 'source', octave: 4, envelope: [0, 0, 1, 0], pattern: 'original uploaded recording' },
        bass: { wave: 'source', octave: 2, envelope: [0, 0, 1, 0], pattern: 'original uploaded recording' },
        pad: { wave: 'source', octave: 3, envelope: [0, 0, 1, 0], pattern: 'original uploaded recording' },
        percussion: { kick: 'detected onset', snare: 'detected onset', hats: 'detected onset' },
      },
      arrangement: [
        { section: 'opening', from: 0, to: analysis.duration * 0.22, intensity: round(energy * 0.72, 3), motif: [0, 2, 4, 1] },
        { section: 'rise', from: analysis.duration * 0.22, to: analysis.duration * 0.5, intensity: round(energy * 0.88, 3), motif: [0, 3, 2, 4] },
        { section: 'peak', from: analysis.duration * 0.5, to: analysis.duration * 0.8, intensity: round(energy, 3), motif: [4, 2, 0, 3, 1] },
        { section: 'outro', from: analysis.duration * 0.8, to: analysis.duration, intensity: round(energy * 0.7, 3), motif: [3, 1, 0, 2] },
      ],
      recipe: {
        noteStrideBeats: 0.5,
        chordEveryBeats: 8,
        accentEveryBeats: 4,
        laneMotion: 'stereo and spectral onset mapping',
        rowMotion: 'brightness-driven low/high strikes',
        densityCurve: [0.5, 0.7, 0.9, 0.62],
      },
    },
  };
}

async function decodeAudioData(context, arrayBuffer) {
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const succeed = (audioBuffer) => {
        if (settled) return;
        if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') {
          fail(new Error('Decoder returned no AudioBuffer.'));
          return;
        }
        settled = true;
        resolve(audioBuffer);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      // One invocation supports both current promise-based Web Audio and the
      // legacy callback form without decoding a large local file twice.
      const decoded = context.decodeAudioData(arrayBuffer.slice(0), succeed, fail);
      if (decoded && typeof decoded.then === 'function') decoded.then(succeed, fail);
      else if (decoded && typeof decoded.getChannelData === 'function') succeed(decoded);
    });
  } catch (error) {
    throw new CustomAudioError('DECODE_FAILED', 'The browser could not decode this audio file.', { cause: error?.message });
  }
}

export async function decodeAndAnalyzeFile(file, audioContextOrOptions = {}, maybeOptions = {}) {
  const isContext = audioContextOrOptions && typeof audioContextOrOptions.decodeAudioData === 'function';
  const options = isContext ? maybeOptions : audioContextOrOptions;
  const validation = validateAudioFile(file, options.limits);
  let context = isContext ? audioContextOrOptions : options.audioContext;
  let ownsContext = false;

  if (!context) {
    const ContextCtor = options.audioContextFactory ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!ContextCtor) throw new CustomAudioError('WEB_AUDIO_UNAVAILABLE', 'Web Audio is unavailable in this browser.');
    try {
      context = new ContextCtor();
      ownsContext = true;
    } catch (error) {
      throw new CustomAudioError('WEB_AUDIO_UNAVAILABLE', 'The browser blocked the local audio decoder.', { cause: error?.message });
    }
  }

  try {
    let encoded;
    try {
      encoded = await file.arrayBuffer();
    } catch (error) {
      throw new CustomAudioError('READ_FAILED', 'The browser could not read this local audio file.', { cause: error?.message });
    }
    const audioBuffer = await decodeAudioData(context, encoded);
    const analysis = analyzeAudioBuffer(audioBuffer, { limits: options.limits, tempo: options.tempo });
    const track = createCustomTrack(audioBuffer, analysis, {
      ...options,
      title: options.title || validation.name,
      fileName: validation.name,
    });
    return { track, analysis, audioBuffer };
  } finally {
    if (ownsContext && typeof context.close === 'function') {
      try { await context.close(); } catch { /* Closing a temporary decoder is best-effort. */ }
    }
  }
}
