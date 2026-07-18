import { CutDirection, GamePhase, Hand } from '../shared/contracts.js';

export const LANES = Object.freeze([-1.5, -0.5, 0.5, 1.5]);
// Beatmap lanes stay compatible with the authored -1.5…1.5 coordinate system,
// while the rendered play field is narrowed to an ergonomic 1.86 m span.
// This keeps every block inside a natural two-arm sweep in room-scale XR.
export const LANE_WORLD_SCALE = 0.62;
export const ROW_HEIGHT = 0.86;
export const NOTE_ROW_COUNT = 2;
// The judgement plane is intentionally inside arm's reach in room-scale XR.
// Desktop uses the same plane with a closer spectator camera.
export const NOTE_PLANE_Z = -0.82;
export const SPAWN_Z = -12;

export const DEFAULT_RULES = Object.freeze({
  spawnAhead: 2.35,
  missWindow: 0.28,
  hitWindow: 0.2,
  saberRadius: 0.34,
  minSweep: 0.08,
  directionCosine: 0.42,
  maxHealth: 100,
  hitHealth: 1.2,
  missDamage: 9,
  wrongCutDamage: 6,
  hazardDamage: 14,
  baseScore: 115,
  accentBonus: 35,
});

export function createGameState(overrides = {}) {
  return {
    phase: GamePhase.MENU,
    score: 0,
    combo: 0,
    maxCombo: 0,
    multiplier: 1,
    health: DEFAULT_RULES.maxHealth,
    hits: 0,
    misses: 0,
    damageTaken: 0,
    accuracySamples: [],
    startedAt: 0,
    endedAt: 0,
    ...overrides,
  };
}

export function multiplierForCombo(combo) {
  if (combo >= 32) return 8;
  if (combo >= 16) return 4;
  if (combo >= 8) return 2;
  return 1;
}

export function laneToX(lane) {
  return Number.isFinite(lane) ? lane * LANE_WORLD_SCALE : 0;
}

export function rowToY(row) {
  return 0.82 + Math.max(0, Math.min(NOTE_ROW_COUNT - 1, Number(row) || 0)) * ROW_HEIGHT;
}

export function noteWorldPosition(note, currentTime, rules = DEFAULT_RULES) {
  const timeToHit = note.time - currentTime;
  const progress = 1 - Math.max(0, Math.min(1, timeToHit / rules.spawnAhead));
  return {
    x: laneToX(note.lane),
    y: rowToY(note.row),
    z: SPAWN_Z + (NOTE_PLANE_Z - SPAWN_Z) * progress,
  };
}

const DIR_VECTORS = Object.freeze({
  [CutDirection.UP]: { x: 0, y: 1 },
  [CutDirection.DOWN]: { x: 0, y: -1 },
  [CutDirection.LEFT]: { x: -1, y: 0 },
  [CutDirection.RIGHT]: { x: 1, y: 0 },
  [CutDirection.UP_LEFT]: { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  [CutDirection.UP_RIGHT]: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  [CutDirection.DOWN_LEFT]: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
  [CutDirection.DOWN_RIGHT]: { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
});

export function directionVector(direction) {
  return DIR_VECTORS[direction] || null;
}

export function segmentDistanceSq(point, start, end) {
  const ax = Number(start?.x) || 0;
  const ay = Number(start?.y) || 0;
  const az = Number(start?.z) || 0;
  const bx = Number(end?.x) || 0;
  const by = Number(end?.y) || 0;
  const bz = Number(end?.z) || 0;
  const px = Number(point?.x) || 0;
  const py = Number(point?.y) || 0;
  const pz = Number(point?.z) || 0;
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const abLenSq = abx * abx + aby * aby + abz * abz;
  if (abLenSq <= 1e-8) {
    const dx = px - ax;
    const dy = py - ay;
    const dz = pz - az;
    return dx * dx + dy * dy + dz * dz;
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / abLenSq));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const cz = az + abz * t;
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  return dx * dx + dy * dy + dz * dz;
}

export function judgeCut(note, sweep, currentTime, rules = DEFAULT_RULES) {
  const timing = currentTime - note.time;
  if (Math.abs(timing) > rules.hitWindow) {
    return { ok: false, reason: timing < 0 ? 'early' : 'late', timing };
  }

  const position = noteWorldPosition(note, currentTime, rules);
  const distanceSq = segmentDistanceSq(position, sweep.start, sweep.end);
  if (distanceSq > rules.saberRadius * rules.saberRadius) {
    return { ok: false, reason: 'no-contact', timing, distance: Math.sqrt(distanceSq) };
  }

  const sx = (Number(sweep.end?.x) || 0) - (Number(sweep.start?.x) || 0);
  const sy = (Number(sweep.end?.y) || 0) - (Number(sweep.start?.y) || 0);
  const sweepLength = Math.hypot(sx, sy);
  if (sweepLength < rules.minSweep) {
    return { ok: false, reason: 'weak-sweep', timing, distance: Math.sqrt(distanceSq) };
  }

  if (note.hand && sweep.hand && note.hand !== sweep.hand) {
    return { ok: false, reason: 'wrong-hand', timing, distance: Math.sqrt(distanceSq) };
  }

  if (note.direction && note.direction !== CutDirection.ANY) {
    const expected = directionVector(note.direction);
    const alignment = expected ? (sx / sweepLength) * expected.x + (sy / sweepLength) * expected.y : 1;
    if (alignment < rules.directionCosine) {
      return { ok: false, reason: 'wrong-direction', timing, distance: Math.sqrt(distanceSq), alignment };
    }
    return { ok: true, reason: 'hit', timing, distance: Math.sqrt(distanceSq), alignment };
  }

  return { ok: true, reason: 'hit', timing, distance: Math.sqrt(distanceSq), alignment: 1 };
}

export class ScoreKeeper {
  constructor(rules = DEFAULT_RULES) {
    this.rules = rules;
    this.state = createGameState({ phase: GamePhase.MENU, health: rules.maxHealth });
    this.hasStarted = false;
  }

  setPhase(phase, at = 0) {
    this.state.phase = phase;
    if (phase === GamePhase.PLAYING && !this.hasStarted) {
      this.state.startedAt = at;
      this.hasStarted = true;
    }
    if (phase === GamePhase.RESULTS) this.state.endedAt = at;
    return this.snapshot();
  }

  hit(note, judgement = {}) {
    const timingScore = Math.max(0, 1 - Math.abs(judgement.timing || 0) / this.rules.hitWindow);
    this.state.combo += 1;
    this.state.maxCombo = Math.max(this.state.maxCombo, this.state.combo);
    this.state.multiplier = multiplierForCombo(this.state.combo);
    const noteScore = Math.round((this.rules.baseScore + (note.accent ? this.rules.accentBonus : 0)) * this.state.multiplier * (0.7 + timingScore * 0.3));
    this.state.score += noteScore;
    this.state.hits += 1;
    this.state.health = Math.min(this.rules.maxHealth, this.state.health + this.rules.hitHealth);
    this.state.accuracySamples.push(timingScore);
    return { noteScore, timingScore, state: this.snapshot() };
  }

  miss(reason = 'miss', damage = this.rules.missDamage) {
    this.state.combo = 0;
    this.state.multiplier = 1;
    this.state.misses += 1;
    this.damage(damage, reason, false);
    return this.snapshot();
  }

  wrongCut(reason = 'wrong-cut') {
    this.state.combo = 0;
    this.state.multiplier = 1;
    this.damage(this.rules.wrongCutDamage, reason, false);
    return this.snapshot();
  }

  damage(amount = this.rules.hazardDamage, reason = 'damage', countMiss = true) {
    if (countMiss) this.state.misses += 1;
    this.state.damageTaken += amount;
    this.state.health = Math.max(0, this.state.health - amount);
    if (this.state.health <= 0) this.state.phase = GamePhase.RESULTS;
    return { amount, reason, state: this.snapshot() };
  }

  results(totalNotes = this.state.hits + this.state.misses) {
    const accuracy = totalNotes > 0 ? this.state.hits / totalNotes : 0;
    const averageTiming = this.state.accuracySamples.length
      ? this.state.accuracySamples.reduce((a, b) => a + b, 0) / this.state.accuracySamples.length
      : 0;
    return {
      ...this.snapshot(),
      totalNotes,
      accuracy,
      averageTiming,
      grade: gradeForAccuracy(accuracy, this.state.health),
    };
  }

  snapshot() {
    const attempts = this.state.hits + this.state.misses;
    return {
      phase: this.state.phase,
      score: this.state.score,
      combo: this.state.combo,
      maxCombo: this.state.maxCombo,
      multiplier: this.state.multiplier,
      health: this.state.health,
      hits: this.state.hits,
      misses: this.state.misses,
      accuracy: attempts > 0 ? this.state.hits / attempts : 1,
      damageTaken: this.state.damageTaken,
      startedAt: this.state.startedAt,
      endedAt: this.state.endedAt,
    };
  }
}

export function gradeForAccuracy(accuracy, health) {
  if (health <= 0) return 'F';
  if (accuracy >= 0.98) return 'S';
  if (accuracy >= 0.92) return 'A';
  if (accuracy >= 0.82) return 'B';
  if (accuracy >= 0.7) return 'C';
  return 'D';
}

export class BeatmapRuntime {
  constructor(beatmap = [], rules = DEFAULT_RULES) {
    this.rules = rules;
    this.reset(beatmap);
  }

  reset(beatmap = this.beatmap) {
    this.beatmap = [...beatmap].sort((a, b) => a.time - b.time);
    this.nextIndex = 0;
    this.active = [];
    this.resolvedIds = new Set();
  }

  update(currentTime) {
    const spawned = [];
    const missed = [];
    while (this.nextIndex < this.beatmap.length && this.beatmap[this.nextIndex].time - currentTime <= this.rules.spawnAhead) {
      const note = { ...this.beatmap[this.nextIndex], spawnedAt: currentTime };
      this.active.push(note);
      spawned.push(note);
      this.nextIndex += 1;
    }
    const keep = [];
    for (const note of this.active) {
      if (this.resolvedIds.has(note.id)) continue;
      if (currentTime - note.time > this.rules.missWindow) {
        this.resolvedIds.add(note.id);
        missed.push(note);
      } else {
        keep.push(note);
      }
    }
    this.active = keep;
    return { spawned, missed, active: [...this.active], complete: this.isComplete() };
  }

  resolve(noteId) {
    this.resolvedIds.add(noteId);
    this.active = this.active.filter((note) => note.id !== noteId);
  }

  isComplete() {
    return this.nextIndex >= this.beatmap.length && this.active.length === 0;
  }
}

export function createDesktopSweep(hand, lane, row, direction, atTime) {
  const center = { x: laneToX(lane), y: rowToY(row), z: NOTE_PLANE_Z };
  const vec = directionVector(direction) || { x: hand === Hand.LEFT ? 1 : -1, y: 0 };
  return {
    hand,
    start: { x: center.x - vec.x * 0.45, y: center.y - vec.y * 0.45, z: center.z },
    end: { x: center.x + vec.x * 0.45, y: center.y + vec.y * 0.45, z: center.z },
    time: atTime,
    source: 'desktop',
  };
}
