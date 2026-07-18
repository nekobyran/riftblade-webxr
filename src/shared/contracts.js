export const Hand = Object.freeze({ LEFT: 'left', RIGHT: 'right' });

export const CutDirection = Object.freeze({
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
  UP_LEFT: 'up-left',
  UP_RIGHT: 'up-right',
  DOWN_LEFT: 'down-left',
  DOWN_RIGHT: 'down-right',
  ANY: 'any',
});

export const GamePhase = Object.freeze({
  MENU: 'menu',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  PAUSED: 'paused',
  RESULTS: 'results',
});

export const GameplayEvent = Object.freeze({
  TICK: 'game:tick',
  NOTE_HIT: 'game:note-hit',
  NOTE_MISS: 'game:note-miss',
  DAMAGE: 'game:damage',
  PHASE: 'game:phase',
  RESULTS: 'game:results',
  XR_CHANGE: 'game:xr-change',
});
