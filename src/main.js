import './styles/main.css';
import { TRACKS } from './data/tracks.js';
import { ProceduralMusic } from './audio/ProceduralMusic.js';
import { RhythmGame } from './game/RhythmGame.js';
import { AppUI } from './ui/AppUI.js';

const root = document.querySelector('#app');
const canvas = document.querySelector('#game-canvas');
const eventTarget = new EventTarget();

const music = new ProceduralMusic({ eventTarget });
const game = new RhythmGame({ canvas, eventTarget, music });
const ui = new AppUI({ root, game, music, tracks: TRACKS, eventTarget });

async function boot() {
  try {
    await game.initialize();
    await ui.initialize();
    document.documentElement.dataset.ready = 'true';
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
  globalThis.__RIFTBLADE__ = { game, music, ui, tracks: TRACKS, eventTarget };
}
