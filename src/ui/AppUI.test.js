import { describe, expect, it } from 'vitest';
import { AppUI, validateAudioFile } from './AppUI.js';

describe('validateAudioFile', () => {
  it('accepts an audio file exactly at the 48 MB local-analysis limit', () => {
    expect(validateAudioFile({ name: 'track.mp3', type: 'audio/mpeg', size: 48 * 1024 * 1024 })).toEqual({
      valid: true,
      message: '',
    });
  });

  it('rejects an audio file one byte over the 48 MB limit', () => {
    expect(validateAudioFile({ name: 'track.mp3', type: 'audio/mpeg', size: 48 * 1024 * 1024 + 1 })).toEqual({
      valid: false,
      message: '音频超过 48 MB，请压缩后重试。',
    });
  });
});

describe('AppUI track localization', () => {
  it('prefers the Chinese metadata title while preserving the source title in row markup', () => {
    const track = {
      id: 'demo',
      title: 'Neon Demo',
      artist: 'RIFT',
      bpm: 128,
      metadata: { titleZh: '霓虹演示', style: 'synthwave' },
    };
    const ui = new AppUI({ root: null, tracks: [track] });

    expect(ui.trackTitle(track)).toBe('霓虹演示');
    expect(ui.renderTrackRow(track, true, 0)).toContain('Neon Demo · synthwave');
  });
});
