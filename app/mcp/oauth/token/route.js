import { getDiagramMcpOAuthStore, oauthError } from '@/lib/diagram-mcp-oauth';
import { getDiagramMcpPairingStore } from '@/lib/diagram-mcp-pairing-store';
import { oauthErrorResponse, oauthJson, oauthOptions } from '@/lib/diagram-mcp-oauth-http';
import { getDiagramMcpResourceUrl } from '@/lib/diagram-mcp-authorization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

function tokenResponse({ token, record, refreshToken, scopes }) {
  return {
    access_token: token,
    token_type: 'Bearer',
    expires_in: Math.max(1, Math.floor((Number(record?.expiresAt) - Date.now()) / 1000)),
    refresh_token: refreshToken,
    scope: (scopes || ['diagrams:read', 'diagrams:write']).join(' '),
  };
}

async function parseBody(request) {
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) return request.json();
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export async function POST(request) {
  try {
    const body = await parseBody(request);
    const grantType = String(body?.grant_type || '').trim();
    const clientId = String(body?.client_id || '').trim();
    if (!clientId) throw oauthError('invalid_client', 'client_id is required.', 401);
    if (body?.resource && String(body.resource) !== getDiagramMcpResourceUrl(request)) {
      throw oauthError('invalid_target', 'The OAuth resource does not match the AnchorRead MCP endpoint.');
    }
    const oauthStore = getDiagramMcpOAuthStore();
    const pairingStore = getDiagramMcpPairingStore();
    let record;
    let refreshToken;
    if (grantType === 'authorization_code') {
      record = oauthStore.consumeCode({
        code: body?.code,
        clientId,
        redirectUri: body?.redirect_uri,
        codeVerifier: body?.code_verifier,
      });
      const issued = await pairingStore.createTokenForWorkspace(record.browserContext, {
        name: record.clientName,
        expiresInMs: ACCESS_TOKEN_TTL_MS,
      });
      refreshToken = oauthStore.createRefreshToken(record);
      return oauthJson(tokenResponse({ token: issued.token, record: issued.record, refreshToken, scopes: record.scopes }));
    }
    if (grantType === 'refresh_token') {
      const rotated = oauthStore.rotateRefreshToken(body?.refresh_token, { clientId });
      record = rotated;
      const issued = await pairingStore.createTokenForWorkspace(record.browserContext, {
        name: 'MCP client',
        expiresInMs: ACCESS_TOKEN_TTL_MS,
      });
      refreshToken = rotated.refreshToken;
      return oauthJson(tokenResponse({ token: issued.token, record: issued.record, refreshToken, scopes: record.scopes }));
    }
    throw oauthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported.');
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

export async function OPTIONS() {
  return oauthOptions();
}
