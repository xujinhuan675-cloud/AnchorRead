# AnchorRead Diagram MCP

AnchorRead 的图解 MCP 默认连接当前打开的本地浏览器页面。MCP 只提交结构化命令；浏览器桥接在页面内读取和写入 IndexedDB，并按请求自动打开新图解。`.anchorread` 文件只用于用户主动执行的离线备份、导入导出和迁移，不是实时交互的中间层。

## MCP 配置

```json
{
  "mcpServers": {
    "anchor-read-diagram": {
      "command": "node",
      "args": ["--experimental-default-type=module", "F:/AnchorOS/6-项目仓库/AnchorRead/mcp/anchor-read-diagram-mcp.mjs"]
    }
  }
}
```

也可以显式指定地址：

```text
node mcp/anchor-read-diagram-mcp.mjs --bridge http://127.0.0.1:3000
```

生产或非本机代理场景设置 `ANCHORREAD_DIAGRAM_BRIDGE_TOKEN`，并在 MCP 进程中使用同名环境变量。服务端仅接受回环地址的桥接请求。

## 典型调用

`create_diagram` 接收 `title`、`engine`，以及 Mermaid 的 `source` 或 Excalidraw 的完整 `scene`。默认 `open: true`，成功后当前 AnchorRead 标签页会打开新图解并将它保存到本地工作区。

其它实时工具包括 `list_diagrams`、`get_diagram`、`describe_diagram`、`query_diagram`、`list_diagram_revisions`、`apply_diagram_patch`、`commit_diagram_scene` 和 `restore_diagram_revision`。写操作使用 `expectedRevision` 做乐观锁，避免 AI 覆盖用户刚刚的画布编辑。
