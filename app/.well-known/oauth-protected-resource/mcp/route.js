import { getDiagramMcpOAuthAuthorizationUrl, getDiagramMcpResourceUrl } from '@/lib/diagram-mcp-authorization';
import { oauthHeaders, oauthOptions, requestOrigin } from '@/lib/diagram-mcp-oauth-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return new Response(JSON.stringify({
    resource: getDiagramMcpResourceUrl(request),
    authorization_servers: [requestOrigin(request)],
    scopes_supported: ['diagrams:read', 'diagrams:write'],
    bearer_methods_supported: ['header'],
    authorization_endpoint: getDiagramMcpOAuthAuthorizationUrl(request),
  }), { headers: oauthHeaders() });
}

export async function OPTIONS() {
  return oauthOptions();
}
