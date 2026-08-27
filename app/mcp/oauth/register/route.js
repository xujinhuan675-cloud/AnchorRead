import { getDiagramMcpOAuthStore } from '@/lib/diagram-mcp-oauth';
import { oauthErrorResponse, oauthJson, oauthOptions } from '@/lib/diagram-mcp-oauth-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const body = await request.json();
    const client = getDiagramMcpOAuthStore().registerClient({
      redirectUris: body?.redirect_uris,
      clientName: body?.client_name,
    });
    return oauthJson({
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      client_id_issued_at: Math.floor(client.createdAt / 1000),
      token_endpoint_auth_method: 'none',
    }, { status: 201 });
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

export async function OPTIONS() {
  return oauthOptions();
}
