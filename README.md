# Anchor Read

> **本地优先的深度阅读工作台：读懂一篇文档，并真正记住它**

Anchor Read（原 smart-excalidraw-next）把"阅读专业文章"变成一条完整的知识内化链路：**读 → 懂 → 选 → 记**。你的文档、解读、图表与学习记录全部保存在浏览器本地，不上传云端；AI 请求只发送到你配置的模型服务。

阅读英文版本：[README_EN.md](README_EN.md)

## ✨ 核心特性

### 📖 原文阅读器：事实源永远不被修改
- 三种阅读模式：**原文**（纯净事实源）/ **对照**（原文与派生解读并排）/ **精准替代**（用易懂表述替换原文难点，并保留来源映射标记）
- Markdown 全文渲染，支持表格、代码块，阅读进度自动保存

### 🧠 AI 行间解读与术语识别
- 选中任意句子"解释这段"，解读卡片贴着原文行内展开，可标记"懂了"或删除
- 选中术语"识别术语"，生成术语卡并可一键定位回原文锚点
- 全文重点分析：一次定位为整篇文章生成贴行辅助

### 🗺️ 文档关系图（Mermaid / Excalidraw）
- 选中原文锚定后生成文档关系图，**内联嵌入对应原文下方**，不再跳转
- 卡片内可切换 Mermaid / Excalidraw 双引擎，支持"查看源码"折叠、AI 优化图表代码
- 图表历史可回溯复用

### 🎯 按需辅助：你来决定页面铺什么
- 工具栏提供**解读 / 图表**显示开关，可逐项选择或全部打开
- 所有功能围绕"快速理解这篇文档"服务，不把内容一股脑铺在页面上

### 🃏 闪卡复习（FSRS 间隔重复）
- 工具栏一键为当前文档生成闪卡，直接进入知识面板的"闪卡复习"
- FSRS-5 算法自动安排下次复习时间，支持翻卡评分（忘记/困难/记得/轻松）与跳过
- 卡片库按文档归档，可逐张删除；到期数量实时角标提醒

### 🔒 本地优先，数据自主
- 文档、解读、术语、图表、闪卡全部存于浏览器（IndexedDB / localStorage）
- 支持导出 / 导入 `.anchorread` 工作区文件备份（带版本自动迁移）
- 未配置模型时自动降级为明确标注的 Demo 演示，不产生静默联网

### 🔌 生态与扩展性

- **多种导入**：粘贴文本、`.md/.txt` 文件、**网页 URL**（服务端 Readability 抽取正文，带 SSRF 防护）、**EPUB**（客户端解析章节）
- **多种导出**：`.anchorread` 工作区备份、**Anki** 闪卡文本、**Obsidian** Markdown 笔记包（解读/术语）
- **自定义动作插件**：自定义"选区提示词模板"（`{{selection}}` / `{{context}}` 占位符），选中文本即可执行你的专属动作
- **开放 API**：设置环境变量 `ANCHORREAD_API_KEY` 即启用 API Key 鉴权（`x-api-key` 或 `Authorization: Bearer`）；`/api/openapi` 提供 OpenAPI 3.0 文档
- **MCP Server**：把导出的工作区只读暴露给 Claude 等 MCP 客户端（文档/术语/闪卡查询与全文搜索），详见 [docs/mcp-server.md](docs/mcp-server.md)
- **工作区同步**：存储适配器抽象（`lib/sync-storage.js`），内置浏览器本地同步槽与 **WebDAV**（坚果云 / Alist / Nextcloud）推送与拉取
- **浏览器扩展**：`extension/` 提供 MV3 Clipper，一键把当前网页发送到 AnchorRead 自动抽取正文入库，详见 [docs/browser-extension.md](docs/browser-extension.md)
- **多语言基础**：`lib/i18n.js` 轻量 i18n 框架（zh-CN / en 词典与回退链），界面文案可渐进迁移

## 🚀 快速开始

### 方式一：使用访问密码

如果服务器管理员已配置访问密码，你可以直接使用服务器端的 LLM 配置，无需自己提供 API Key：

1. 点击右上角的 **"访问密码"** 按钮
2. 输入管理员提供的访问密码
3. 点击 **"验证密码"** 测试连接
4. 勾选 **"启用访问密码"** 并保存

启用后，应用将优先使用服务器端配置，你无需配置自己的 API Key 即可开始阅读！

### 方式二：配置自己的 AI

1. 点击右上角的 **"配置"** 按钮
2. 选择提供商类型（OpenAI 或 Anthropic）
3. 填入你的 API Key 与模型
4. 保存配置

之后即可在阅读中生成解读、术语、关系图与闪卡。

### 阅读工作流

1. **导入文档**：粘贴正文、上传 `.md/.txt/.epub` 文件、粘贴网页 URL，或用浏览器扩展一键剪藏，解析并进入阅读
2. **读与懂**：选中句子"解释这段"、"识别术语"、"图表"锚定生成关系图，或执行你的自定义动作
3. **选**：用工具栏开关决定显示哪些内联辅助
4. **记**：点击"生成闪卡"，在知识面板"闪卡复习"里按间隔重复巩固；可导出 Anki / Obsidian 到外部生态

## 💻 本地部署

```bash
# 克隆项目
git clone <your-repo-url>
cd AnchorRead

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 运行契约测试
pnpm test:reader-lab

# 运行全部单元测试
pnpm test:all
```

访问 http://localhost:3000 即可使用。

### 方式二：Docker 部署

```bash
# 构建镜像（多阶段构建，产物为 Next.js standalone server）
docker build -t anchorread .

# 运行；可选设置 API Key 启用开放接口鉴权
docker run -p 3000:3000 -e ANCHORREAD_API_KEY=your-key anchorread
```

### 方式三：浏览器扩展（剪藏）

在 `chrome://extensions` 开启开发者模式，加载已解压的扩展程序，选择仓库内 `extension/` 目录。
点击工具栏图标或右键「发送到 AnchorRead」，即可把当前网页发送过来自动抽取正文。详见 [docs/browser-extension.md](docs/browser-extension.md)。

### 配置服务器端 LLM（可选）

如果你想为用户提供统一的 LLM 配置，避免他们自己申请 API Key，可以配置服务器端访问密码功能：

1. 复制环境变量示例文件：
```bash
cp .env.example .env
```

2. 在 `.env` 中配置以下变量：
```bash
# 访问密码（用户需要输入此密码才能使用服务器端 LLM）
ACCESS_PASSWORD=your-secure-password

# LLM 提供商类型（openai 或 anthropic）
SERVER_LLM_TYPE=anthropic

# API 基础 URL
SERVER_LLM_BASE_URL=https://api.anthropic.com/v1

# API 密钥
SERVER_LLM_API_KEY=sk-ant-your-key-here

# 模型名称
SERVER_LLM_MODEL=claude-sonnet-4-5-20250929
```

3. 重启开发服务器，用户即可通过访问密码使用服务器端配置的 LLM。

**优势：**
- 用户无需自己申请和配置 API Key
- 统一管理 API 使用和成本
- 适合团队或组织内部使用

## ❓ 常见问题

**Q: 数据安全吗？**
A: 所有文档与学习记录仅保存在你的浏览器本地，不会上传到任何服务器。浏览器数据可能被清除，请定期使用"导出"备份工作区。

**Q: 解读会修改我的原文吗？**
A: 不会。解读、术语、图表、闪卡都是派生内容，随时可开关与删除，源文档保持不变。"精准替代"模式也只是生成替换视图，不改写原文。

**Q: 闪卡复习的调度算法是什么？**
A: FSRS-5 间隔重复算法，根据每次评分（忘记/困难/记得/轻松）更新卡片稳定性与难度，自动计算下次到期时间。

**Q: 什么是访问密码功能？**
A: 访问密码功能允许服务器管理员配置统一的 LLM，用户只需输入密码即可使用，无需自己申请 API Key。启用访问密码后，将优先使用服务器端配置，忽略本地配置。

## 🛠️ 技术栈

Next.js 16 · React 19 · Tiptap v3（ProseMirror）· Excalidraw · Mermaid · Monaco Editor · Tailwind CSS 4 · FSRS-5 · IndexedDB

## 📄 许可证

MIT License（本项目基于 MIT 许可的 smart-excalidraw-next 演进而来，感谢原项目作者）

## 联系作者

微信号： liujuntaoljt

<img width="200"  alt="微信图片_20251103110224_44_85" src="https://github.com/user-attachments/assets/6d8c4da2-af27-4213-b929-0d47fa51e9b5" />

## 💖 赞助

感谢以下赞助者对本项目的支持：

<!-- 赞助者名单 -->
- API中转站：[AI 网关｜插件世界](https://ai-router.plugins-world.cn)

如果这个项目对你有帮助，欢迎通过以下方式支持：
- ⭐ 给项目点个 Star
- 💬 分享给更多需要的人
- 💰 成为赞助者（联系作者微信）

## 友情链接

- https://github.com/ZhangQL2824/auto-drawio.git

---

**Anchor Read** — 让每一篇难懂的文档，都变成你记得住的知识
