import './styles/main.css';
import { TRACKS } from './data/tracks.js';
import { ProceduralMusic } from './audio/ProceduralMusic.js';
import { RhythmGame } from './game/RhythmGame.js';
import { AppUI } from './ui/AppUI.js';
import { GameplayEvent } from './shared/contracts.js';

const root = document.querySelector('#app');
const canvas = document.querySelector('#game-canvas');
const eventTarget = new EventTarget();
let customTracks = [];

const music = new ProceduralMusic({ eventTarget });
const game = new RhythmGame({ canvas, eventTarget, music });
const ui = new AppUI({
  root,
  game,
  music,
  tracks: TRACKS,
  eventTarget,
  onCustomAudioFile: importCustomAudio,
});

function trackCatalog() {
  return [...customTracks, ...TRACKS];
}

function emit(type, detail) {
  eventTarget.dispatchEvent(new CustomEvent(type, { detail }));
}

async function importCustomAudio(file) {
  emit(GameplayEvent.AUDIO_ANALYSIS, {
    status: 'analyzing',
    filename: file?.name || '',
    progress: 0.12,
    message: '正在本地解码并寻找节拍峰值…',
  });

  try {
    // Decoding, onset detection and beatmap generation all stay on this device.
    // Keep the analyzer out of the headset's initial bundle until it is requested.
    const { decodeAndAnalyzeFile } = await import('./audio/CustomTrackAnalyzer.js');
    const { track, analysis } = await decodeAndAnalyzeFile(file);
    customTracks = [track, ...customTracks.filter((candidate) => candidate.id !== track.id)];
    game.setTracks?.(trackCatalog());
    emit(GameplayEvent.AUDIO_ANALYSIS, {
      status: 'success',
      filename: file.name,
      progress: 1,
      message: `检测到约 ${analysis.bpm} BPM，已生成 ${track.beatmap.length} 个双行音符。`,
    });
    return track;
  } catch (error) {
    const localized = localizeAudioError(error);
    emit(GameplayEvent.AUDIO_ANALYSIS, {
      status: 'error',
      filename: file?.name || '',
      progress: null,
      message: localized.message,
      code: error?.code || 'ANALYSIS_FAILED',
    });
    throw localized;
  }
}

function localizeAudioError(error) {
  const messages = {
    INVALID_FILE: '没有读取到有效的音频文件。',
    EMPTY_FILE: '音频文件是空的，请重新选择。',
    READ_FAILED: '无法读取这首歌，请检查文件是否完整或被其他应用占用。',
    UNSUPPORTED_TYPE: '此音频格式不受当前浏览器支持，请改用 MP3、WAV、OGG、M4A、AAC 或 FLAC。',
    FILE_TOO_LARGE: '歌曲超过 48 MB，请选择更小的文件。',
    AUDIO_TOO_SHORT: '歌曲至少需要 8 秒。',
    AUDIO_TOO_LONG: '歌曲不能超过 8 分钟。',
    DECODED_AUDIO_TOO_LARGE: '解码后的歌曲占用内存过大，请使用较短或较低采样率的音频。',
    TOO_MANY_CHANNELS: '音频声道数过多，请转换为单声道或立体声。',
    INVALID_SAMPLE_RATE: '音频采样率异常，请转换为常见的 44.1 kHz 或 48 kHz。',
    SILENT_AUDIO: '没有检测到可用的声音，请换一首歌。',
    INSUFFICIENT_RHYTHM: '节拍特征太弱，暂时无法生成可靠谱面。',
    DECODE_FAILED: '浏览器无法解码这首歌，请尝试其他音频格式。',
    WEB_AUDIO_UNAVAILABLE: '当前浏览器没有开放 Web Audio 本地分析能力。',
  };
  const localized = new Error(messages[error?.code] || String(error?.message || '本地歌曲分析失败。'));
  localized.code = error?.code || 'ANALYSIS_FAILED';
  localized.cause = error;
  return localized;
}

async function boot() {
  try {
    await game.initialize();
    game.setTracks?.(trackCatalog());
    game.loadTrack?.(TRACKS[0]);
    await ui.initialize();
    document.documentElement.dataset.ready = 'true';
    document.documentElement.dataset.trackCount = String(TRACKS.length);
  } catch (error) {
    console.error('[RIFT//BLADE] boot failed', error);
    root.innerHTML = `
      <section class="fatal-error" role="alert">
        <p class="eyebrow">SYSTEM FAULT</p>
        <h1>裂界未能开启</h1>
        <p>${String(error?.message || error)}</p>
        <button type="button" onclick="location.reload()">重新连接</button>
      </section>`;
  }
}

boot();

window.addEventListener('resize', () => game.resize(), { passive: true });
window.addEventListener('pagehide', () => {
  ui.dispose?.();
  game.dispose?.();
  music.dispose?.();
}, { once: true });

if (import.meta.env.DEV) {
  globalThis.__RIFTBLADE__ = {
    game,
    music,
    ui,
    tracks: TRACKS,
    get catalog() { return trackCatalog(); },
    eventTarget,
    importCustomAudio,
  };
}
