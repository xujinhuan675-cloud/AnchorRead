# AnchorRead 浏览器扩展使用文档

`extension/` 目录提供一个 Manifest V3 浏览器扩展（Chrome / Edge），包含两种能力：

1. **剪藏**：把当前网页**一键发送**到自托管的 AnchorRead 实例，自动抽取正文并建立阅读文档。
2. **原地阅读**：在任意网页上划词就地 AI 解读，侧边栏暂存采集结果，一键回流到 AnchorRead 工作区。

## 剪藏工作原理

1. 点击工具栏图标，或右键页面/链接选择「发送到 AnchorRead」。
2. 扩展优先让注入在当前页的 content script 提取「已渲染 DOM」，
   暂存到 `chrome.storage.local`，然后打开深链 `<AnchorRead 地址>/?import=<URL>&via=clipper`
   （已有 AnchorRead 标签页时复用该标签页）。
3. AnchorRead 前端检测到 `via=clipper` 后，通过 postMessage 与注入在本页的
   content script 握手取回载荷，调用自身 `POST /api/import-url`（携带 HTML），
   在服务端用 Readability 抽取正文、转 Markdown，并写入本地工作区（IndexedDB）。
4. 若提取失败（页面过大、无注入脚本等），自动回退为纯 URL 深链 `/?import=<URL>`，
   由服务端重新抓取该网页。
5. 导入完成后地址栏参数自动清除，页面提示「已从扩展导入：《标题》」。

**隐私边界**：扩展不向任何第三方上传数据；已渲染 DOM 仅暂存在本机
`chrome.storage.local`，交接给 AnchorRead 页面后即清除，正文最终只保存在你浏览器的 IndexedDB 中。

## 原地阅读模式（划词解读 + 侧边栏）

不离开当前网页，直接在原文上获得 AnchorRead 的解读能力（类似沉浸式翻译的贴页体验）：

1. 在任意网页划词，选区旁出现「⚓ 解读」悬浮按钮（右键选中文本也有同名菜单项）。
2. 点击后扩展经 background 代理调用 AnchorRead 的 `POST /api/explain`，
   以选区周围的页面正文作为上下文，返回白话解读与术语，以解读卡形式贴近原文展示。
3. 解读卡支持：**存收件箱**（暂存到扩展）、复制、打开侧边栏、**深读本页**（走剪藏链路导入完整文档）。
4. 点工具栏图标打开侧边栏：**收件箱**展示所有采集的解读（可按当前页过滤、删除），
   **术语表**由你在扩展本地维护，解读时作为背景交代给 AI（命中后不再重复解释）。
5. 侧边栏点「回流到 AnchorRead」：收件箱与术语表经既有 postMessage 深链握手交回工作区：
   术语按名称去重并入术语表；解读按来源网址匹配既有文档，命中则挂到该文档的解读列表（知识面板可见），
   尚未导入对应网页的解读会提示暂未挂载（可先「深读本页」再回流）。AnchorRead 确认接收后收件箱自动清空。

**前置条件**：原地解读需要服务端启用访问密码（`ACCESS_PASSWORD`）并配置 `SERVER_LLM_*`，
并在扩展选项页填写同一密码；扩展本身不持有 LLM API Key。

**能力边界**：一期只提供划词解读与侧边栏采集；全文术语高亮、文档关系图、精准替代、
FSRS 闪卡复习等重能力仍在 Reader Lab 内，用「深读本页」衔接。

## 安装（开发者模式）

1. 启动你的 AnchorRead 实例：`npm run dev` 或 `npm run start`（默认 `http://localhost:3000`）。
2. Chrome / Edge 打开 `chrome://extensions`（或 `edge://extensions`）。
3. 打开右上角「开发者模式」→「加载已解压的扩展程序」→ 选择仓库内 `extension/` 目录。
4. 若 AnchorRead 不在 `http://localhost:3000`：右键扩展图标 →「选项」，填写实际地址（存 `chrome.storage.sync`）；
   保存时会请求该地址的 host 权限（后台调用 API 需绕过 CORS），并自动探测连通性。
5. 使用原地解读：服务端设置 `ACCESS_PASSWORD` 与 `SERVER_LLM_TYPE/BASE_URL/API_KEY/MODEL`，
   在选项页「访问密码」填入同一密码。

## 使用

| 操作 | 效果 |
|---|---|
| 点击工具栏图标 | 打开/关闭 AnchorRead 侧边栏（收件箱 + 术语表） |
| 网页上划词 → 点「⚓ 解读」 | 原地 AI 解读选中文本，可存收件箱/复制/深读本页 |
| 右键选中文本 →「AnchorRead 解读选中文本」 | 同上 |
| 右键页面 →「发送到 AnchorRead」 | 把当前标签页（已渲染 DOM 优先）剪藏到 AnchorRead |
| 右键链接 →「发送到 AnchorRead」 | 把该链接地址（而非当前页）发送过去，走服务端重抓取 |

## 文件说明

- `manifest.json` — MV3 清单（权限：`activeTab` / `storage` / `contextMenus` / `tabs` / `sidePanel`，含 content script、侧边栏与图标声明）
- `background.js` — service worker：右键菜单与工具栏入口；代理调用 `/api/explain`；收件箱读写与回流深链
- `content.js` — content script：提取当前页已渲染 DOM；在 AnchorRead 页面内回交接载荷（剪藏或收件箱）
- `inline-reader.js` — content script：划词悬浮按钮与解读卡，UI 全部在 Shadow DOM 内
- `sidepanel.html` / `sidepanel.js` — 侧边栏：收件箱与扩展本地术语表，发起回流
- `options.html` / `options.js` — 配置 AnchorRead 实例地址、访问密码与 API Key
- `icons/` — 图标源 SVG 与各尺寸 PNG（扩展图标与网页 favicon 同源设计）

## 注意事项与常见问题

- **API Key**：若 AnchorRead 启用了 `ANCHORREAD_API_KEY`，深链导入在 AnchorRead 自己页面内
  发起同源请求，同样需要在设置页填写 Key；扩展侧在选项页填写同一 Key 即可。
- **原地解读依赖访问密码**：扩展不持有 LLM 配置，解读请求走服务端
  `ACCESS_PASSWORD` + `SERVER_LLM_*` 通道；未配置时解读卡会给出明确引导。
- **SSRF 防护**：纯 URL 模式下 `/api/import-url` 不允许抓取内网/回环地址；
  已渲染 DOM 模式服务端不发起抓取，因此内网页面也可以通过扩展剪藏。
- **页面过大**：已渲染 DOM 超过 5MB 时扩展自动回退到 URL 重抓取模式。
- **导入失败**：确认 AnchorRead 实例正在运行、扩展选项中的地址可访问；
  纯 JS 渲染、强反爬、需要登录的页面在已渲染 DOM 模式下通常可以正常抽取。
- **回流未匹配**：解读按来源网址匹配工作区文档；尚未剪藏过的网页解读会提示暂未挂载，
  先「深读本页」导入文档再回流即可挂上。
- **侧边栏打开失败**：chrome.sidePanel 需要用户手势；若解读卡内「侧边栏」按钮无效，直接点工具栏图标。
- **数据去向**：正文与回流后的解读/术语只保存在你浏览器的 IndexedDB 中；扩展收件箱仅是本机中转。
  如需跨设备，请使用文档库 ☁「工作区同步」或导出备份。
