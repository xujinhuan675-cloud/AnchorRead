# AnchorRead Clipper 浏览器扩展使用文档

`extension/` 目录提供一个 Manifest V3 浏览器扩展（Chrome / Edge），
把当前网页**一键发送**到自托管的 AnchorRead 实例，自动抽取正文并建立阅读文档。

## 工作原理

1. 点击工具栏图标，或右键页面/链接选择「发送到 AnchorRead」。
2. 扩展打开 `<AnchorRead 地址>/?import=<当前页URL>` 深链（已有 AnchorRead 标签页时复用该标签页）。
3. AnchorRead 前端检测到 `?import=` 参数后，调用自身 `POST /api/import-url`，
   在服务端用 Readability 抽取正文、转 Markdown，并写入本地工作区（IndexedDB）。
4. 导入完成后地址栏参数自动清除，页面提示「已从扩展导入：《标题》」。

**隐私边界**：扩展本身不抓取网页内容、不向任何第三方上传数据，只负责把当前页 URL 传给你自己的 AnchorRead 实例。

## 安装（开发者模式）

1. 启动你的 AnchorRead 实例：`npm run dev` 或 `npm run start`（默认 `http://localhost:3000`）。
2. Chrome / Edge 打开 `chrome://extensions`（或 `edge://extensions`）。
3. 打开右上角「开发者模式」→「加载已解压的扩展程序」→ 选择仓库内 `extension/` 目录。
4. 若 AnchorRead 不在 `http://localhost:3000`：右键扩展图标 →「选项」，填写实际地址（存 `chrome.storage.sync`）。

## 使用

| 操作 | 效果 |
|---|---|
| 点击工具栏图标 | 把当前标签页 URL 发送到 AnchorRead |
| 右键页面 →「发送到 AnchorRead」 | 同上 |
| 右键链接 →「发送到 AnchorRead」 | 把该链接地址（而非当前页）发送过去 |

## 文件说明

- `manifest.json` — MV3 清单（权限：`activeTab` / `storage` / `contextMenus` / `tabs`）
- `background.js` — service worker：工具栏与右键菜单入口，拼装深链并复用标签页
- `options.html` / `options.js` — 配置 AnchorRead 实例地址

## 注意事项与常见问题

- **API Key**：若 AnchorRead 启用了 `ANCHORREAD_API_KEY`，深链导入在 AnchorRead 自己页面内
  发起同源请求，同样需要在设置页填写 Key；扩展无需感知。
- **SSRF 防护**：`/api/import-url` 不允许抓取内网/回环地址的网页，扩展发送此类 URL 时会收到导入失败提示。
- **导入失败**：确认 AnchorRead 实例正在运行、扩展选项中的地址可访问；部分强反爬或纯 JS 渲染的页面可能抽取不到正文。
- **数据去向**：正文只保存在你浏览器的 IndexedDB 中；如需跨设备，请使用文档库 ☁「工作区同步」或导出备份。
