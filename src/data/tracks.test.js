import { describe, expect, it } from 'vitest';
import { CutDirection, Hand } from '../shared/contracts.js';
import { TRACKS, createBeatmap, getTrack } from './tracks.js';

const directions = new Set(Object.values(CutDirection));
const realDirections = new Set([
  CutDirection.DOWN,
  CutDirection.UP,
  CutDirection.LEFT,
  CutDirection.RIGHT,
  CutDirection.DOWN_LEFT,
  CutDirection.DOWN_RIGHT,
  CutDirection.UP_LEFT,
  CutDirection.UP_RIGHT,
]);
const hands = new Set(Object.values(Hand));

describe('TRACKS', () => {
  it('defines ten different original tracks with complete gameplay metadata', () => {
    expect(TRACKS).toHaveLength(10);
    expect(new Set(TRACKS.map((track) => track.id)).size).toBe(10);
    expect(new Set(TRACKS.map((track) => track.bpm)).size).toBe(10);
    expect(new Set(TRACKS.map((track) => track.metadata.style)).size).toBe(10);
    expect(new Set(TRACKS.map((track) => track.environment.theme)).size).toBe(10);
    expect(new Set(TRACKS.map((track) => track.damageStyle.name)).size).toBe(10);
    expect(new Set(TRACKS.map((track) => track.music.profile)).size).toBe(10);
    expect(new Set(TRACKS.map((track) => track.metadata.titleZh)).size).toBe(10);

    for (const track of TRACKS) {
      expect(track.duration).toBeGreaterThanOrEqual(70);
      expect(track.metadata.titleZh).toMatch(/[\u4e00-\u9fff]/);
      expect(track.previewStart).toBeGreaterThan(0);
      expect(track.previewStart).toBeLessThan(track.duration);
      expect(track.palette.primary).toMatch(/^#/);
      expect(track.environment.biome).toBeTruthy();
      expect(track.environment.landmarks.length).toBeGreaterThanOrEqual(3);
      expect(track.damageStyle.name).toBeTruthy();
      expect(track.damageStyle.haptics.length).toBeGreaterThan(0);
      expect(track.music.seed).toBeTruthy();
      expect(track.music.arrangement.length).toBeGreaterThanOrEqual(4);
      expect(track.music.arrangement[0].from).toBe(0);
      expect(track.music.arrangement.at(-1).to).toBe(track.duration);
      track.music.arrangement.forEach((section, index) => {
        expect(section.from).toBeLessThan(section.to);
        if (index > 0) expect(section.from).toBe(track.music.arrangement[index - 1].to);
      });
      expect(track.music.recipe.noteStrideBeats).toBeGreaterThan(0);
      expect(track.music.instruments.lead.pattern).toBeTruthy();
      expect(track.music.instruments.bass.pattern).toBeTruthy();
      expect(track.music.instruments.pad.pattern).toBeTruthy();
      expect(track.music.instruments.percussion.kick).toBeTruthy();
      expect(track.music.instruments.percussion.snare).toBeTruthy();
      expect(track.music.instruments.percussion.hats).toBeTruthy();
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
      expect(new Set(first.map((note) => note.lane))).toEqual(new Set([-1.5, -0.5, 0.5, 1.5]));
      expect(new Set(first.map((note) => note.row))).toEqual(new Set([0, 1]));
      expect(new Set(first.map((note) => note.direction))).toEqual(realDirections);

      for (let index = 0; index < first.length; index += 1) {
        const note = first[index];
        expect(note.id).toBe(`${track.id}-${String(index).padStart(4, '0')}`);
        expect(note.time).toBeGreaterThanOrEqual(0);
        expect(note.time).toBeLessThan(track.duration);
        if (index > 0) expect(note.time).toBeGreaterThanOrEqual(first[index - 1].time);
        expect(note.lane).toBeGreaterThanOrEqual(-1.5);
        expect(note.lane).toBeLessThanOrEqual(1.5);
        expect(note.row).toBeGreaterThanOrEqual(0);
        expect(note.row).toBeLessThanOrEqual(1);
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

  it('normalizes attached local beatmaps without mutating their source', () => {
    const source = [{ id: 'old', time: 2, lane: -0.5, row: 7, hand: Hand.LEFT, direction: CutDirection.UP }];
    const normalized = createBeatmap({ id: 'custom-test', duration: 4, beatmap: source });
    expect(normalized).toEqual([{ id: 'custom-test-0000', time: 2, lane: -0.5, row: 1, hand: Hand.LEFT, direction: CutDirection.UP }]);
    expect(source[0].row).toBe(7);
  });

  it('snaps imported notes to real four-lane, two-row, eight-direction blocks', () => {
    const source = [
      { time: 1, lane: -0.92, row: -3, hand: 'unknown', direction: CutDirection.ANY },
      { time: 2, lane: 0.18, row: 8, hand: Hand.RIGHT, direction: 'spin' },
    ];
    const normalized = createBeatmap({ id: 'custom-snap', duration: 4, beatmap: source });
    expect(normalized.map((note) => note.lane)).toEqual([-0.5, 0.5]);
    expect(normalized.map((note) => note.row)).toEqual([0, 1]);
    expect(normalized[0].hand).toBe(Hand.LEFT);
    expect(normalized.every((note) => realDirections.has(note.direction))).toBe(true);
    expect(normalized.every((note) => note.direction !== CutDirection.ANY)).toBe(true);
  });
});
