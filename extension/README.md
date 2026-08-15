# AnchorRead Clipper（浏览器扩展）

Manifest V3 扩展，两种能力：

1. **剪藏**：把当前网页一键发送到自托管的 AnchorRead，自动抽取正文并建立阅读文档。
2. **原地阅读**：在任意网页划词就地 AI 解读（类似沉浸式翻译的贴页体验），侧边栏暂存采集结果，一键回流到 AnchorRead 工作区。

完整的使用文档（工作原理、安装、配置、常见问题）见
[docs/browser-extension.md](../docs/browser-extension.md)。

## 快速安装

1. 启动 AnchorRead（默认 `http://localhost:3000`）。
2. `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择本目录。
3. 若地址不同，右键扩展图标 → 选项，填写实际地址。
4. 使用原地划词解读：选项页填写访问密码（服务端需启用 `ACCESS_PASSWORD` 并配置 `SERVER_LLM_*`）。

## 文件说明

- `manifest.json` — MV3 清单（activeTab / storage / contextMenus / tabs / sidePanel，含 content script、侧边栏与图标声明）
- `background.js` — service worker：右键菜单与工具栏入口；代理调用 AnchorRead `/api/explain`；收件箱读写与回流深链
- `content.js` — content script：提取当前页已渲染 DOM；在 AnchorRead 页面内回交接载荷（剪藏或收件箱）
- `inline-reader.js` — content script：划词悬浮按钮与解读卡（Shadow DOM 隔离样式）
- `sidepanel.html` / `sidepanel.js` — 侧边栏：收件箱与扩展本地术语表，发起回流
- `options.html` / `options.js` — 配置 AnchorRead 实例地址、访问密码与 API Key（存 `chrome.storage.sync`）
- `icons/` — 图标源 SVG 与各尺寸 PNG（扩展图标与网页 favicon 同源设计）
