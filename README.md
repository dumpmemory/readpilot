# AgentReader

一个基于 Electron 的轻量 EPUB 阅读器，界面采用接近 Notion 的极简风格，支持：

- 打开本地 `.epub` 文件
- 左侧目录导航（TOC）
- 上/下章切换与进度条
- 字号、行高、阅读宽度调节
- 深色/浅色主题

## 快速开始

```bash
npm install
npm start
```

启动后可通过以下方式打开 EPUB：

- 点击左侧 `打开 EPUB`
- `Ctrl/Cmd + O`
- 拖拽 `.epub` 文件到窗口

如果你用的是 `pnpm`，首次安装可能会提示 `Ignored build scripts: electron`，执行一次：

```bash
pnpm approve-builds
```

在交互中勾选 `electron` 并确认，随后再执行：

```bash
pnpm install
pnpm start
```
