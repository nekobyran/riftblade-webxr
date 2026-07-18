import { GamePhase, GameplayEvent } from '../shared/contracts.js';

const DEFAULT_HUD = Object.freeze({
  score: 0,
  combo: 0,
  bestCombo: 0,
  accuracy: 100,
  life: 1,
  progress: 0,
  time: 0,
  duration: 0,
  hits: 0,
  misses: 0,
});

const XR_COPY = Object.freeze({
  checking: '正在检测头显通道',
  ready: 'VR 通道可用',
  insecure: 'VR 需要 HTTPS 或 localhost 安全上下文',
  unsupported: '当前浏览器未开放 immersive-vr',
  unavailable: '此设备未报告 WebXR 能力',
  presenting: 'VR 沉浸中',
});

export class AppUI {
  constructor({ root, game, music, tracks = [], eventTarget = null }) {
    this.root = root;
    this.game = game;
    this.music = music;
    this.tracks = tracks;
    this.eventTarget = eventTarget ?? new EventTarget();

    this.state = {
      phase: GamePhase.MENU,
      selectedTrackId: tracks[0]?.id ?? null,
      hud: { ...DEFAULT_HUD, duration: tracks[0]?.duration ?? 0 },
      results: null,
      muted: false,
      xr: {
        status: 'checking',
        secure: Boolean(globalThis.isSecureContext),
        supported: false,
        presenting: false,
        detail: XR_COPY.checking,
      },
      countdown: null,
      lastSignal: 'SYSTEM READY',
      impact: null,
    };

    this.abortController = new AbortController();
    this.pendingFocus = null;
    this.lastHudRenderAt = 0;
    this.launchToken = 0;
    this.impactTimer = null;

    this.handleRootClick = this.handleRootClick.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);
    this.handleTick = this.handleTick.bind(this);
    this.handlePhase = this.handlePhase.bind(this);
    this.handleResults = this.handleResults.bind(this);
    this.handleDamage = this.handleDamage.bind(this);
    this.handleHit = this.handleHit.bind(this);
    this.handleMiss = this.handleMiss.bind(this);
    this.handleXRChange = this.handleXRChange.bind(this);
  }

  async initialize() {
    if (!this.root) {
      throw new Error('AppUI requires a root element.');
    }

    this.bindEvents();
    this.render();
    await this.refreshXRStatus();
    this.render();
    this.focus('[data-action="start"]');
  }

  dispose() {
    this.abortController.abort();
    if (this.impactTimer) {
      clearTimeout(this.impactTimer);
      this.impactTimer = null;
    }
    this.root?.replaceChildren();
  }

  bindEvents() {
    const { signal } = this.abortController;
    this.root.addEventListener('click', this.handleRootClick, { signal });
    document.addEventListener('keydown', this.handleKeydown, { signal });

    this.eventTarget.addEventListener(GameplayEvent.TICK, this.handleTick, { signal });
    this.eventTarget.addEventListener(GameplayEvent.PHASE, this.handlePhase, { signal });
    this.eventTarget.addEventListener(GameplayEvent.RESULTS, this.handleResults, { signal });
    this.eventTarget.addEventListener(GameplayEvent.DAMAGE, this.handleDamage, { signal });
    this.eventTarget.addEventListener(GameplayEvent.NOTE_HIT, this.handleHit, { signal });
    this.eventTarget.addEventListener(GameplayEvent.NOTE_MISS, this.handleMiss, { signal });
    this.eventTarget.addEventListener(GameplayEvent.XR_CHANGE, this.handleXRChange, { signal });
  }

  async refreshXRStatus() {
    const secure = Boolean(globalThis.isSecureContext);
    const xr = navigator.xr;

    if (!secure) {
      this.state.xr = {
        status: 'insecure',
        secure,
        supported: false,
        presenting: false,
        detail: XR_COPY.insecure,
      };
      return;
    }

    if (!xr?.isSessionSupported) {
      this.state.xr = {
        status: 'unavailable',
        secure,
        supported: false,
        presenting: false,
        detail: XR_COPY.unavailable,
      };
      return;
    }

    try {
      const supported = await xr.isSessionSupported('immersive-vr');
      this.state.xr = {
        status: supported ? 'ready' : 'unsupported',
        secure,
        supported,
        presenting: false,
        detail: supported ? XR_COPY.ready : XR_COPY.unsupported,
      };
    } catch (error) {
      this.state.xr = {
        status: 'unsupported',
        secure,
        supported: false,
        presenting: false,
        detail: String(error?.message || XR_COPY.unsupported),
      };
    }
  }

  handleRootClick(event) {
    const control = event.target.closest('[data-action]');
    if (!control) return;

    const action = control.dataset.action;
    const trackId = control.dataset.trackId;

    if (trackId) {
      this.selectTrack(trackId);
    }

    if (action === 'select-track') return;
    if (action === 'start') void this.startSelected();
    if (action === 'pause') this.pause();
    if (action === 'resume') this.resume();
    if (action === 'restart') this.restart();
    if (action === 'return-menu') this.returnToMenu();
    if (action === 'toggle-mute') this.toggleMute();
  }

  handleKeydown(event) {
    if (event.defaultPrevented || this.isTypingTarget(event.target)) return;

    if (/^[1-3]$/.test(event.key)) {
      const track = this.tracks[Number(event.key) - 1];
      if (track) {
        event.preventDefault();
        this.selectTrack(track.id);
      }
    }

    if (event.key === 'Escape') {
      if (this.state.phase === GamePhase.PLAYING) {
        event.preventDefault();
        this.pause();
      } else if (this.state.phase === GamePhase.PAUSED) {
        event.preventDefault();
        this.resume();
      }
    }

    if (event.key.toLowerCase() === 'm') {
      event.preventDefault();
      this.toggleMute();
    }

    if (event.key.toLowerCase() === 'r' && this.state.phase === GamePhase.RESULTS) {
      event.preventDefault();
      this.restart();
    }
  }

  isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    const tagName = target.tagName.toLowerCase();
    return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
  }

  selectTrack(trackId) {
    const track = this.tracks.find((candidate) => candidate.id === trackId);
    if (!track) return;

    this.state.selectedTrackId = track.id;
    this.state.hud = {
      ...DEFAULT_HUD,
      duration: track.duration ?? DEFAULT_HUD.duration,
      life: 1,
    };
    this.state.results = null;
    this.state.lastSignal = `${this.trackTitle(track)} 已锁定`;
    this.music?.setIntensity?.(0.35);
    this.safeCall(() => this.game?.loadTrack?.(track));
    this.render();
    this.focus('[data-action="start"]');
  }

  async startSelected() {
    const track = this.selectedTrack();
    if (!track) return;

    try {
      const token = ++this.launchToken;
      this.state.phase = GamePhase.COUNTDOWN;
      this.state.results = null;
      this.state.lastSignal = '裂界同步中';
      this.game?.loadTrack?.(track);
      for (const count of [3, 2, 1]) {
        if (token !== this.launchToken) return;
        this.state.countdown = count;
        this.state.lastSignal = count === 1 ? '第一拍就绪' : `裂界开启 ${count}`;
        this.render();
        await delay(650);
      }
      if (token !== this.launchToken) return;
      await this.game?.start?.();
    } catch (error) {
      this.state.phase = GamePhase.MENU;
      this.state.lastSignal = `启动失败：${String(error?.message || error)}`;
      this.render();
    }
  }

  pause() {
    this.safeCall(() => this.game?.pause?.());
  }

  resume() {
    this.safeCall(() => this.game?.resume?.());
  }

  restart() {
    this.state.results = null;
    this.state.impact = null;
    this.safeCall(() => this.game?.restart?.());
  }

  returnToMenu() {
    this.launchToken += 1;
    this.state.phase = GamePhase.MENU;
    this.state.results = null;
    this.state.countdown = null;
    this.state.impact = null;
    this.state.hud = {
      ...DEFAULT_HUD,
      duration: this.selectedTrack()?.duration ?? 0,
    };
    this.state.lastSignal = '选曲通道已复位';
    if (this.impactTimer) {
      clearTimeout(this.impactTimer);
      this.impactTimer = null;
    }
    this.safeCall(() => this.game?.returnToMenu?.());
    this.safeCall(() => this.music?.stop?.());
    this.music?.setIntensity?.(0.25);
    this.render();
    this.focus('[data-action="start"]');
  }

  toggleMute() {
    this.state.muted = !this.state.muted;
    this.music?.setMuted?.(this.state.muted);
    this.state.lastSignal = this.state.muted ? '音频静默' : '音频恢复';
    this.render();
  }

  safeCall(callback) {
    try {
      return callback();
    } catch (error) {
      this.state.lastSignal = String(error?.message || error);
      return undefined;
    }
  }

  handleTick(event) {
    const detail = event.detail ?? {};
    const state = detail.state ?? detail;
    const selectedTrack = this.selectedTrack();
    const nextHud = {
      ...this.state.hud,
      score: numberValue(state.score, this.state.hud.score),
      combo: numberValue(state.combo, this.state.hud.combo),
      bestCombo: numberValue(state.bestCombo ?? state.maxCombo, this.state.hud.bestCombo),
      accuracy: normalizedAccuracy(state.accuracy, this.state.hud.accuracy),
      life: normalizedLife(state.life ?? state.health, this.state.hud.life),
      progress: normalizedProgress(detail.progress, detail.time ?? detail.currentTime, detail.duration ?? selectedTrack?.duration),
      time: numberValue(detail.time ?? detail.currentTime, this.state.hud.time),
      duration: numberValue(detail.duration ?? selectedTrack?.duration, this.state.hud.duration),
      hits: numberValue(state.hits, this.state.hud.hits),
      misses: numberValue(state.misses, this.state.hud.misses),
    };
    this.state.hud = nextHud;
    const now = performance.now();
    if (now - this.lastHudRenderAt >= 80) {
      this.lastHudRenderAt = now;
      this.render();
    }
  }

  handlePhase(event) {
    const detail = event.detail ?? {};
    const phase = typeof detail === 'string' ? detail : detail.phase;
    if (phase) this.state.phase = phase;

    if ('countdown' in detail || 'count' in detail) {
      this.state.countdown = detail.countdown ?? detail.count;
    } else if (this.state.phase !== GamePhase.COUNTDOWN) {
      this.state.countdown = null;
    }

    if (detail.message) this.state.lastSignal = detail.message;
    if (this.state.phase === GamePhase.PLAYING) this.music?.setIntensity?.(0.8);
    if (this.state.phase === GamePhase.PAUSED) this.music?.setIntensity?.(0.45);
    if (this.state.phase === GamePhase.RESULTS) this.music?.setIntensity?.(0.25);

    this.render();
    if (this.state.phase === GamePhase.PAUSED) this.focus('[data-action="resume"]');
    if (this.state.phase === GamePhase.RESULTS) this.focus('[data-action="restart"]');
  }

  handleResults(event) {
    this.state.phase = GamePhase.RESULTS;
    this.state.results = event.detail ?? {};
    this.state.countdown = null;
    this.state.lastSignal = this.state.results.failed ? '同步崩解，请重新校准' : '裂界稳定，结果已记录';
    this.music?.setIntensity?.(0.2);
    this.render();
    this.focus('[data-action="restart"]');
  }

  handleDamage(event) {
    const detail = event.detail ?? {};
    const state = detail.state ?? detail;
    this.state.impact = {
      at: performance.now(),
      label: detail.reason || detail.type || '护盾受损',
    };
    this.state.hud = {
      ...this.state.hud,
      life: normalizedLife(state.life ?? state.health, Math.max(0, this.state.hud.life - 0.12)),
      misses: numberValue(state.misses, this.state.hud.misses),
    };
    this.state.lastSignal = this.state.impact.label;
    this.render();
    if (this.impactTimer) clearTimeout(this.impactTimer);
    this.impactTimer = setTimeout(() => {
      this.state.impact = null;
      this.impactTimer = null;
      this.render();
    }, 860);
  }

  handleHit(event) {
    const detail = event.detail ?? {};
    const state = detail.state ?? detail;
    this.state.hud = {
      ...this.state.hud,
      score: numberValue(state.score, this.state.hud.score),
      combo: numberValue(state.combo, this.state.hud.combo + 1),
      bestCombo: Math.max(this.state.hud.bestCombo, numberValue(state.maxCombo ?? state.combo, this.state.hud.combo + 1)),
      accuracy: normalizedAccuracy(state.accuracy, this.state.hud.accuracy),
      hits: numberValue(state.hits, this.state.hud.hits + 1),
    };
    const judgement = typeof detail.judgement === 'string' ? detail.judgement : detail.judgement?.reason;
    this.state.lastSignal = judgement ? `命中 ${judgement}` : '光刃命中';
    this.render();
  }

  handleMiss(event) {
    const detail = event.detail ?? {};
    const state = detail.state ?? detail;
    this.state.hud = {
      ...this.state.hud,
      combo: 0,
      accuracy: normalizedAccuracy(state.accuracy, this.state.hud.accuracy),
      life: normalizedLife(state.life ?? state.health, this.state.hud.life),
      misses: numberValue(state.misses, this.state.hud.misses + 1),
    };
    this.state.lastSignal = detail.reason || '节拍脱锁';
    this.render();
  }

  handleXRChange(event) {
    const detail = event.detail ?? {};
    const presenting = Boolean(detail.presenting ?? detail.isPresenting ?? detail.active);
    this.state.xr = {
      ...this.state.xr,
      status: presenting ? 'presenting' : detail.status || this.state.xr.status,
      supported: Boolean(detail.supported ?? this.state.xr.supported),
      presenting,
      detail: detail.message || (presenting ? XR_COPY.presenting : this.state.xr.detail),
    };
    this.render();
  }

  selectedTrack() {
    return this.tracks.find((track) => track.id === this.state.selectedTrackId) ?? this.tracks[0] ?? null;
  }

  render() {
    const track = this.selectedTrack();
    const phase = this.state.phase;
    this.root.innerHTML = `
      <div class="app-shell" data-phase="${esc(phase)}" data-xr="${esc(this.state.xr.status)}">
        ${this.renderTopbar(track)}
        <div class="stage-layout">
          ${this.renderMenu(track)}
          ${this.renderHud(track)}
        </div>
        ${phase === GamePhase.COUNTDOWN ? this.renderCountdown() : ''}
        ${phase === GamePhase.PAUSED ? this.renderPause() : ''}
        ${phase === GamePhase.RESULTS ? this.renderResults(track) : ''}
        <p class="sr-only" aria-live="polite">${esc(this.state.lastSignal)}</p>
      </div>
    `;
    this.applyTrackTheme(track);
    this.restoreFocus();
  }

  renderTopbar(track) {
    return `
      <header class="topbar" aria-label="游戏状态">
        <div class="brand-lockup">
          <span class="brand-kicker">RIFT//BLADE</span>
          <span class="brand-title">光痕裂界</span>
        </div>
        <div class="system-strip" role="status" aria-live="polite">
          <span class="status-pill" data-kind="${esc(this.state.xr.status)}">
            ${esc(this.state.xr.detail)}
          </span>
          <span class="status-pill">
            ${esc(track ? `${this.trackTitle(track)} · ${track.bpm ?? '--'} BPM` : '等待曲目')}
          </span>
          <button class="ghost-button compact" type="button" data-action="toggle-mute" aria-pressed="${String(this.state.muted)}">
            ${this.state.muted ? '取消静默' : '静默音频'}
          </button>
        </div>
      </header>
    `;
  }

  renderMenu(selectedTrack) {
    const isMenu = this.state.phase === GamePhase.MENU;
    const shouldShow = isMenu || this.state.phase === GamePhase.COUNTDOWN;
    return `
      <section class="menu-panel ${shouldShow ? '' : 'is-minimized'}" aria-labelledby="menu-title">
        <div class="hero-copy">
          <p class="eyebrow">NEON RIFT RHYTHM</p>
          <h1 id="menu-title">用双刃把节拍切开</h1>
          <p>
            三座原创声景，一条光痕裂界。桌面模式可练习节拍；安全上下文与 WebXR 头显就绪后可进入 VR 沉浸。
          </p>
        </div>

        <div class="track-console" aria-label="曲目选择与开始">
          <div class="track-list" role="radiogroup" aria-label="三首曲目">
            ${this.tracks.map((track, index) => this.renderTrackCard(track, selectedTrack?.id === track.id, index)).join('')}
          </div>
          <div class="launch-card">
            <div>
              <p class="eyebrow">LAUNCH VECTOR</p>
              <h2>${esc(selectedTrack ? this.trackTitle(selectedTrack) : '未选择曲目')}</h2>
              <p>${esc(trackSummary(selectedTrack))}</p>
            </div>
            <button class="primary-launch" type="button" data-action="start" ${selectedTrack ? '' : 'disabled'}>
              开始同步
            </button>
            <p class="safety-note">
              VR 状态：${esc(this.state.xr.detail)}。桌面控制始终可用；VR 入口由游戏内 WebXR 会话接管。
            </p>
          </div>
        </div>

        ${this.renderTraining()}
      </section>
    `;
  }

  renderTrackCard(track, selected, index) {
    const title = this.trackTitle(track);
    const environment = track?.environment?.name ?? track?.environment?.biome ?? track?.environment ?? '未命名世界';
    const damage = track?.damageStyle?.name ?? track?.damageStyle ?? '主题受伤反馈';
    return `
      <button
        class="track-card ${selected ? 'is-selected' : ''}"
        type="button"
        role="radio"
        aria-checked="${String(selected)}"
        data-action="select-track"
        data-track-id="${esc(track.id)}"
      >
        <span class="track-index">${String(index + 1).padStart(2, '0')}</span>
        <span class="track-name">${esc(title)}</span>
        <span class="track-meta">${esc(track.bpm ?? '--')} BPM · ${formatTime(track.duration ?? 0)}</span>
        <span class="track-world">${esc(environment)}</span>
        <span class="track-damage">${esc(damage)}</span>
      </button>
    `;
  }

  renderTraining() {
    return `
      <section class="training-grid" aria-labelledby="training-title">
        <div>
          <p class="eyebrow">CONTROL DRILL</p>
          <h2 id="training-title">控制教学</h2>
        </div>
        <ol>
          <li><strong>指针双剑</strong><span>移动鼠标定位；左/右键分别挥动双刃。</span></li>
          <li><strong>键盘双剑</strong><span>A/S/D/F 控左剑，J/K/L/; 控右剑；Q/E 快切。</span></li>
          <li><strong>节奏</strong><span>按方块方向切入，连续命中维持倍率。</span></li>
          <li><strong>系统</strong><span>Esc 暂停，M 静默，1/2/3 快速选曲。</span></li>
        </ol>
      </section>
    `;
  }

  renderHud(track) {
    const hud = this.state.hud;
    const lifePercent = Math.round(clamp01(hud.life) * 100);
    const progressPercent = Math.round(clamp01(hud.progress) * 100);
    const isPlaying = this.state.phase === GamePhase.PLAYING || this.state.phase === GamePhase.PAUSED;
    return `
      <aside class="hud-panel ${isPlaying ? 'is-live' : ''}" aria-label="实时 HUD">
        <div class="hud-header">
          <p class="eyebrow">LIVE TELEMETRY</p>
          <h2>${esc(track ? this.trackTitle(track) : 'HUD 待机')}</h2>
          <button class="ghost-button compact" type="button" data-action="pause" ${this.state.phase === GamePhase.PLAYING ? '' : 'disabled'}>
            暂停
          </button>
        </div>
        <div class="hud-score">
          <span>分数</span>
          <strong>${formatNumber(hud.score)}</strong>
        </div>
        <div class="meter-stack">
          ${this.renderMeter('生命', lifePercent, lifePercent <= 32 ? 'critical' : 'safe')}
          ${this.renderMeter('进度', progressPercent, 'progress')}
        </div>
        <dl class="hud-stats">
          <div><dt>连击</dt><dd>${formatNumber(hud.combo)}</dd></div>
          <div><dt>最高</dt><dd>${formatNumber(hud.bestCombo)}</dd></div>
          <div><dt>准度</dt><dd>${Math.round(hud.accuracy)}%</dd></div>
          <div><dt>失误</dt><dd>${formatNumber(hud.misses)}</dd></div>
        </dl>
        <div class="blade-readout" aria-label="双手光刃状态">
          <span>LEFT BLADE</span>
          <span>RIGHT BLADE</span>
        </div>
        <p class="signal-line">${esc(this.state.lastSignal)}</p>
        ${this.state.impact ? `<div class="damage-banner" role="alert">${esc(this.state.impact.label)}</div>` : ''}
      </aside>
    `;
  }

  renderMeter(label, value, kind) {
    return `
      <div class="meter" data-kind="${esc(kind)}">
        <div class="meter-label"><span>${esc(label)}</span><strong>${value}%</strong></div>
        <div class="meter-track" aria-hidden="true"><span style="width:${value}%"></span></div>
      </div>
    `;
  }

  renderCountdown() {
    const count = this.state.countdown ?? 3;
    return `
      <section class="overlay countdown-overlay" role="status" aria-live="assertive">
        <p class="eyebrow">RIFT OPENING</p>
        <strong>${esc(String(count))}</strong>
        <span>握紧双刃，等待第一拍</span>
      </section>
    `;
  }

  renderPause() {
    return `
      <section class="overlay pause-overlay" role="dialog" aria-modal="true" aria-labelledby="pause-title">
        <p class="eyebrow">SYNC HELD</p>
        <h2 id="pause-title">裂界已暂停</h2>
        <p>呼吸、校准站位，然后回到光痕。</p>
        <div class="dialog-actions">
          <button class="primary-launch" type="button" data-action="resume">继续</button>
          <button class="ghost-button" type="button" data-action="restart">重新开始</button>
          <button class="ghost-button" type="button" data-action="return-menu">返回选曲</button>
        </div>
      </section>
    `;
  }

  renderResults(track) {
    const results = { ...this.state.hud, ...(this.state.results ?? {}) };
    const accuracy = normalizedAccuracy(results.accuracy, this.state.hud.accuracy);
    return `
      <section class="overlay results-overlay" role="dialog" aria-modal="true" aria-labelledby="results-title">
        <p class="eyebrow">RUN COMPLETE</p>
        <h2 id="results-title">${esc(track ? this.trackTitle(track) : '结算')}</h2>
        <dl class="result-grid">
          <div><dt>总分</dt><dd>${formatNumber(numberValue(results.score, 0))}</dd></div>
          <div><dt>最高连击</dt><dd>${formatNumber(numberValue(results.bestCombo ?? results.maxCombo, this.state.hud.bestCombo))}</dd></div>
          <div><dt>命中</dt><dd>${formatNumber(numberValue(results.hits, this.state.hud.hits))}</dd></div>
          <div><dt>失误</dt><dd>${formatNumber(numberValue(results.misses, this.state.hud.misses))}</dd></div>
          <div><dt>准度</dt><dd>${Math.round(accuracy)}%</dd></div>
          <div><dt>评级</dt><dd>${esc(results.rank ?? results.grade ?? rankFromAccuracy(accuracy))}</dd></div>
        </dl>
        <div class="dialog-actions">
          <button class="primary-launch" type="button" data-action="restart">重玩本曲</button>
          <button class="ghost-button" type="button" data-action="return-menu">返回选曲</button>
        </div>
      </section>
    `;
  }

  trackTitle(track) {
    return track?.title ?? track?.name ?? track?.displayName ?? track?.id ?? 'UNKNOWN TRACK';
  }

  applyTrackTheme(track) {
    if (!track?.palette) return;
    const palette = normalizePalette(track.palette);
    for (const [key, value] of Object.entries(palette)) {
      this.root.style.setProperty(`--track-${key}`, value);
    }
  }

  focus(selector) {
    this.pendingFocus = selector;
    this.restoreFocus();
  }

  restoreFocus() {
    if (!this.pendingFocus) return;
    const target = this.root.querySelector(this.pendingFocus);
    if (target instanceof HTMLElement && !target.disabled) {
      target.focus({ preventScroll: true });
      this.pendingFocus = null;
    }
  }
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, numberValue(value, 0)));
}

function normalizedLife(value, fallback) {
  const numeric = numberValue(value, fallback);
  return numeric > 1 ? clamp01(numeric / 100) : clamp01(numeric);
}

function normalizedAccuracy(value, fallback = 100) {
  const numeric = numberValue(value, fallback);
  return numeric <= 1 ? clamp01(numeric) * 100 : Math.min(100, Math.max(0, numeric));
}

function normalizedProgress(progress, time, duration) {
  if (progress !== undefined) return clamp01(progress);
  const currentTime = numberValue(time, 0);
  const total = numberValue(duration, 0);
  return total > 0 ? clamp01(currentTime / total) : 0;
}

function formatNumber(value) {
  return Math.round(numberValue(value, 0)).toLocaleString('zh-CN');
}

function formatTime(seconds) {
  const total = Math.max(0, Math.round(numberValue(seconds, 0)));
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

function trackSummary(track) {
  if (!track) return '等待谱面注入。';
  return track.description
    ?? track.summary
    ?? track.metadata?.description
    ?? `${track.environment?.name ?? track.environment?.biome ?? '动态世界'} · ${track.damageStyle?.name ?? '主题护盾反馈'}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function rankFromAccuracy(accuracy) {
  if (accuracy >= 98) return 'RIFT S';
  if (accuracy >= 92) return 'A';
  if (accuracy >= 84) return 'B';
  if (accuracy >= 72) return 'C';
  return 'RETRY';
}

function normalizePalette(palette) {
  if (Array.isArray(palette)) {
    return {
      primary: palette[0] ?? '#55f7ff',
      secondary: palette[1] ?? '#ff477e',
      accent: palette[2] ?? '#ffe66d',
    };
  }
  return {
    primary: palette.primary ?? palette.neon ?? '#55f7ff',
    secondary: palette.secondary ?? palette.rift ?? '#ff477e',
    accent: palette.accent ?? palette.blade ?? '#ffe66d',
  };
}
