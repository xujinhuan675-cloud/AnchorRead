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

stdio 或离线文件模式生成链接时，可设置 `ANCHORREAD_PUBLIC_URL=https://<your-host>` 指定图解页面域名；浏览器内调用会优先使用当前页面域名。

## 远程 Streamable HTTP MCP

部署到云端后，标准远程 MCP 入口是：

```text
https://<your-host>/mcp
```

### 客户端授权与浏览器绑定

远程 `/mcp` 只使用 MCP 标准的 OAuth 2.1 authorization-code + PKCE 流程。客户端收到 `401` 后，可以通过
`/.well-known/oauth-protected-resource/mcp` 发现资源和授权服务器，再从
`/.well-known/oauth-authorization-server` 获取授权、令牌和动态注册端点。客户端注册一个带精确回调地址的
public client，打开授权页并让用户点击“允许连接”。原生客户端复用动态注册时，可以改变回环地址的临时端口；
协议、回环主机、回调路径和查询参数仍必须与注册值完全一致。

授权页会把用户带到 `/diagrams?mcp=oauth_approve&transaction=...`，当前图解页用本地浏览器身份完成确认，随后
回调客户端。客户端用 `code_verifier` 换取短期 access token 和轮换 refresh token；access token 仍使用
`Authorization: Bearer` 访问 `/mcp`。访问令牌绑定到用户确认的浏览器；浏览器关闭或离线时，MCP 会返回图解页链接，
支持打开 URL 的客户端应自动打开，不支持的客户端提示用户手动打开。

`/mcp/authorize` 只保留为 OAuth 连接说明页。手工生成、复制和长期保存的静态 Bearer Token 已弃用；连接面板和
`/api/mcp/pairing` 不再提供 Token 创建、轮换或撤销接口，旧的非过期 Token 记录也不会被加载或接受。

OAuth 客户端注册、授权事务、授权码哈希和 refresh token 哈希默认持久化到
`ANCHORREAD_MCP_OAUTH_STORE_PATH`。授权码和 refresh token 的明文不会写入磁盘；部署重启后，已注册客户端和有效的
refresh token 可以继续使用。

`/api/mcp` 也提供同一入口作为兼容路径。Codex、Claude Desktop、Cursor 等支持 Streamable HTTP 的客户端可以使用下面的配置：

```toml
[mcp_servers.anchor_read_diagram]
url = "https://<your-host>/mcp"
auth = "oauth"
scopes = ["diagrams:read", "diagrams:write"]
```

客户端只需要 MCP 地址。首次连接会自动打开浏览器授权，不需要复制 Token 或设置 Token 环境变量。

云端服务只需开启同源浏览器 bridge：

```text
ANCHORREAD_DIAGRAM_REMOTE_BRIDGE=true
```

OAuth 客户端在协议内部通过 `Authorization: Bearer <access-token>` 认证。每次请求解析该浏览器身份当前持有租约的在线图解标签页；浏览器重开后可以自动接回。MCP session 固定绑定 access token，不能在同一个 `MCP-Session-Id` 上切换令牌。若需要浏览器型 MCP 客户端跨域调用，再设置逗号分隔的来源白名单：

```text
ANCHORREAD_MCP_ALLOWED_ORIGINS=https://chat.example.com,https://app.example.com
```

回环地址（`localhost`、`127.0.0.1`、`::1`）仍可匿名用于本机开发；公网 `/mcp` 没有有效 OAuth access token 时返回 `401`。远程浏览器页面只有在 `ANCHORREAD_DIAGRAM_REMOTE_BRIDGE=true` 时才会轮询同源图解桥接队列。

浏览器不能访问或修改用户机器上的 `.codex/config.toml`。面板只显示可复制的 MCP 地址，客户端负责保存 OAuth 凭据。

默认 pairing store 会把浏览器管理哈希和短期 access-token 哈希持久化到 `ANCHORREAD_MCP_PAIRING_STORE_PATH`；OAuth store 会把客户端、授权事务、授权码哈希和 refresh-token 哈希持久化到 `ANCHORREAD_MCP_OAUTH_STORE_PATH`。未配置时分别使用项目目录下的 `.anchorread-data/diagram-mcp-pairings.json` 和 `.anchorread-data/diagram-mcp-oauth.json`。Docker 镜像默认写入 `/data`，部署脚本把它挂载到 `anchorread-data` 命名卷。浏览器在线状态、MCP session 和请求队列仍在单个 Node 进程内存中，重启后浏览器和客户端需要重新建立在线连接。

当前仍只支持单实例部署。多实例负载均衡会把 MCP 与浏览器轮询分到不同进程；生产多实例需要接入共享 Redis/数据库、跨实例队列和 WebSocket 或等价的可靠推送层。

远程端点实现 MCP 的 JSON-RPC `initialize`、`tools/list`、`tools/call`、`resources/list`、`resources/read`、`ping`、会话 `DELETE` 和 CORS `OPTIONS`。GET/SSE 未启用时返回 `405`，客户端应使用 Streamable HTTP 的 POST 请求/响应模式。

## MCP Apps 客户端内嵌画布

`create_diagram` 在工具元数据中声明了 `ui://anchorread/diagram/mcp-app.html` 资源。支持 MCP Apps 的 AI 客户端会读取该 HTML 资源，并在客户端消息中直接渲染可编辑的 Excalidraw 画布；画布中的“在 AnchorRead 中打开”按钮仍可跳转到正式工作区。客户端还可以主动调用 `resources/list` / `resources/read` 获取同一资源。

不支持 MCP Apps 的客户端不会被阻塞：工具结果仍返回标准 MCP `resource_link`，客户端可以打开图解 URL，或把链接交给用户。当前内嵌资源使用固定版本的 `esm.sh` 依赖；如果客户端宿主禁止外部资源加载，它应自动退回这个链接工作流。

## 典型调用

客户端需要让用户进入 AnchorRead 时，先调用 `open_diagram_workspace`。它会立即返回一个 MCP `resource_link`，支持浏览器或打开 URL 的 AI 客户端可以直接打开；它不依赖已配对的浏览器在线。

`create_diagram` 接收 `title`、`engine`，以及 Mermaid 的 `source` 或 Excalidraw 的完整 `scene`。默认 `open: true`，成功后当前 AnchorRead 标签页会打开新图解并将它保存到本地工作区。

如果调用时没有在线的 AnchorRead 浏览器，`create_diagram` 会返回 `nextAction: open_diagram_workspace_then_retry` 和工作区 `resource_link`。支持打开 URL 的客户端应先打开该链接再自动重试；CLI 或不支持打开网页的客户端只展示链接并提示用户手动打开。浏览器在线时不会增加这一步。

其它实时工具包括 `list_diagrams`、`get_diagram`、`describe_diagram`、`query_diagram`、`list_diagram_revisions`、`apply_diagram_patch`、`commit_diagram_scene` 和 `restore_diagram_revision`。写操作使用 `expectedRevision` 做乐观锁，避免 AI 覆盖用户刚刚的画布编辑。

## 浏览器会话与多标签页

每个浏览器来源在 `localStorage` 中生成内部浏览器标识和管理密钥，每个浏览器会话在 `sessionStorage` 中生成会话标识，每次页面加载生成页面生命周期唯一的 `tabId` 与 `clientId`。OAuth access token 只绑定该浏览器标识；请求进入队列时再携带当前在线连接的 browser/session/tab 作用域，不能落到其他浏览器或其他未持有租约的标签页。这些标识是内部路由实现，不是面向用户的“工作区”产品概念。

标签页通过本机 `localStorage` 维护短租约。只有当前可见且先取得租约的图解标签页才会注册并轮询 `/api/diagram-agent`。复制标签页虽然会复制 `sessionStorage`，但新的页面级 `tabId` 不会被复制；未持有租约的页面不能接管服务端路由。普通断线、刷新或浏览器重开后，由同一浏览器来源的新 session/tab 重新绑定，客户端可继续使用有效的 OAuth 凭据。

图解记录通过 `BroadcastChannel` 在同一浏览器来源的 AnchorRead 标签页之间广播。MCP 创建或修改的记录、用户在画布中的保存以及删除操作都会广播；接收方只合并 revision 更高、或同 revision 但 `updatedAt` 更新的记录，IndexedDB 仍是每个浏览器的持久化真源。浏览器不支持 `BroadcastChannel` 时，MCP 主流程仍可工作，只是不会获得跨标签页即时刷新。

同一个单进程实例可以按内部浏览器标识隔离多个已授权浏览器，并持久保存 OAuth 状态和短期 access-token 哈希，但它还不是多用户、多实例系统：没有账号/租户层、共享数据库、跨进程队列或可靠事件投递。
