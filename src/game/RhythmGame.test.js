import { describe, expect, it } from 'vitest';
import { TRACKS, createBeatmap } from '../data/tracks.js';
import { createBeatmapFromTrack } from './RhythmGame.js';

describe('RhythmGame track integration', () => {
  it.each(TRACKS.map((track) => [track.id, track]))('uses the authored deterministic beatmap for %s', (_id, track) => {
    const expected = createBeatmap(track);
    const actual = createBeatmapFromTrack(track);

    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(40);
    expect(new Set(actual.map((note) => note.direction)).size).toBeGreaterThan(3);
  });

  it('retains a safe generated fallback for unknown custom tracks', () => {
    const notes = createBeatmapFromTrack({ id: 'guest-rift', bpm: 120, duration: 30 });
    expect(notes.length).toBeGreaterThan(10);
    expect(notes.every((note) => note.id.startsWith('guest-rift-'))).toBe(true);
  });
});
