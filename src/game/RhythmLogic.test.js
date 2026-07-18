import { describe, expect, it } from 'vitest';
import { CutDirection, GamePhase, Hand } from '../shared/contracts.js';
import {
  BeatmapRuntime,
  DEFAULT_RULES,
  ScoreKeeper,
  createDesktopSweep,
  judgeCut,
  laneToX,
  multiplierForCombo,
  noteWorldPosition,
  rowToY,
  segmentDistanceSq,
} from './RhythmLogic.js';

describe('RhythmLogic sweep judgement', () => {
  const note = {
    id: 'n1',
    time: 10,
    lane: -0.5,
    row: 1,
    hand: Hand.LEFT,
    direction: CutDirection.UP,
  };

  it('accepts a timed swept cut with correct hand and direction', () => {
    const sweep = createDesktopSweep(Hand.LEFT, note.lane, note.row, CutDirection.UP, 10.02);
    const judgement = judgeCut(note, sweep, 10.02);

    expect(judgement.ok).toBe(true);
    expect(judgement.reason).toBe('hit');
    expect(Math.abs(judgement.timing)).toBeLessThan(DEFAULT_RULES.hitWindow);
    expect(judgement.alignment).toBeGreaterThan(0.9);
  });

  it('rejects wrong hand before scoring a note', () => {
    const sweep = createDesktopSweep(Hand.RIGHT, note.lane, note.row, CutDirection.UP, 10);
    const judgement = judgeCut(note, sweep, 10);

    expect(judgement.ok).toBe(false);
    expect(judgement.reason).toBe('wrong-hand');
  });

  it('rejects wrong cut direction while contact still happened', () => {
    const sweep = createDesktopSweep(Hand.LEFT, note.lane, note.row, CutDirection.DOWN, 10);
    const judgement = judgeCut(note, sweep, 10);

    expect(judgement.ok).toBe(false);
    expect(judgement.reason).toBe('wrong-direction');
    expect(judgement.distance).toBeLessThan(DEFAULT_RULES.saberRadius);
  });

  it('rejects late or early swings outside the hit window', () => {
    const sweep = createDesktopSweep(Hand.LEFT, note.lane, note.row, CutDirection.UP, 10.5);

    expect(judgeCut(note, sweep, 9.7).reason).toBe('early');
    expect(judgeCut(note, sweep, 10.4).reason).toBe('late');
  });

  it('measures swept segment distance in 3D lane space', () => {
    const point = noteWorldPosition(note, 10);
    const distanceSq = segmentDistanceSq(
      point,
      { x: laneToX(note.lane) - 0.5, y: rowToY(note.row), z: point.z },
      { x: laneToX(note.lane) + 0.5, y: rowToY(note.row), z: point.z },
    );

    expect(distanceSq).toBeCloseTo(0, 5);
  });
});

describe('ScoreKeeper', () => {
  it('tracks combo thresholds, multiplier, score, health and results', () => {
    const score = new ScoreKeeper();
    score.setPhase(GamePhase.PLAYING, 0);
    const note = { id: 'n', accent: false };

    for (let i = 0; i < 8; i += 1) score.hit({ ...note, id: `n${i}` }, { timing: 0 });

    expect(multiplierForCombo(7)).toBe(1);
    expect(score.snapshot().combo).toBe(8);
    expect(score.snapshot().multiplier).toBe(2);
    expect(score.snapshot().maxCombo).toBe(8);
    expect(score.snapshot().score).toBeGreaterThan(8 * DEFAULT_RULES.baseScore);
    expect(score.snapshot().health).toBe(DEFAULT_RULES.maxHealth);

    score.miss('miss');
    expect(score.snapshot().combo).toBe(0);
    expect(score.snapshot().health).toBe(DEFAULT_RULES.maxHealth - DEFAULT_RULES.missDamage);
    expect(score.snapshot().accuracy).toBeCloseTo(8 / 9, 5);

    const results = score.results(9);
    expect(results.accuracy).toBeCloseTo(8 / 9, 5);
    expect(results.grade).toBe('B');
  });

  it('ends in results when accumulated damage depletes health', () => {
    const score = new ScoreKeeper();
    score.damage(120, 'hazard');

    expect(score.snapshot().health).toBe(0);
    expect(score.snapshot().phase).toBe(GamePhase.RESULTS);
    expect(score.results(1).grade).toBe('F');
  });
});

describe('BeatmapRuntime', () => {
  const beatmap = [
    { id: 'a', time: 1, lane: -1.5, row: 0, hand: Hand.LEFT, direction: CutDirection.ANY },
    { id: 'b', time: 2, lane: 0.5, row: 1, hand: Hand.RIGHT, direction: CutDirection.DOWN },
  ];

  it('spawns notes ahead of the audio clock and resolves hits', () => {
    const runtime = new BeatmapRuntime(beatmap, { ...DEFAULT_RULES, spawnAhead: 1, missWindow: 0.25 });

    expect(runtime.update(-0.1).spawned.map((n) => n.id)).toEqual([]);
    expect(runtime.update(0).spawned.map((n) => n.id)).toEqual(['a']);
    runtime.resolve('a');
    expect(runtime.active.map((n) => n.id)).toEqual([]);
    expect(runtime.update(1).spawned.map((n) => n.id)).toEqual(['b']);
  });

  it('reports miss after the miss window and completes after all notes resolve', () => {
    const runtime = new BeatmapRuntime(beatmap, { ...DEFAULT_RULES, spawnAhead: 10, missWindow: 0.1 });

    runtime.update(0);
    const update = runtime.update(2.2);

    expect(update.missed.map((n) => n.id)).toEqual(['a', 'b']);
    expect(update.complete).toBe(true);
  });
});
