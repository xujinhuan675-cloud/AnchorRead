import {
  getDiagramMcpAuthorizationInfo,
} from '@/lib/diagram-mcp-authorization';
import { getDiagramMcpRuntimeInfo } from '@/lib/diagram-mcp-pairing-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function GET(request) {
  const info = getDiagramMcpAuthorizationInfo(request, getDiagramMcpRuntimeInfo());
  const endpoint = escapeHtml(info.mcpEndpoint);
  const diagramsUrl = escapeHtml(info.diagramsUrl);
  const statusUrl = escapeHtml(info.statusUrl);
  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>连接 AnchorRead MCP</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f7f5; color: #292524; }
      main { width: min(92vw, 36rem); padding: 2rem; border: 1px solid #e7e5e4; border-radius: .75rem; background: white; box-shadow: 0 12px 30px #00000012; }
      h1 { margin: 0 0 .75rem; font-size: 1.35rem; }
      p, li { line-height: 1.6; font-size: .92rem; }
      code { word-break: break-all; }
      a.button { display: inline-block; margin-top: .75rem; padding: .65rem 1rem; border-radius: .4rem; background: #1c1917; color: white; text-decoration: none; font-weight: 600; }
      .note { color: #78716c; font-size: .8rem; }
      @media (prefers-color-scheme: dark) { body { background: #1c1917; color: #f5f5f4; } main { border-color: #44403c; background: #292524; } a.button { background: #f5f5f4; color: #1c1917; } .note { color: #a8a29e; } }
    </style>
  </head>
  <body>
    <main>
      <h1>连接 AnchorRead MCP</h1>
      <p>支持 OAuth 2.1 的 MCP 客户端会自动打开授权页；旧客户端可以打开图解工作区，在“设置 → MCP 连接”中生成或管理 Bearer Token。</p>
      <a class="button" href="${diagramsUrl}">打开图解工作区</a>
      <p class="note">MCP 地址：<code>${endpoint}</code><br>状态接口：<code>${statusUrl}</code></p>
    </main>
  </body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline';",
    },
  });
}
