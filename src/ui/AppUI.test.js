import { describe, expect, it } from 'vitest';
import { AppUI, localizeGameSignal, validateAudioFile } from './AppUI.js';

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
  it('将命中、失误和伤害原因转换为中文播报', () => {
    expect(localizeGameSignal('auto-perfect')).toBe('AI 完美切击');
    expect(localizeGameSignal('wrong-direction')).toBe('切击方向错误');
    expect(localizeGameSignal('obstacle')).toBe('撞上障碍');
    expect(localizeGameSignal('未知英文状态', '状态已更新')).toBe('未知英文状态');
    expect(localizeGameSignal('unknown-reason', '状态已更新')).toBe('状态已更新');
  });

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
    expect(ui.renderTrackRow(track, true, 0)).toContain('Neon Demo · 原创曲目');
    expect(ui.renderTrackRow(track, true, 0)).not.toContain('<small>Neon Demo · synthwave');
  });

  it('renders gameplay score as one fixed numeric output without competitive card clutter', () => {
    const track = { id: 'demo', title: 'Demo', duration: 60 };
    const ui = new AppUI({ root: null, tracks: [track] });
    ui.state.phase = 'playing';
    ui.state.hud.score = 12840;

    const markup = ui.renderHud(track);

    expect(markup).toContain('class="hud-total-score"');
    expect(markup).toContain('>12,840</output>');
    expect(markup).not.toContain('hud-stats');
    expect(markup).not.toContain('progress-meter');
    expect(markup).not.toContain('<span>分数</span>');
  });

  it('keeps every functional menu, pause and result label in Chinese', () => {
    const track = { id: 'demo', metadata: { titleZh: '霓虹演示' }, bpm: 128, duration: 60 };
    const ui = new AppUI({ root: null, tracks: [track] });
    const markup = [ui.renderMenu(track), ui.renderPause(), ui.renderResults(track)].join('\n');

    expect(markup).toContain('标准模式 · 1 首曲目');
    expect(markup).toContain('当前选择');
    expect(markup).toContain('128 拍/分');
    expect(markup).toContain('游戏暂停');
    expect(markup).toContain('演出完成');
    expect(markup).toContain('等级 S');
    expect(markup).not.toMatch(/\b(?:STANDARD|TRACKS|NOW SELECTED|PAUSED|SHOW COMPLETE|ORIGINAL SOUND)\b/);
  });

  it('describes the current mobile swipe and dodge controls instead of the removed joysticks', () => {
    const ui = new AppUI({ root: null, tracks: [] });
    const markup = ui.renderTraining();

    expect(markup).toContain('沿箭头方向划动');
    expect(markup).toContain('左躲');
    expect(markup).toContain('右躲');
    expect(markup).not.toContain('双摇杆');
  });
});
