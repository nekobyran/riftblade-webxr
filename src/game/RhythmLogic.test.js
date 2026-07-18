import { describe, expect, it } from 'vitest';
import { CutDirection, GamePhase, Hand } from '../shared/contracts.js';
import {
  BeatmapRuntime,
  DEFAULT_RULES,
  LANES,
  LANE_WORLD_SCALE,
  NOTE_PLANE_Z,
  NOTE_ROW_COUNT,
  ObstacleRuntime,
  ScoreKeeper,
  createDesktopSweep,
  createObstacleMap,
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

describe('ergonomic four-lane, two-row play field', () => {
  it('keeps all four authored lanes inside a natural two-arm span', () => {
    expect(LANES).toHaveLength(4);
    expect(LANE_WORLD_SCALE).toBeLessThan(0.7);
    expect(LANES.map((lane) => Number(laneToX(lane).toFixed(2)))).toEqual([-0.93, -0.31, 0.31, 0.93]);
    expect(Math.max(...LANES.map((lane) => Math.abs(laneToX(lane))))).toBeLessThan(1);
  });

  it('uses exactly two readable height rows and a near-body hit plane', () => {
    expect(NOTE_ROW_COUNT).toBe(2);
    expect(rowToY(1)).toBeGreaterThan(rowToY(0));
    expect(rowToY(2)).toBe(rowToY(1));
    expect(NOTE_PLANE_Z).toBeLessThanOrEqual(-0.6);
    expect(NOTE_PLANE_Z).toBeGreaterThanOrEqual(-1);
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

  it('preserves a zero-based start timestamp across pause and resume', () => {
    const score = new ScoreKeeper();
    score.setPhase(GamePhase.PLAYING, 0);
    score.setPhase(GamePhase.PAUSED, 12);
    score.setPhase(GamePhase.PLAYING, 15);

    expect(score.snapshot().startedAt).toBe(0);
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

describe('createObstacleMap', () => {
  it('generates a deterministic, safe and reasonably spaced map from track metadata', () => {
    const track = { id: 'cosmic-drive', bpm: 128, duration: 80 };
    const first = createObstacleMap(track);
    const second = createObstacleMap({ ...track });

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThanOrEqual(6);
    expect(first.length).toBeLessThanOrEqual(12);
    expect(new Set(first.map((obstacle) => obstacle.id)).size).toBe(first.length);
    expect(new Set(first.map((obstacle) => obstacle.time)).size).toBe(first.length);
    for (const obstacle of first) {
      expect(obstacle.time).toBeGreaterThanOrEqual(5);
      expect(obstacle.time).toBeLessThanOrEqual(track.duration - 2.5);
      expect([-1, 1]).toContain(obstacle.blockedLane);
      expect(obstacle.safeLane).toBe(-obstacle.blockedLane);
      expect(typeof obstacle.accent).toBe('boolean');
    }
    expect(first.map((obstacle) => obstacle.time)).toEqual([...first].sort((a, b) => a.time - b.time).map((obstacle) => obstacle.time));
  });

  it('uses the track id as part of the deterministic arrangement seed', () => {
    const first = createObstacleMap({ id: 'alpha', bpm: 120, duration: 64 });
    const second = createObstacleMap({ id: 'beta', bpm: 120, duration: 64 });

    expect(second).not.toEqual(first);
  });

  it('prefers and normalizes authored obstacles without mutating the source', () => {
    const obstacles = [
      { id: 'wall', time: 4, blockedLane: 1, safeLane: 1, accent: 1 },
      { id: 'wall', time: 9, blockedLane: -1 },
      { id: 'same-time-is-unsafe', time: 9, blockedLane: 1 },
      { id: 'outside-track', time: 25, blockedLane: 1 },
    ];
    const snapshot = structuredClone(obstacles);

    expect(createObstacleMap({ id: 'authored', bpm: 120, duration: 20, obstacles })).toEqual([
      { id: 'wall', time: 4, blockedLane: 1, safeLane: -1, accent: true },
      { id: 'wall-2', time: 9, blockedLane: -1, safeLane: 1, accent: false },
    ]);
    expect(obstacles).toEqual(snapshot);
    expect(createObstacleMap({ id: 'no-walls', bpm: 120, duration: 80, obstacles: [] })).toEqual([]);
  });

  it('returns no generated obstacles when metadata is invalid or the song is too short', () => {
    expect(createObstacleMap({ id: 'missing-duration', bpm: 120 })).toEqual([]);
    expect(createObstacleMap({ id: 'tutorial-only', bpm: 60, duration: 12 })).toEqual([]);
  });
});

describe('ObstacleRuntime', () => {
  const obstacles = [
    { id: 'left-safe', time: 5, blockedLane: 1, safeLane: -1, accent: false },
    { id: 'right-safe', time: 8, blockedLane: -1, safeLane: 1, accent: true },
  ];

  it('spawns ahead, then settles a safe dodge and a collision exactly once', () => {
    const runtime = new ObstacleRuntime(obstacles, { spawnAhead: 2 });

    expect(runtime.update(2.999, -1).spawned).toEqual([]);
    expect(runtime.update(3, -1).spawned.map((obstacle) => obstacle.id)).toEqual(['left-safe']);
    expect(runtime.update(4.999, -1).active.map((obstacle) => obstacle.id)).toEqual(['left-safe']);

    const firstSettlement = runtime.update(5, -1);
    expect(firstSettlement.passed.map((obstacle) => obstacle.id)).toEqual(['left-safe']);
    expect(firstSettlement.collided).toEqual([]);

    expect(runtime.update(6, -1).spawned.map((obstacle) => obstacle.id)).toEqual(['right-safe']);
    const secondSettlement = runtime.update(8, -1);
    expect(secondSettlement.collided.map((obstacle) => obstacle.id)).toEqual(['right-safe']);
    expect(secondSettlement.collided[0]).toMatchObject({ playerLane: -1, outcome: 'collided', resolvedAt: 8 });
    expect(secondSettlement.passed).toEqual([]);
    expect(secondSettlement.active).toEqual([]);
    expect(secondSettlement.complete).toBe(true);

    const repeated = runtime.update(9, 1);
    expect(repeated.collided).toEqual([]);
    expect(repeated.passed).toEqual([]);
    expect(repeated.complete).toBe(true);
  });

  it('allows explicit resolution and reset without double settlement', () => {
    const runtime = new ObstacleRuntime(obstacles, { spawnAhead: 10 });
    runtime.update(0, 0);

    expect(runtime.resolve('left-safe', -1, 4.8)).toMatchObject({ id: 'left-safe', outcome: 'passed', resolvedAt: 4.8 });
    expect(runtime.resolve('left-safe', 1, 5)).toBeNull();
    expect(runtime.isComplete()).toBe(false);
    expect(runtime.resolve('right-safe', 1)).toMatchObject({ id: 'right-safe', outcome: 'passed', resolvedAt: 8 });
    expect(runtime.isComplete()).toBe(true);

    runtime.reset();
    expect(runtime.isComplete()).toBe(false);
    expect(runtime.update(0, 0).active.map((obstacle) => obstacle.id)).toEqual(['left-safe', 'right-safe']);
  });

  it('normalizes player positions to left/right sides and handles empty maps', () => {
    const runtime = new ObstacleRuntime([obstacles[0]], 0);
    const result = runtime.update(5, -1.5);

    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].playerLane).toBe(-1);
    expect(new ObstacleRuntime([]).isComplete()).toBe(true);
  });
});
