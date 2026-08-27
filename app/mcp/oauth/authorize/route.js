import { getDiagramMcpOAuthStore, oauthError, verifyOAuthRequest } from '@/lib/diagram-mcp-oauth';
import { getDiagramMcpResourceUrl } from '@/lib/diagram-mcp-authorization';
import { escapeHtml, oauthErrorResponse, requestOrigin } from '@/lib/diagram-mcp-oauth-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function queryRequest(url) {
  const params = url.searchParams;
  return verifyOAuthRequest({
    responseType: params.get('response_type'),
    clientId: params.get('client_id'),
    redirectUri: params.get('redirect_uri'),
    codeChallenge: params.get('code_challenge'),
    codeChallengeMethod: params.get('code_challenge_method'),
    state: params.get('state'),
    scope: params.get('scope'),
    resource: params.get('resource'),
  });
}

function validateResource(request, oauthRequest) {
  if (oauthRequest.resource && oauthRequest.resource !== getDiagramMcpResourceUrl(request)) {
    throw oauthError('invalid_target', 'The OAuth resource does not match the AnchorRead MCP endpoint.');
  }
}

function htmlResponse(html) {
  return new Response(html, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self';",
    },
  });
}

function renderConsent(request, oauthRequest, client) {
  const action = escapeHtml(new URL(request.url).pathname);
  const fields = Object.entries({
    response_type: 'code',
    client_id: oauthRequest.clientId,
    redirect_uri: oauthRequest.redirectUri,
    code_challenge: oauthRequest.codeChallenge,
    code_challenge_method: oauthRequest.codeChallengeMethod,
    state: oauthRequest.state,
    scope: oauthRequest.scope,
    resource: oauthRequest.resource,
  }).map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`).join('');
  const clientName = escapeHtml(client.clientName);
  return htmlResponse(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>授权连接 AnchorRead</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f7f5; color: #292524; }
      main { width: min(92vw, 36rem); padding: 2rem; border: 1px solid #e7e5e4; border-radius: .5rem; background: white; box-shadow: 0 12px 30px #00000012; }
      h1 { margin: 0 0 .75rem; font-size: 1.35rem; }
      p, li { line-height: 1.6; font-size: .92rem; }
      ul { padding-left: 1.2rem; }
      button { margin-top: .75rem; padding: .65rem 1rem; border: 0; border-radius: .4rem; background: #1c1917; color: white; font-weight: 600; cursor: pointer; }
      .note { color: #78716c; font-size: .8rem; }
      @media (prefers-color-scheme: dark) { body { background: #1c1917; color: #f5f5f4; } main { border-color: #44403c; background: #292524; } button { background: #f5f5f4; color: #1c1917; } .note { color: #a8a29e; } }
    </style>
  </head>
  <body>
    <main>
      <h1>授权连接 AnchorRead</h1>
      <p><strong>${clientName}</strong> 请求连接 AnchorRead。</p>
      <ul><li>客户端可以创建、读取和修改图解。</li><li>后续操作会发送到当前浏览器中的图解页面。</li></ul>
      <form method="post" action="${action}">${fields}<input type="hidden" name="approval" value="approve"><button type="submit">授权并绑定此浏览器</button></form>
      <p class="note">授权完成后会返回原 MCP 客户端；若客户端不支持自动打开浏览器，请复制授权地址到浏览器中继续。</p>
    </main>
  </body>
</html>`);
}

export async function GET(request) {
  try {
    const oauthRequest = queryRequest(new URL(request.url));
    validateResource(request, oauthRequest);
    const store = getDiagramMcpOAuthStore();
    const client = store.getClient(oauthRequest.clientId);
    store.validateRedirectUri(client, oauthRequest.redirectUri);
    return renderConsent(request, oauthRequest, client);
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

export async function POST(request) {
  try {
    const form = await request.formData();
    const oauthRequest = verifyOAuthRequest({
      responseType: form.get('response_type'),
      clientId: form.get('client_id'),
      redirectUri: form.get('redirect_uri'),
      codeChallenge: form.get('code_challenge'),
      codeChallengeMethod: form.get('code_challenge_method'),
      state: form.get('state'),
      scope: form.get('scope'),
      resource: form.get('resource'),
    });
    validateResource(request, oauthRequest);
    const store = getDiagramMcpOAuthStore();
    const client = store.getClient(oauthRequest.clientId);
    store.validateRedirectUri(client, oauthRequest.redirectUri);
    if (form.get('approval') !== 'approve') throw oauthError('access_denied', 'The user denied access.');
    const transaction = store.createTransaction({
      ...oauthRequest,
      codeChallengeMethod: oauthRequest.codeChallengeMethod,
      scopes: oauthRequest.scope,
    });
    const handoff = new URL('/diagrams', requestOrigin(request));
    handoff.searchParams.set('mcp', 'oauth_approve');
    handoff.searchParams.set('transaction', transaction.id);
    return Response.redirect(handoff.toString(), 303);
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
