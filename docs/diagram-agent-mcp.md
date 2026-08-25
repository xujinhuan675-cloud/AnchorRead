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

本地桥接可设置 `ANCHORREAD_DIAGRAM_BRIDGE_TOKEN`，并在 MCP 进程中使用同名环境变量。公网部署请使用下方的标准远程 `/mcp` 入口，不要把本地 bridge URL 直接暴露到互联网。

## 远程 Streamable HTTP MCP

部署到云端后，标准远程 MCP 入口是：

```text
https://<your-host>/mcp
```

`/api/mcp` 也提供同一入口作为兼容路径。Codex、Claude Desktop、Cursor 等支持 Streamable HTTP 的客户端可以使用下面的配置：

```toml
[mcp_servers.anchor_read_diagram]
url = "https://<your-host>/mcp"
bearer_token_env_var = "ANCHORREAD_MCP_BEARER_TOKEN"
```

先在 AnchorRead 的图解库或具体图解页面打开「设置 -> MCP 连接」。首次使用只需点击「生成连接信息」，再按面板中的两步设置 Token 环境变量并复制 Codex 配置片段。Token 默认长期有效，直到用户主动撤销或重新生成；明文只在创建或轮换时显示一次，服务端只保存 SHA-256 哈希。

把 Token 放入启动 Codex 的本地环境：

```text
ANCHORREAD_MCP_BEARER_TOKEN=<token-created-in-anchorread>
```

云端服务只需开启同源浏览器 bridge：

```text
ANCHORREAD_DIAGRAM_REMOTE_BRIDGE=true
```

MCP 客户端通过 `Authorization: Bearer <token>` 认证。每个 Token 固定绑定创建它的稳定 `workspaceId`，每次请求再解析该工作区当前持有租约的在线浏览器标签页；浏览器重开后可用新的 `browserSessionId` 自动接回同一个工作区。MCP session 固定绑定 Token，不能在同一个 `MCP-Session-Id` 上切换 Token。若需要浏览器型 MCP 客户端跨域调用，再设置逗号分隔的来源白名单：

```text
ANCHORREAD_MCP_ALLOWED_ORIGINS=https://chat.example.com,https://app.example.com
```

回环地址（`localhost`、`127.0.0.1`、`::1`）仍可匿名用于本机开发；公网 `/mcp` 没有有效配对 Token 时返回 `401`。远程浏览器页面只有在 `ANCHORREAD_DIAGRAM_REMOTE_BRIDGE=true` 时才会轮询同源图解桥接队列。

浏览器不能访问或修改用户机器上的 `.codex/config.toml`。面板只提供配置片段复制；Token 环境变量由用户在本地 Codex 运行环境中设置。

默认 pairing store 会把工作区管理哈希和 Token 哈希持久化到 `ANCHORREAD_MCP_PAIRING_STORE_PATH`；未配置时使用项目目录下的 `.anchorread-data/diagram-mcp-pairings.json`，Docker 镜像默认使用 `/data/diagram-mcp-pairings.json`，部署脚本把 `/data` 挂载到 `anchorread-data` 命名卷。服务重启不会使 Token 失效，但浏览器在线状态、MCP session 和请求队列仍在单个 Node 进程内存中，重启后浏览器与 Codex 需要重新连接。

当前仍只支持单实例部署。多实例负载均衡会把 MCP 与浏览器轮询分到不同进程；`getDiagramMcpPairingStore()` / `setDiagramMcpPairingStore()` 保留 Token/绑定存储适配入口，`getDiagramAgentTransport()` / `setDiagramAgentTransport()` 保留请求队列与推送适配入口。生产多实例需要接入共享 Redis/数据库、跨实例队列和 WebSocket 或等价的可靠推送层。

远程端点实现 MCP 的 JSON-RPC `initialize`、`tools/list`、`tools/call`、`ping`、会话 `DELETE` 和 CORS `OPTIONS`。GET/SSE 未启用时返回 `405`，客户端应使用 Streamable HTTP 的 POST 请求/响应模式。

## 典型调用

`create_diagram` 接收 `title`、`engine`，以及 Mermaid 的 `source` 或 Excalidraw 的完整 `scene`。默认 `open: true`，成功后当前 AnchorRead 标签页会打开新图解并将它保存到本地工作区。

其它实时工具包括 `list_diagrams`、`get_diagram`、`describe_diagram`、`query_diagram`、`list_diagram_revisions`、`apply_diagram_patch`、`commit_diagram_scene` 和 `restore_diagram_revision`。写操作使用 `expectedRevision` 做乐观锁，避免 AI 覆盖用户刚刚的画布编辑。

## 浏览器会话与多标签页

每个浏览器来源在 `localStorage` 中生成稳定的 `workspaceId` 和管理密钥，每个浏览器会话在 `sessionStorage` 中生成 `browserSessionId`，每次页面加载生成页面生命周期唯一的 `tabId` 与 `clientId`。Token 只绑定稳定 workspace；请求进入队列时再携带当前在线连接的 workspace/session/tab 作用域，不能落到其他工作区或其他未持有租约的标签页。

标签页通过本机 `localStorage` 维护短租约。只有当前可见且先取得租约的图解标签页才会注册并轮询 `/api/diagram-agent`。复制标签页虽然会复制 `sessionStorage`，但新的页面级 `tabId` 不会被复制；未持有租约的页面不能接管服务端路由。普通断线、刷新或浏览器重开后，由同一 workspace 的新 session/tab 重新绑定，Token 不需要轮换。

图解记录通过 `BroadcastChannel` 在同一浏览器来源的 AnchorRead 标签页之间广播。MCP 创建或修改的记录、用户在画布中的保存以及删除操作都会广播；接收方只合并 revision 更高、或同 revision 但 `updatedAt` 更新的记录，IndexedDB 仍是每个浏览器的持久化真源。浏览器不支持 `BroadcastChannel` 时，MCP 主流程仍可工作，只是不会获得跨标签页即时刷新。

同一个单进程实例可以按 workspace 隔离多个已配对浏览器，并持久保存 Token 哈希，但它还不是完整的多用户、多实例生产系统：没有账号/租户层、共享 Token 数据库、跨进程队列或可靠事件投递。撤销/轮换会立即拒绝新请求并取消仍在服务端队列中的请求；已经被浏览器领取并开始执行的极短竞态窗口不能回滚已发生的 IndexedDB 修改。
