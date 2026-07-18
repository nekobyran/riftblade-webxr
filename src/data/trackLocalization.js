const BUILTIN_TRACK_COPY = Object.freeze({
  'neon-tide-run': {
    style: '流动合成波',
    summary: '明亮琶音掠过霓虹海堤，弹性低音与滚动拍掌推动高速巡航。',
  },
  'ember-circuit-choir': {
    style: '工业仪式慢拍',
    summary: '颗粒圣咏、熔炉鼓与深沉低频组成机械仪式行进。',
  },
  'glass-orbit-monsoon': {
    style: '塔布拉鼓与贝斯',
    summary: '塔布拉鼓点与高速碎拍穿行于零重力棱镜花园。',
  },
  'sakura-ion-reverie': {
    style: '未来神乐车库',
    summary: '未来神乐音色与轻盈车库节拍点亮离子樱花神社。',
  },
  'abyss-rail-frenzy': {
    style: '神经鼓与贝斯',
    summary: '神经低音与高压碎拍沿深海磁悬轨道持续加速。',
  },
  'helios-lift': {
    style: '欣快太阳浩室',
    summary: '欣快和弦与日冕节拍托起太阳升降圣殿。',
  },
  'cryo-cathedral-lullaby': {
    style: '冰川氛围碎拍',
    summary: '冰川质感的慢拍与极光氛围回响于冰晶教堂。',
  },
  'jade-canopy-heartbeat': {
    style: '有机部落浩室',
    summary: '有机打击、部落律动与生物荧光在雨林天幕中呼吸。',
  },
  'dune-crown-overture': {
    style: '电影感沙漠低音',
    summary: '电影感低音与庄严鼓组穿越沙海巨像王庭。',
  },
  'pixel-void-overdrive': {
    style: '芯片碎拍',
    summary: '芯片音色与高速碎拍环绕像素黑洞不断超驰。',
  },
});

const DIFFICULTY_COPY = Object.freeze({
  cruiser: '巡航',
  sentinel: '哨卫',
  vanguard: '先锋',
  apex: '极限',
  drifter: '漂流',
});

export function trackTitleZh(track, fallbackIndex = null) {
  return track?.metadata?.titleZh
    || track?.titleZh
    || track?.title
    || track?.name
    || track?.displayName
    || (fallbackIndex == null ? '未命名曲目' : `曲目 ${Math.max(0, Number(fallbackIndex) || 0) + 1}`);
}

export function trackStyleZh(track) {
  const explicit = track?.metadata?.styleZh || track?.styleZh || track?.genreZh;
  if (hasChinese(explicit)) return explicit;
  return BUILTIN_TRACK_COPY[track?.id]?.style || '原创曲目';
}

export function trackDifficultyZh(track) {
  const raw = track?.metadata?.difficultyZh || track?.difficultyZh || track?.metadata?.difficulty || track?.difficulty;
  if (hasChinese(raw)) return raw;
  return DIFFICULTY_COPY[String(raw || '').toLowerCase()] || '自适应';
}

export function trackSummaryZh(track) {
  const explicit = track?.descriptionZh || track?.summaryZh || track?.metadata?.descriptionZh;
  if (hasChinese(explicit)) return explicit;
  const builtin = BUILTIN_TRACK_COPY[track?.id]?.summary;
  if (builtin) return builtin;
  const world = track?.environment?.nameZh || track?.environment?.biomeZh;
  return `${hasChinese(world) ? world : '动态世界'} · 主题光剑、方向谱面与节拍响应光影。`;
}

function hasChinese(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ''));
}
