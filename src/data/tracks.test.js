import { describe, expect, it } from 'vitest';
import { CutDirection, Hand } from '../shared/contracts.js';
import { TRACKS, createBeatmap, getTrack } from './tracks.js';

const directions = new Set(Object.values(CutDirection));
const hands = new Set(Object.values(Hand));

describe('TRACKS', () => {
  it('defines three different original tracks with complete gameplay metadata', () => {
    expect(TRACKS).toHaveLength(3);
    expect(new Set(TRACKS.map((track) => track.id)).size).toBe(3);
    expect(new Set(TRACKS.map((track) => track.metadata.style)).size).toBe(3);

    for (const track of TRACKS) {
      expect(track.duration).toBeGreaterThanOrEqual(70);
      expect(track.previewStart).toBeGreaterThan(0);
      expect(track.previewStart).toBeLessThan(track.duration);
      expect(track.palette.primary).toMatch(/^#/);
      expect(track.environment.biome).toBeTruthy();
      expect(track.environment.landmarks.length).toBeGreaterThanOrEqual(3);
      expect(track.damageStyle.name).toBeTruthy();
      expect(track.damageStyle.haptics.length).toBeGreaterThan(0);
      expect(track.music.seed).toBeTruthy();
      expect(track.music.arrangement.length).toBeGreaterThanOrEqual(4);
      expect(track.music.recipe.noteStrideBeats).toBeGreaterThan(0);
      expect(track.music.instruments.lead.pattern).toBeTruthy();
      expect(track.music.instruments.percussion.kick).toBeTruthy();
    }
  });

  it('returns tracks by id', () => {
    expect(getTrack('ember-circuit-choir')?.title).toBe('Ember Circuit Choir');
    expect(getTrack('missing-track')).toBeUndefined();
  });
});

describe('createBeatmap', () => {
  it('creates deterministic valid note maps that run beyond seventy seconds', () => {
    for (const track of TRACKS) {
      const first = createBeatmap(track);
      const second = createBeatmap(track.id);
      expect(first).toEqual(second);
      expect(first.length).toBeGreaterThan(90);
      expect(first.at(-1).time).toBeGreaterThanOrEqual(70);
      expect(first.at(-1).time).toBeLessThan(track.duration);

      for (let index = 0; index < first.length; index += 1) {
        const note = first[index];
        expect(note.id).toBe(`${track.id}-${String(index).padStart(4, '0')}`);
        expect(note.time).toBeGreaterThanOrEqual(0);
        expect(note.time).toBeLessThan(track.duration);
        if (index > 0) expect(note.time).toBeGreaterThanOrEqual(first[index - 1].time);
        expect(note.lane).toBeGreaterThanOrEqual(-1.5);
        expect(note.lane).toBeLessThanOrEqual(1.5);
        expect(note.row).toBeGreaterThanOrEqual(0);
        expect(note.row).toBeLessThanOrEqual(2);
        expect(hands.has(note.hand)).toBe(true);
        expect(directions.has(note.direction)).toBe(true);
      }
    }
  });

  it('keeps each track rhythmically distinct', () => {
    const signatures = TRACKS.map((track) =>
      createBeatmap(track)
        .slice(0, 24)
        .map((note) => `${note.time}:${note.lane}:${note.row}:${note.direction}`)
        .join('|'),
    );
    expect(new Set(signatures).size).toBe(TRACKS.length);
  });

  it('rejects unknown tracks', () => {
    expect(() => createBeatmap('not-real')).toThrow(/Unknown track/);
  });
});
