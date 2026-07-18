import { GameMode, GamePhase, GameplayEvent, normalizeGameMode } from '../shared/contracts.js';
import { TouchControls } from '../input/TouchControls.js';

export const UIEvent = Object.freeze({
  MODE_CHANGE: 'ui:mode-change',
  TRACK_CHANGE: 'ui:track-change',
  CUSTOM_AUDIO_FILE: 'ui:custom-audio-file',
  VR_REQUEST: 'ui:vr-request',
});

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

const MODE_COPY = Object.freeze({
  [GameMode.STANDARD]: {
    label: '标准',
    eyebrow: 'STANDARD',
    description: '亲手挥动双剑，方向、节拍和连击都会计分。',
    cta: '开始挑战',
  },
  [GameMode.AUTO]: {
    label: 'AI 自动',
    eyebrow: 'AI AUTO',
    description: 'AI 按谱面零误差自动挥剑并完成 Perfect，适合看演出与学谱。',
    cta: '启动 AI 自动打击',
  },
  [GameMode.ZEN]: {
    label: '纯享',
    eyebrow: 'ZEN',
    description: '隐藏方块与评分，只留下音乐、世界和光影。',
    cta: '进入纯享模式',
  },
});

const XR_COPY = Object.freeze({
  checking: '正在检测 VR',
  ready: 'VR 已就绪',
  insecure: 'VR 需要 HTTPS',
  unsupported: '浏览器不支持 VR',
  unavailable: '未检测到 WebXR',
  presenting: '正在 VR 中',
});

const UPLOAD_COPY = Object.freeze({
  idle: '音频只在本机分析，不会上传服务器。',
  analyzing: '正在聆听节拍并生成双剑谱面…',
  success: '谱面已生成，曲目已经自动选中。',
  error: '未能生成谱面，请换一个音频文件。',
});

export class AppUI {
  constructor({
    root,
    game,
    music,
    tracks = [],
    eventTarget = null,
    initialMode = GameMode.STANDARD,
    onCustomAudioFile = null,
  }) {
    this.root = root;
    this.game = game;
    this.music = music;
    this.tracks = [...tracks];
    this.eventTarget = eventTarget ?? new EventTarget();
    this.onCustomAudioFile = onCustomAudioFile;

    this.state = {
      phase: GamePhase.MENU,
      mode: normalizeGameMode(initialMode),
      selectedTrackId: this.tracks[0]?.id ?? null,
      filter: '',
      hud: { ...DEFAULT_HUD, duration: this.tracks[0]?.duration ?? 0 },
      results: null,
      muted: false,
      xr: {
        status: 'checking',
        secure: Boolean(globalThis.isSecureContext),
        supported: false,
        presenting: false,
        detail: XR_COPY.checking,
      },
      upload: {
        status: 'idle',
        filename: '',
        message: UPLOAD_COPY.idle,
        progress: null,
        requestId: 0,
      },
      countdown: null,
      lastSignal: '系统已就绪',
      impact: null,
    };

    this.abortController = new AbortController();
    this.pendingFocus = null;
    this.lastHudRenderAt = 0;
    this.launchToken = 0;
    this.impactTimer = null;
    this.touchControls = null;

    this.handleRootClick = this.handleRootClick.bind(this);
    this.handleRootChange = this.handleRootChange.bind(this);
    this.handleRootInput = this.handleRootInput.bind(this);
    this.handleRootDragOver = this.handleRootDragOver.bind(this);
    this.handleRootDrop = this.handleRootDrop.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);
    this.handleTick = this.handleTick.bind(this);
    this.handlePhase = this.handlePhase.bind(this);
    this.handleResults = this.handleResults.bind(this);
    this.handleDamage = this.handleDamage.bind(this);
    this.handleHit = this.handleHit.bind(this);
    this.handleMiss = this.handleMiss.bind(this);
    this.handleXRChange = this.handleXRChange.bind(this);
    this.handleModeChange = this.handleModeChange.bind(this);
    this.handleTrackSelect = this.handleTrackSelect.bind(this);
    this.handleCustomTrack = this.handleCustomTrack.bind(this);
    this.handleAudioAnalysis = this.handleAudioAnalysis.bind(this);
  }

  async initialize() {
    if (!this.root) throw new Error('AppUI requires a root element.');

    this.bindEvents();
    this.touchControls = new TouchControls({
      game: this.game,
      eventTarget: this.eventTarget,
      onPause: () => {
        if (this.state.phase === GamePhase.PAUSED) this.resume();
        else this.pause();
      },
    });
    this.touchControls.initialize();
    this.render();
    await this.refreshXRStatus();
    this.render();
    this.focus('[data-action="start"]');
  }

  dispose() {
    this.abortController.abort();
    this.touchControls?.dispose();
    this.touchControls = null;
    if (this.impactTimer) clearTimeout(this.impactTimer);
    this.impactTimer = null;
    this.root?.replaceChildren();
  }

  bindEvents() {
    const { signal } = this.abortController;
    this.root.addEventListener('click', this.handleRootClick, { signal });
    this.root.addEventListener('change', this.handleRootChange, { signal });
    this.root.addEventListener('input', this.handleRootInput, { signal });
    this.root.addEventListener('dragover', this.handleRootDragOver, { signal });
    this.root.addEventListener('drop', this.handleRootDrop, { signal });
    document.addEventListener('keydown', this.handleKeydown, { signal });

    this.eventTarget.addEventListener(GameplayEvent.TICK, this.handleTick, { signal });
    this.eventTarget.addEventListener(GameplayEvent.PHASE, this.handlePhase, { signal });
    this.eventTarget.addEventListener(GameplayEvent.RESULTS, this.handleResults, { signal });
    this.eventTarget.addEventListener(GameplayEvent.DAMAGE, this.handleDamage, { signal });
    this.eventTarget.addEventListener(GameplayEvent.NOTE_HIT, this.handleHit, { signal });
    this.eventTarget.addEventListener(GameplayEvent.NOTE_MISS, this.handleMiss, { signal });
    this.eventTarget.addEventListener(GameplayEvent.XR_CHANGE, this.handleXRChange, { signal });
    this.eventTarget.addEventListener(GameplayEvent.MODE_CHANGE, this.handleModeChange, { signal });
    this.eventTarget.addEventListener(GameplayEvent.TRACK_SELECT, this.handleTrackSelect, { signal });
    this.eventTarget.addEventListener(GameplayEvent.CUSTOM_TRACK, this.handleCustomTrack, { signal });
    this.eventTarget.addEventListener(GameplayEvent.AUDIO_ANALYSIS, this.handleAudioAnalysis, { signal });
  }

  async refreshXRStatus() {
    const secure = Boolean(globalThis.isSecureContext);
    const xr = navigator.xr;

    if (!secure) {
      this.state.xr = { status: 'insecure', secure, supported: false, presenting: false, detail: XR_COPY.insecure };
      return;
    }
    if (!xr?.isSessionSupported) {
      this.state.xr = { status: 'unavailable', secure, supported: false, presenting: false, detail: XR_COPY.unavailable };
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
    const mode = control.dataset.mode;

    if (trackId) this.selectTrack(trackId);
    if (mode) this.setMode(mode);
    if (action === 'select-track' || action === 'select-mode') return;
    if (action === 'start') void this.startSelected();
    if (action === 'enter-vr') void this.requestVR();
    if (action === 'pause') this.pause();
    if (action === 'resume') this.resume();
    if (action === 'restart') this.restart();
    if (action === 'return-menu') this.returnToMenu();
    if (action === 'toggle-mute') this.toggleMute();
    if (action === 'clear-filter') this.clearFilter();
    if (action === 'clear-upload') this.setUploadState('idle');
  }

  handleRootChange(event) {
    if (event.target.matches('[data-input="custom-audio"]')) {
      const [file] = event.target.files ?? [];
      if (file) void this.requestCustomAudio(file);
      event.target.value = '';
    }
  }

  handleRootInput(event) {
    if (!event.target.matches('[data-input="track-filter"]')) return;
    this.state.filter = event.target.value;
    this.applyTrackFilter();
  }

  handleRootDragOver(event) {
    if (!event.target.closest('[data-dropzone="audio"]')) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  handleRootDrop(event) {
    if (!event.target.closest('[data-dropzone="audio"]')) return;
    event.preventDefault();
    const file = [...(event.dataTransfer?.files ?? [])].find(isLikelyAudioFile);
    if (file) void this.requestCustomAudio(file);
    else this.setUploadState('error', { message: '请选择 MP3、WAV、OGG、M4A、AAC 或 FLAC 音频。' });
  }

  handleKeydown(event) {
    if (event.defaultPrevented || this.isTypingTarget(event.target)) return;

    if (/^[0-9]$/.test(event.key) && this.state.phase === GamePhase.MENU) {
      const index = event.key === '0' ? 9 : Number(event.key) - 1;
      const track = this.tracks[index];
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
    return target.isContentEditable || ['input', 'textarea', 'select'].includes(tagName);
  }

  setTracks(tracks, { preserveSelection = true } = {}) {
    const previous = preserveSelection ? this.state.selectedTrackId : null;
    this.tracks = [...(tracks ?? [])];
    this.state.selectedTrackId = this.tracks.some((track) => track.id === previous)
      ? previous
      : this.tracks[0]?.id ?? null;
    this.render();
  }

  selectTrack(trackId, { notify = true, focusStart = true } = {}) {
    const track = this.tracks.find((candidate) => candidate.id === trackId);
    if (!track) return false;

    this.state.selectedTrackId = track.id;
    this.state.hud = { ...DEFAULT_HUD, duration: track.duration ?? 0, life: 1 };
    this.state.results = null;
    this.state.lastSignal = `${this.trackTitle(track)} 已选择`;
    this.music?.setIntensity?.(0.35);
    this.safeCall(() => this.game?.loadTrack?.(track));
    if (notify) this.emitUIEvent(UIEvent.TRACK_CHANGE, { track, trackId: track.id, source: '2d-menu' });
    this.render();
    if (focusStart) this.focus('[data-action="start"]');
    return true;
  }

  setMode(mode, { notify = true } = {}) {
    const normalized = normalizeGameMode(mode);
    this.state.mode = normalized;
    this.state.lastSignal = `${MODE_COPY[normalized].label}模式已启用`;
    this.safeCall(() => this.game?.setMode?.(normalized));
    if (notify) this.emitUIEvent(UIEvent.MODE_CHANGE, { mode: normalized, source: '2d-menu' });
    this.render();
    this.focus(`[data-mode="${normalized}"]`);
    return normalized;
  }

  async requestCustomAudio(file) {
    const validation = validateAudioFile(file);
    if (!validation.valid) {
      this.setUploadState('error', { filename: file?.name, message: validation.message });
      return;
    }

    const requestId = this.state.upload.requestId + 1;
    this.setUploadState('analyzing', {
      requestId,
      filename: file.name,
      message: `正在分析 ${file.name}，请稍候…`,
    });

    let settled = false;
    const resolve = (track) => {
      if (settled || requestId !== this.state.upload.requestId) return;
      settled = true;
      this.acceptCustomTrack(track, { filename: file.name });
    };
    const reject = (error) => {
      if (settled || requestId !== this.state.upload.requestId) return;
      settled = true;
      this.setUploadState('error', {
        filename: file.name,
        message: String(error?.message || error || UPLOAD_COPY.error),
      });
    };

    this.emitUIEvent(UIEvent.CUSTOM_AUDIO_FILE, { file, requestId, resolve, reject });
    const importer = this.onCustomAudioFile
      ?? this.game?.importCustomAudio?.bind(this.game)
      ?? this.music?.importCustomAudio?.bind(this.music);

    if (typeof importer === 'function') {
      try {
        const track = await importer(file, { requestId, eventTarget: this.eventTarget });
        if (track) resolve(track);
      } catch (error) {
        reject(error);
      }
    }
  }

  setUploadState(status, options = {}) {
    const safeStatus = ['idle', 'analyzing', 'success', 'error'].includes(status) ? status : 'idle';
    this.state.upload = {
      ...this.state.upload,
      status: safeStatus,
      filename: options.filename ?? (safeStatus === 'idle' ? '' : this.state.upload.filename),
      message: options.message ?? UPLOAD_COPY[safeStatus],
      progress: options.progress ?? null,
      requestId: options.requestId ?? this.state.upload.requestId,
    };
    this.render();
  }

  acceptCustomTrack(track, { filename = '' } = {}) {
    if (!track?.id) {
      this.setUploadState('error', { filename, message: '生成的谱面缺少曲目标识，无法载入。' });
      return false;
    }
    const index = this.tracks.findIndex((candidate) => candidate.id === track.id);
    if (index >= 0) this.tracks.splice(index, 1, track);
    else this.tracks.unshift(track);
    this.state.selectedTrackId = track.id;
    this.safeCall(() => this.game?.loadTrack?.(track));
    this.state.hud = { ...DEFAULT_HUD, duration: track.duration ?? 0 };
    this.state.upload = {
      ...this.state.upload,
      status: 'success',
      filename: filename || track.sourceFileName || this.state.upload.filename,
      message: UPLOAD_COPY.success,
      progress: 1,
    };
    this.state.lastSignal = `${this.trackTitle(track)} 的谱面已生成`;
    this.render();
    this.focus('[data-action="start"]');
    return true;
  }

  async requestVR() {
    this.emitUIEvent(UIEvent.VR_REQUEST, { presenting: this.state.xr.presenting });
    try {
      if (typeof this.game?.enterVR === 'function') await this.game.enterVR();
      else if (typeof this.game?.requestVRSession === 'function') await this.game.requestVRSession();
      else this.game?.vrButton?.click?.();
    } catch (error) {
      this.state.lastSignal = `VR 启动失败：${String(error?.message || error)}`;
      this.render();
    }
  }

  async startSelected() {
    const track = this.selectedTrack();
    if (!track) return;
    try {
      const token = ++this.launchToken;
      this.state.phase = GamePhase.COUNTDOWN;
      this.state.results = null;
      this.state.lastSignal = `${MODE_COPY[this.state.mode].label}模式同步中`;
      this.game?.setMode?.(this.state.mode);
      this.game?.loadTrack?.(track);
      for (const count of [3, 2, 1]) {
        if (token !== this.launchToken) return;
        this.state.countdown = count;
        this.render();
        await delay(560);
      }
      if (token !== this.launchToken) return;
      await this.game?.start?.();
    } catch (error) {
      this.state.phase = GamePhase.MENU;
      this.state.lastSignal = `启动失败：${String(error?.message || error)}`;
      this.render();
    }
  }

  pause() { this.safeCall(() => this.game?.pause?.()); }
  resume() { this.safeCall(() => this.game?.resume?.()); }

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
    this.state.hud = { ...DEFAULT_HUD, duration: this.selectedTrack()?.duration ?? 0 };
    this.state.lastSignal = '已返回选曲';
    if (this.impactTimer) clearTimeout(this.impactTimer);
    this.impactTimer = null;
    this.safeCall(() => this.game?.returnToMenu?.());
    this.safeCall(() => this.music?.stop?.());
    this.music?.setIntensity?.(0.25);
    this.touchControls?.setActive(false);
    this.render();
    this.focus('[data-action="start"]');
  }

  toggleMute() {
    this.state.muted = !this.state.muted;
    this.music?.setMuted?.(this.state.muted);
    this.state.lastSignal = this.state.muted ? '音频已静音' : '音频已恢复';
    this.render();
  }

  clearFilter() {
    this.state.filter = '';
    this.render();
    this.focus('[data-input="track-filter"]');
  }

  safeCall(callback) {
    try { return callback(); }
    catch (error) {
      this.state.lastSignal = String(error?.message || error);
      return undefined;
    }
  }

  emitUIEvent(type, detail) {
    this.eventTarget.dispatchEvent(createCustomEvent(type, detail));
    this.root?.dispatchEvent(createCustomEvent(type, detail));
  }

  handleTick(event) {
    const detail = event.detail ?? {};
    const gameState = detail.state ?? detail;
    const selectedTrack = this.selectedTrack();
    this.state.hud = {
      ...this.state.hud,
      score: numberValue(gameState.score, this.state.hud.score),
      combo: numberValue(gameState.combo, this.state.hud.combo),
      bestCombo: numberValue(gameState.bestCombo ?? gameState.maxCombo, this.state.hud.bestCombo),
      accuracy: normalizedAccuracy(gameState.accuracy, this.state.hud.accuracy),
      life: normalizedLife(gameState.life ?? gameState.health, this.state.hud.life),
      progress: normalizedProgress(detail.progress, detail.time ?? detail.currentTime, detail.duration ?? selectedTrack?.duration),
      time: numberValue(detail.time ?? detail.currentTime, this.state.hud.time),
      duration: numberValue(detail.duration ?? selectedTrack?.duration, this.state.hud.duration),
      hits: numberValue(gameState.hits, this.state.hud.hits),
      misses: numberValue(gameState.misses, this.state.hud.misses),
    };
    const now = performance.now();
    if (now - this.lastHudRenderAt >= 90) {
      this.lastHudRenderAt = now;
      this.render();
    }
  }

  handlePhase(event) {
    const detail = event.detail ?? {};
    const phase = typeof detail === 'string' ? detail : detail.phase;
    if (phase) this.state.phase = phase;
    if ('countdown' in detail || 'count' in detail) this.state.countdown = detail.countdown ?? detail.count;
    else if (this.state.phase !== GamePhase.COUNTDOWN) this.state.countdown = null;
    if (detail.message) this.state.lastSignal = detail.message;
    if (this.state.phase === GamePhase.PLAYING) this.music?.setIntensity?.(0.8);
    if (this.state.phase === GamePhase.PAUSED) this.music?.setIntensity?.(0.45);
    if (this.state.phase === GamePhase.RESULTS) this.music?.setIntensity?.(0.25);
    this.touchControls?.setPaused(this.state.phase === GamePhase.PAUSED);
    this.touchControls?.setActive([GamePhase.PLAYING, GamePhase.PAUSED].includes(this.state.phase));
    this.render();
    if (this.state.phase === GamePhase.PAUSED) this.focus('[data-action="resume"]');
    if (this.state.phase === GamePhase.RESULTS) this.focus('[data-action="restart"]');
  }

  handleResults(event) {
    this.state.phase = GamePhase.RESULTS;
    this.state.results = event.detail ?? {};
    this.state.countdown = null;
    this.state.lastSignal = this.state.results.failed ? '挑战失败，再校准一次' : '演出完成';
    this.music?.setIntensity?.(0.2);
    this.touchControls?.setActive(false);
    this.render();
    this.focus('[data-action="restart"]');
  }

  handleDamage(event) {
    const detail = event.detail ?? {};
    const gameState = detail.state ?? detail;
    this.state.impact = { at: performance.now(), label: detail.reason || detail.type || '护盾受损' };
    this.state.hud = {
      ...this.state.hud,
      life: normalizedLife(gameState.life ?? gameState.health, Math.max(0, this.state.hud.life - 0.12)),
      misses: numberValue(gameState.misses, this.state.hud.misses),
    };
    this.state.lastSignal = this.state.impact.label;
    this.render();
    if (this.impactTimer) clearTimeout(this.impactTimer);
    this.impactTimer = setTimeout(() => {
      this.state.impact = null;
      this.impactTimer = null;
      this.render();
    }, 760);
  }

  handleHit(event) {
    const detail = event.detail ?? {};
    const gameState = detail.state ?? detail;
    this.state.hud = {
      ...this.state.hud,
      score: numberValue(gameState.score, this.state.hud.score),
      combo: numberValue(gameState.combo, this.state.hud.combo + 1),
      bestCombo: Math.max(this.state.hud.bestCombo, numberValue(gameState.maxCombo ?? gameState.combo, this.state.hud.combo + 1)),
      accuracy: normalizedAccuracy(gameState.accuracy, this.state.hud.accuracy),
      hits: numberValue(gameState.hits, this.state.hud.hits + 1),
    };
    this.state.lastSignal = detail.judgement ? `命中 ${detail.judgement?.reason ?? detail.judgement}` : '完美切击';
    this.render();
  }

  handleMiss(event) {
    const detail = event.detail ?? {};
    const gameState = detail.state ?? detail;
    this.state.hud = {
      ...this.state.hud,
      combo: 0,
      accuracy: normalizedAccuracy(gameState.accuracy, this.state.hud.accuracy),
      life: normalizedLife(gameState.life ?? gameState.health, this.state.hud.life),
      misses: numberValue(gameState.misses, this.state.hud.misses + 1),
    };
    this.state.lastSignal = detail.reason || '错过节拍';
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

  handleModeChange(event) {
    const mode = normalizeGameMode(event.detail?.mode ?? event.detail);
    if (mode === this.state.mode) return;
    this.state.mode = mode;
    this.state.lastSignal = `${MODE_COPY[mode].label}模式已同步`;
    this.render();
  }

  handleTrackSelect(event) {
    const detail = event.detail ?? {};
    if (detail.track?.id && !this.tracks.some((track) => track.id === detail.track.id)) this.tracks.push(detail.track);
    const trackId = detail.trackId ?? detail.id ?? detail.track?.id;
    if (trackId && trackId !== this.state.selectedTrackId) this.selectTrack(trackId, { notify: false, focusStart: false });
  }

  handleCustomTrack(event) {
    const track = event.detail?.track ?? event.detail;
    if (track?.id) this.acceptCustomTrack(track, { filename: event.detail?.filename });
  }

  handleAudioAnalysis(event) {
    const detail = event.detail ?? {};
    if (detail.track?.id) {
      this.acceptCustomTrack(detail.track, { filename: detail.filename });
      return;
    }
    this.setUploadState(detail.status ?? 'analyzing', detail);
  }

  selectedTrack() {
    return this.tracks.find((track) => track.id === this.state.selectedTrackId) ?? this.tracks[0] ?? null;
  }

  render() {
    const track = this.selectedTrack();
    const phase = this.state.phase;
    this.root.innerHTML = `
      <div class="app-shell" data-phase="${esc(phase)}" data-mode="${esc(this.state.mode)}" data-xr="${esc(this.state.xr.status)}">
        ${this.renderTopbar(track)}
        <div class="stage-layout">
          ${this.renderMenu(track)}
          ${this.renderHud(track)}
        </div>
        ${phase === GamePhase.COUNTDOWN ? this.renderCountdown() : ''}
        ${phase === GamePhase.PAUSED ? this.renderPause() : ''}
        ${phase === GamePhase.RESULTS ? this.renderResults(track) : ''}
        <p class="sr-only" aria-live="polite">${esc(this.state.lastSignal)}</p>
      </div>`;
    this.applyTrackTheme(track);
    this.applyTrackFilter();
    this.restoreFocus();
  }

  renderTopbar(track) {
    return `
      <header class="topbar" aria-label="游戏状态">
        <div class="brand-lockup" aria-label="Rift Blade 光痕裂界">
          <span class="brand-mark" aria-hidden="true">R//B</span>
          <span><b>RIFT BLADE</b><small>光痕裂界 2.0</small></span>
        </div>
        <div class="system-strip" role="status" aria-live="polite">
          <span class="status-pill" data-kind="${esc(this.state.xr.status)}"><i aria-hidden="true"></i>${esc(this.state.xr.detail)}</span>
          <span class="now-playing">${esc(track ? this.trackTitle(track) : '等待曲目')}</span>
          <button class="icon-button" type="button" data-action="toggle-mute" aria-pressed="${String(this.state.muted)}" aria-label="${this.state.muted ? '取消静音' : '静音'}">
            ${this.state.muted ? '开启声音' : '静音'}
          </button>
        </div>
      </header>`;
  }

  renderMenu(selectedTrack) {
    const shouldShow = [GamePhase.MENU, GamePhase.COUNTDOWN].includes(this.state.phase);
    const mode = MODE_COPY[this.state.mode];
    return `
      <section class="menu-panel ${shouldShow ? '' : 'is-minimized'}" ${shouldShow ? '' : 'inert'} aria-labelledby="menu-title" aria-hidden="${String(!shouldShow)}">
        <header class="menu-heading">
          <div>
            <p class="eyebrow">${esc(mode.eyebrow)} · ${this.tracks.length} TRACKS</p>
            <h1 id="menu-title">选一首，然后切开节拍</h1>
          </div>
          <p>VR、电脑与手机共享同一套动态关卡。</p>
        </header>

        <div class="selection-layout">
          <section class="track-browser acrylic-card" aria-labelledby="track-list-title">
            <div class="section-header">
              <div><span class="step-chip">1</span><h2 id="track-list-title">选择曲目</h2></div>
              <span class="track-count" data-track-count>${this.filteredTracks().length} / ${this.tracks.length}</span>
            </div>
            <div class="search-field">
              <label class="sr-only" for="track-filter">筛选曲目</label>
              <span aria-hidden="true">⌕</span>
              <input id="track-filter" data-input="track-filter" type="search" value="${esc(this.state.filter)}" placeholder="搜索曲名、风格或世界" autocomplete="off" />
              ${this.state.filter ? '<button type="button" data-action="clear-filter" aria-label="清除筛选">×</button>' : ''}
            </div>
            <div class="track-list" role="radiogroup" aria-label="内置与自定义曲目">
              ${this.tracks.map((track, index) => this.renderTrackRow(track, selectedTrack?.id === track.id, index)).join('')}
            </div>
            <p class="empty-filter" data-empty-filter hidden>没有匹配曲目，换个关键词试试。</p>
          </section>

          <section class="launch-card acrylic-card" aria-labelledby="selected-track-title">
            <div class="selected-art" aria-hidden="true"><span>${esc(String(this.tracks.findIndex((item) => item.id === selectedTrack?.id) + 1).padStart(2, '0'))}</span></div>
            <div class="selected-copy">
              <p class="eyebrow">NOW SELECTED</p>
              <h2 id="selected-track-title">${esc(selectedTrack ? this.trackTitle(selectedTrack) : '未选择曲目')}</h2>
              ${selectedTrack && trackOriginalTitle(selectedTrack) !== this.trackTitle(selectedTrack)
                ? `<p class="track-original-title" lang="en">${esc(trackOriginalTitle(selectedTrack))}</p>`
                : ''}
              <p class="artist-line">${esc(selectedTrack?.artist ?? 'RIFT//BLADE ORIGINAL')}</p>
              <div class="track-facts" aria-label="曲目信息">
                <span><b>${esc(selectedTrack?.bpm ?? '--')}</b> BPM</span>
                <span><b>${formatTime(selectedTrack?.duration ?? 0)}</b> 时长</span>
                <span><b>${esc(trackDifficulty(selectedTrack))}</b> 难度</span>
              </div>
              <p class="track-summary">${esc(trackSummary(selectedTrack))}</p>
            </div>

            <div class="mode-block">
              <div class="section-header compact-heading"><div><span class="step-chip">2</span><h3>选择模式</h3></div></div>
              <div class="mode-segment" role="group" aria-label="游戏模式">
                ${Object.entries(MODE_COPY).map(([id, copy]) => `
                  <button type="button" data-action="select-mode" data-mode="${esc(id)}" aria-pressed="${String(this.state.mode === id)}">
                    <span>${esc(copy.label)}</span><small>${esc(copy.eyebrow)}</small>
                  </button>`).join('')}
              </div>
              <p class="mode-description">${esc(mode.description)}</p>
            </div>

            <div class="launch-actions">
              <button class="primary-launch" type="button" data-action="start" ${selectedTrack ? '' : 'disabled'}>
                <span>${esc(mode.cta)}</span><small>${esc(selectedTrack ? `${selectedTrack.bpm ?? '--'} BPM · ${formatTime(selectedTrack.duration ?? 0)}` : '请先选曲')}</small>
              </button>
              <button class="vr-launch" type="button" data-action="enter-vr" ${this.state.xr.secure && (this.state.xr.supported || this.state.xr.status === 'checking') ? '' : 'disabled'}>
                ${this.state.xr.presenting ? '退出 VR' : '进入 VR 选曲'}
              </button>
            </div>
            <p class="vr-hint"><span aria-hidden="true">◉</span> 戴上头显后可用手柄射线选择全部曲目和模式。</p>
          </section>
        </div>

        ${this.renderUpload()}
        ${this.renderTraining()}
      </section>`;
  }

  renderTrackRow(track, selected, index) {
    const haystack = [
      this.trackTitle(track), trackOriginalTitle(track), track?.metadata?.titleZh, track.artist,
      track.metadata?.style, track.environment?.biome, track.environment?.name,
    ].filter(Boolean).join(' ');
    const subtitle = [
      trackOriginalTitle(track) !== this.trackTitle(track) ? trackOriginalTitle(track) : null,
      track.metadata?.style ?? track.artist ?? 'ORIGINAL SOUND',
    ].filter(Boolean).join(' · ');
    return `
      <button class="track-row ${selected ? 'is-selected' : ''}" type="button" role="radio" aria-checked="${String(selected)}"
        data-action="select-track" data-track-id="${esc(track.id)}" data-search="${esc(normalizeSearch(haystack))}">
        <span class="track-number">${String(index + 1).padStart(2, '0')}</span>
        <span class="track-identity"><b>${esc(this.trackTitle(track))}</b><small>${esc(subtitle)}</small></span>
        <span class="track-tempo"><b>${esc(track.bpm ?? '--')}</b><small>BPM</small></span>
        <span class="selection-dot" aria-hidden="true"></span>
      </button>`;
  }

  renderUpload() {
    const upload = this.state.upload;
    const busy = upload.status === 'analyzing';
    return `
      <section class="upload-card acrylic-card" data-status="${esc(upload.status)}" aria-labelledby="upload-title">
        <div class="upload-intro">
          <span class="step-chip">＋</span>
          <div><h2 id="upload-title">用自己的歌生成谱面</h2><p>本地解码、节拍检测、自动双剑编排。</p></div>
        </div>
        <div class="audio-dropzone" data-dropzone="audio">
          <input class="sr-only" id="custom-audio" data-input="custom-audio" type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac" ${busy ? 'disabled' : ''} />
          <label class="upload-button" for="custom-audio" aria-disabled="${String(busy)}">${busy ? '正在分析…' : '选择本地歌曲'}</label>
          <span>或把音频拖到这里 · 最大 48 MB</span>
        </div>
        <div class="upload-status" role="status" aria-live="polite">
          <span class="upload-state-icon" aria-hidden="true"></span>
          <span><b>${esc(upload.filename || uploadStatusTitle(upload.status))}</b><small>${esc(upload.message)}</small></span>
          ${upload.status !== 'idle' && !busy ? '<button class="text-button" type="button" data-action="clear-upload">关闭提示</button>' : ''}
        </div>
        ${busy ? '<div class="analysis-progress" aria-hidden="true"><span></span></div>' : ''}
      </section>`;
  }

  renderTraining() {
    return `
      <details class="control-guide acrylic-card">
        <summary>怎么玩？<span>电脑 · 手机 · Quest</span></summary>
        <div class="control-grid">
          <p><b>电脑</b><span>鼠标左右键或键盘控制双剑，Esc 暂停；数字 1–0 快速选曲。</span></p>
          <p><b>手机</b><span>左右双摇杆控制双剑，在中间区域拖动转视角。</span></p>
          <p><b>VR</b><span>用双手柄真实挥剑；菜单内射线指向并按扳机确认。</span></p>
        </div>
      </details>`;
  }

  renderHud(track) {
    const hud = this.state.hud;
    const isPlaying = [GamePhase.PLAYING, GamePhase.PAUSED].includes(this.state.phase);
    const showScore = isPlaying && this.state.mode !== GameMode.ZEN;
    return `
      <aside class="hud-panel hud-score-only ${showScore ? 'is-live' : ''}" aria-label="总得分" aria-hidden="${String(!showScore)}">
        <output class="hud-total-score" aria-live="polite">${formatNumber(hud.score)}</output>
      </aside>
      <button class="hud-pause hud-pause-floating ${isPlaying ? 'is-live' : ''}" type="button" data-action="pause" aria-label="暂停游戏" ${this.state.phase === GamePhase.PLAYING ? '' : 'disabled'}>Ⅱ</button>
      ${this.state.impact && isPlaying ? `<div class="damage-banner damage-banner-floating" role="alert">${esc(this.state.impact.label)}</div>` : ''}`;
  }

  renderCountdown() {
    return `
      <section class="overlay countdown-overlay" role="status" aria-live="assertive">
        <p>${esc(MODE_COPY[this.state.mode].label)}模式</p><strong>${esc(String(this.state.countdown ?? 3))}</strong><span>握紧双刃</span>
      </section>`;
  }

  renderPause() {
    return `
      <section class="overlay pause-overlay" role="dialog" aria-modal="true" aria-labelledby="pause-title">
        <p class="eyebrow">PAUSED</p><h2 id="pause-title">已暂停</h2><p>调整站位，准备好再继续。</p>
        <div class="dialog-actions"><button class="primary-action" type="button" data-action="resume">继续</button><button class="secondary-action" type="button" data-action="restart">重新开始</button><button class="text-action" type="button" data-action="return-menu">返回选曲</button></div>
      </section>`;
  }

  renderResults(track) {
    const results = { ...this.state.hud, ...(this.state.results ?? {}) };
    const accuracy = normalizedAccuracy(results.accuracy, this.state.hud.accuracy);
    return `
      <section class="overlay results-overlay" role="dialog" aria-modal="true" aria-labelledby="results-title">
        <p class="eyebrow">SHOW COMPLETE</p><h2 id="results-title">${esc(track ? this.trackTitle(track) : '结算')}</h2>
        <strong class="result-rank">${esc(results.rank ?? results.grade ?? rankFromAccuracy(accuracy))}</strong>
        <dl class="result-grid"><div><dt>总分</dt><dd>${formatNumber(numberValue(results.score, 0))}</dd></div><div><dt>最高连击</dt><dd>${formatNumber(numberValue(results.bestCombo ?? results.maxCombo, this.state.hud.bestCombo))}</dd></div><div><dt>命中</dt><dd>${formatNumber(numberValue(results.hits, this.state.hud.hits))}</dd></div><div><dt>准度</dt><dd>${Math.round(accuracy)}%</dd></div></dl>
        <div class="dialog-actions"><button class="primary-action" type="button" data-action="restart">再来一次</button><button class="secondary-action" type="button" data-action="return-menu">返回选曲</button></div>
      </section>`;
  }

  filteredTracks() {
    const query = normalizeSearch(this.state.filter);
    if (!query) return this.tracks;
    return this.tracks.filter((track) => normalizeSearch([
      this.trackTitle(track), trackOriginalTitle(track), track?.metadata?.titleZh, track.artist,
      track.metadata?.style, track.environment?.biome, track.environment?.name,
    ].filter(Boolean).join(' ')).includes(query));
  }

  applyTrackFilter() {
    const query = normalizeSearch(this.state.filter);
    const rows = [...this.root.querySelectorAll('.track-row')];
    let visible = 0;
    rows.forEach((row) => {
      const match = !query || row.dataset.search?.includes(query);
      row.hidden = !match;
      if (match) visible += 1;
    });
    const count = this.root.querySelector('[data-track-count]');
    if (count) count.textContent = `${visible} / ${this.tracks.length}`;
    const empty = this.root.querySelector('[data-empty-filter]');
    if (empty) empty.hidden = visible !== 0;
  }

  trackTitle(track) { return track?.metadata?.titleZh ?? track?.title ?? track?.name ?? track?.displayName ?? track?.id ?? 'UNKNOWN TRACK'; }

  applyTrackTheme(track) {
    if (!track?.palette) return;
    const palette = normalizePalette(track.palette);
    for (const [key, value] of Object.entries(palette)) this.root.style.setProperty(`--track-${key}`, value);
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

export function validateAudioFile(file) {
  if (!file) return { valid: false, message: '没有读取到文件。' };
  if (Number(file.size) > 48 * 1024 * 1024) return { valid: false, message: '音频超过 48 MB，请压缩后重试。' };
  if (!isLikelyAudioFile(file)) return { valid: false, message: '请选择 MP3、WAV、OGG、M4A、AAC 或 FLAC 音频。' };
  return { valid: true, message: '' };
}

function isLikelyAudioFile(file) {
  return Boolean(file?.type?.startsWith('audio/') || /\.(mp3|wav|ogg|oga|m4a|aac|flac)$/i.test(file?.name ?? ''));
}

function createCustomEvent(type, detail) {
  if (typeof CustomEvent === 'function') return new CustomEvent(type, { detail });
  const event = new Event(type);
  Object.defineProperty(event, 'detail', { value: detail });
  return event;
}

function esc(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function normalizeSearch(value) {
  return String(value ?? '').trim().toLocaleLowerCase('zh-CN').normalize('NFKC');
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value) { return Math.min(1, Math.max(0, numberValue(value, 0))); }
function normalizedLife(value, fallback) { const numeric = numberValue(value, fallback); return numeric > 1 ? clamp01(numeric / 100) : clamp01(numeric); }
function normalizedAccuracy(value, fallback = 100) { const numeric = numberValue(value, fallback); return numeric <= 1 ? clamp01(numeric) * 100 : Math.min(100, Math.max(0, numeric)); }
function normalizedProgress(progress, time, duration) { if (progress !== undefined) return clamp01(progress); const total = numberValue(duration, 0); return total > 0 ? clamp01(numberValue(time, 0) / total) : 0; }
function formatNumber(value) { return Math.round(numberValue(value, 0)).toLocaleString('zh-CN'); }
function formatTime(seconds) { const total = Math.max(0, Math.round(numberValue(seconds, 0))); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; }
function trackDifficulty(track) { return track?.metadata?.difficulty ?? track?.difficulty ?? '自适应'; }
function trackOriginalTitle(track) { return track?.title ?? track?.name ?? track?.displayName ?? track?.id ?? 'UNKNOWN TRACK'; }
function trackSummary(track) { return track?.description ?? track?.summary ?? track?.metadata?.description ?? `${track?.environment?.name ?? track?.environment?.biome ?? '动态世界'} · 主题光刃与受伤反馈`; }
function uploadStatusTitle(status) { return ({ idle: '等待选择', analyzing: '正在分析', success: '生成完成', error: '生成失败' })[status] ?? '等待选择'; }
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function rankFromAccuracy(accuracy) { if (accuracy >= 98) return 'S'; if (accuracy >= 92) return 'A'; if (accuracy >= 84) return 'B'; if (accuracy >= 72) return 'C'; return 'RETRY'; }
function normalizePalette(palette) {
  if (Array.isArray(palette)) return { primary: palette[0] ?? '#5ce1ff', secondary: palette[1] ?? '#ff5aa5', accent: palette[2] ?? '#d4ff5c' };
  return {
    primary: palette.primary ?? palette.neon ?? palette.bladeLeft ?? '#5ce1ff',
    secondary: palette.secondary ?? palette.rift ?? palette.bladeRight ?? '#ff5aa5',
    accent: palette.accent ?? palette.warning ?? palette.blade ?? '#d4ff5c',
  };
}
