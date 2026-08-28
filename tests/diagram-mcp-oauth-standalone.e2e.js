import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const configuredBaseUrl = String(process.env.ANCHORREAD_MCP_E2E_URL || '').trim();
assert.ok(configuredBaseUrl, 'ANCHORREAD_MCP_E2E_URL must point to a running standalone server.');

const baseUrl = new URL(configuredBaseUrl);
const callback = `http://127.0.0.1:43123/callback/${randomBytes(9).toString('base64url')}`;
const registrationResponse = await fetch(new URL('/mcp/oauth/register', baseUrl), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    client_name: 'AnchorRead standalone OAuth regression',
    redirect_uris: [callback],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }),
});
const client = await registrationResponse.json();
assert.equal(registrationResponse.status, 201, JSON.stringify(client));
assert.deepEqual(client.redirect_uris, [callback]);

const authorizationUrl = new URL('/mcp/oauth/authorize', baseUrl);
authorizationUrl.search = new URLSearchParams({
  response_type: 'code',
  client_id: client.client_id,
  redirect_uri: callback,
  code_challenge: 'a'.repeat(43),
  code_challenge_method: 'S256',
  state: 'standalone-regression',
  resource: new URL('/mcp', baseUrl).toString(),
}).toString();

const authorizationResponse = await fetch(authorizationUrl, { redirect: 'manual' });
const consentHtml = await authorizationResponse.text();
assert.equal(authorizationResponse.status, 200, consentHtml);
assert.match(consentHtml, /<title>授权连接 AnchorRead<\/title>/u);
assert.ok(
  consentHtml.includes(`name="redirect_uri" value="${callback}"`),
  'The consent form must preserve the registered IPv4 loopback redirect URI.',
);

console.log('Standalone OAuth loopback regression passed:', JSON.stringify({
  baseUrl: baseUrl.origin,
  redirectUri: callback,
}));
