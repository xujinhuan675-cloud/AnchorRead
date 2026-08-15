# AnchorRead Clipper（浏览器扩展）

Manifest V3 扩展：把当前网页一键发送到自托管的 AnchorRead，自动抽取正文并建立阅读文档。

完整的使用文档（工作原理、安装、配置、常见问题）见
[docs/browser-extension.md](../docs/browser-extension.md)。

## 快速安装

1. 启动 AnchorRead（默认 `http://localhost:3000`）。
2. `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择本目录。
3. 若地址不同，右键扩展图标 → 选项，填写实际地址。

## 文件说明

- `manifest.json` — MV3 清单（activeTab / storage / contextMenus / tabs）
- `background.js` — service worker：工具栏与右键菜单入口，拼装深链并复用标签页
- `options.html` / `options.js` — 配置 AnchorRead 实例地址（存 `chrome.storage.sync`）
