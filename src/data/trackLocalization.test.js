import { describe, expect, it } from 'vitest';
import { TRACKS } from './tracks.js';
import { trackDifficultyZh, trackStyleZh, trackSummaryZh, trackTitleZh } from './trackLocalization.js';

describe('曲目中文本地化', () => {
  it('为十首内置曲目提供完整中文名称、编曲、难度和介绍', () => {
    expect(TRACKS).toHaveLength(10);
    for (const track of TRACKS) {
      const copy = [trackTitleZh(track), trackStyleZh(track), trackDifficultyZh(track), trackSummaryZh(track)];
      expect(copy.every((value) => /[\u3400-\u9fff]/u.test(value)), track.id).toBe(true);
      expect(copy.slice(1).join(' ')).not.toMatch(/\b(?:cruiser|sentinel|vanguard|apex|drifter|synthwave|original sound)\b/i);
    }
  });

  it('保留用户自定义曲名，同时让未知功能元数据安全回退中文', () => {
    const custom = { id: 'custom', title: 'My Song.mp3', metadata: { style: 'unknown', difficulty: 'expert' } };
    expect(trackTitleZh(custom)).toBe('My Song.mp3');
    expect(trackStyleZh(custom)).toBe('原创曲目');
    expect(trackDifficultyZh(custom)).toBe('自适应');
    expect(trackSummaryZh(custom)).toContain('动态世界');
  });
});
