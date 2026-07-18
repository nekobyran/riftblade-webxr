# RIFT//BLADE 光痕裂界

一款完全原创、无需后端即可运行的 WebXR 双剑节奏游戏。三首程序化曲目、三套实时动态环境、三种主题化受伤剑效果全部在浏览器中生成，不依赖外部音乐、图片或运行时 API。

## 游玩方式

- **VR**：使用支持 WebXR `immersive-vr` 的头显浏览器，通过 HTTPS 打开页面，选择曲目后进入沉浸模式。左右手控制器分别驱动两把光刃。
- **桌面试玩**：移动鼠标定位；左/右键分别挥动双刃。`A/S/D/F` 控左剑，`J/K/L/;` 控右剑，`Q/E` 可快速切击；`Esc` 暂停。
- 建议使用耳机，并在开始曲目前允许网页播放声音。

## 三座原创世界

1. **NEON TIDE RUN / 霓虹潮汐** — 132 BPM liquid synthwave，穿越雨幕数据堤与跃迁环；受伤剑化为电涌浪花。
2. **EMBER CIRCUIT CHOIR / 余烬回路圣咏** — 104 BPM 工业仪式慢拍，熔炉圣堂与活塞拱门随鼓点呼吸；受伤剑迸裂熔岩余烬。
3. **GLASS ORBIT MONSOON / 玻璃轨道季风** — 148 BPM 零重力 tabla drum & bass，六边轨道、棱镜雨与旋转玻璃花园；受伤剑发生彩色晶体爆裂。

## 本地开发

Windows 下推荐使用项目脚本，依赖和构建产物固定写入 D 盘：

```powershell
pwsh -NoProfile -File .\command\Invoke-WebXR.ps1 -Action Install
pwsh -NoProfile -File .\command\Invoke-WebXR.ps1 -Action Check
pwsh -NoProfile -File .\command\Invoke-WebXR.ps1 -Action Dev
```

也可在已有 Node.js 环境中执行 `npm ci && npm run dev`。

## 静态发布

仓库内置 GitHub Pages Actions。推送 `main` 后会依次安装锁定依赖、运行游戏逻辑测试、构建静态文件并发布。WebXR 需要安全上下文；GitHub Pages 的 HTTPS 满足这一条件。

## 技术

Three.js · WebXR · Web Audio API · Vite · Vitest

> 这是原创作品，与任何商业节奏游戏或音乐版权方无关联。
