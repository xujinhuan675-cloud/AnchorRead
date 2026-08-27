# AnchorRead MCP Server 使用文档

AnchorRead 内置一个**零依赖**的 MCP（Model Context Protocol）服务器，通过 stdio 传输，
把你导出的 `.anchorread` 工作区文件**只读**暴露给 Claude Desktop、Cursor、Qoder 等任意 MCP 客户端。

AI 助手因此可以查询你的阅读文档、术语、闪卡，并做全文搜索——而无需访问浏览器或数据库。

## 前置条件

- Node.js ≥ 18（仅用标准库，无需安装任何依赖）
- 一份 AnchorRead 导出的工作区文件：文档库头部 ⬇「导出工作区备份」，得到 `*.anchorread` 文件

## 启动方式

```bash
# 方式一：命令行参数
node mcp/anchor-read.mjs <workspace-file.anchorread>

# 方式二：环境变量
ANCHORREAD_WORKSPACE_FILE=<path> node mcp/anchor-read.mjs
```

## MCP 客户端配置

### Claude Desktop（claude_desktop_config.json）

```json
{
  "mcpServers": {
    "anchor-read": {
      "command": "node",
      "args": [
        "F:/path/to/AnchorRead/mcp/anchor-read.mjs",
        "F:/path/to/anchor-read-workspace.anchorread"
      ]
    }
  }
}
```

### Cursor / Qoder 等支持 MCP 的编辑器

在 MCP 服务器配置中添加同上的 `command + args` 即可（stdio 类型）。

## 工具清单

| 工具 | 参数 | 说明 |
|---|---|---|
| `workspace_summary` | 无 | 工作区概览：各存储区记录数量与导出时间 |
| `list_documents` | 无 | 列出所有文档（id、标题、来源类型、更新时间、正文长度） |
| `get_document` | `id` | 按 id 获取单个文档的完整正文（Markdown） |
| `list_terms` | 无 | 列出积累的术语及解释（超长内容自动截断为预览） |
| `list_flashcards` | 无 | 列出记忆闪卡（front/back） |
| `search_workspace` | `query`、`limit?` | 在文档正文、术语、闪卡中关键词全文搜索，返回命中片段（默认 20 条） |

## 使用示例

配置完成后，在 MCP 客户端中可以直接提问，例如：

- 「列出我 AnchorRead 工作区里的所有文档」→ 触发 `list_documents`
- 「搜索我笔记里关于『间隔重复』的内容」→ 触发 `search_workspace`
- 「把《xxx》这篇文档的正文读给我并总结」→ `get_document` 后由模型总结

## 行为与限制

- **只读**：服务器只暴露查询工具，不会修改工作区文件，也不会写回 AnchorRead。
- **快照语义**：读取的是导出时刻的 `.anchorread` 文件；在 AnchorRead 中新增内容后，
  需要重新「导出工作区备份」才能被 MCP 客户端看到。
- **长文本截断**：`list_terms` / `list_flashcards` 中超过 200 字符的 content 会截断为
  `contentPreview`，避免撑爆上下文；完整正文请用 `get_document`。
- **错误处理**：工具执行失败会以 MCP `isError` 结果返回（如文档 id 不存在），不会中断会话。
- 协议版本 `2024-11-05`，仅实现 `initialize / tools/list / tools/call / ping`。

## 相关文件

- 实现：`mcp/anchor-read.mjs`
- 工作区文件解析与版本迁移：`lib/workspace-file.js`（测试见 `tests/workspace-file.test.js`）
