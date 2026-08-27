import {
  getDiagramMcpOAuthAuthorizationUrl,
  getDiagramMcpOAuthRegisterUrl,
  getDiagramMcpOAuthTokenUrl,
} from '@/lib/diagram-mcp-authorization';
import { oauthHeaders, oauthOptions, requestOrigin } from '@/lib/diagram-mcp-oauth-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return new Response(JSON.stringify({
    issuer: requestOrigin(request),
    authorization_endpoint: getDiagramMcpOAuthAuthorizationUrl(request),
    token_endpoint: getDiagramMcpOAuthTokenUrl(request),
    registration_endpoint: getDiagramMcpOAuthRegisterUrl(request),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['diagrams:read', 'diagrams:write'],
  }), { headers: oauthHeaders() });
}

export async function OPTIONS() {
  return oauthOptions();
}
