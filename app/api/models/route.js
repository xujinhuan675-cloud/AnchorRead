import { NextResponse } from 'next/server';
import { fetchModels } from '@/lib/llm-client';
import { apiErrorResponse, withApiObservability } from '@/lib/api-observability';

/**
 * GET /api/models
 * Fetch available models from the configured provider
 */
async function handleGET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const baseUrl = searchParams.get('baseUrl');
    const apiKey = searchParams.get('apiKey');

    if (!type || !baseUrl || !apiKey) {
      return NextResponse.json(
        { error: 'Missing required parameters: type, baseUrl, apiKey' },
        { status: 400 }
      );
    }

    const models = await fetchModels(type, baseUrl, apiKey);

    return NextResponse.json({ models });
  } catch (error) {
    return apiErrorResponse({ request, operation: 'llm.models', error, status: 500, message: error.message || 'Failed to fetch models' });
  }
}

export const GET = withApiObservability('llm.models', handleGET);

