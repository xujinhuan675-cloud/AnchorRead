import { NextResponse } from 'next/server';
import { callLLM } from '@/lib/llm-client';
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } from '@/lib/prompts';
import {
  MERMAID_SYSTEM_PROMPT,
  buildMermaidUserPrompt,
} from '@/lib/mermaid-prompts';
import { apiErrorResponse, createErrorId, reportApiError, withApiObservability } from '@/lib/api-observability';

/**
 * POST /api/generate
 * Generate Excalidraw code based on user input
 */
async function handlePOST(request) {
  const errorId = createErrorId();
  try {
    const { config, userInput, chartType, engine = 'excalidraw' } = await request.json();
    const accessPassword = request.headers.get('x-access-password');

    // Check if using server-side config with access password
    let finalConfig = config;
    if (accessPassword) {
      const envPassword = process.env.ACCESS_PASSWORD;
      if (!envPassword) {
        return NextResponse.json(
          { error: '服务器未配置访问密码' },
          { status: 400 }
        );
      }
      if (accessPassword !== envPassword) {
        return NextResponse.json(
          { error: '访问密码错误' },
          { status: 401 }
        );
      }
      // Use server-side config
      finalConfig = {
        type: process.env.SERVER_LLM_TYPE,
        baseUrl: process.env.SERVER_LLM_BASE_URL,
        apiKey: process.env.SERVER_LLM_API_KEY,
        model: process.env.SERVER_LLM_MODEL,
      };
      if (!finalConfig.type || !finalConfig.apiKey) {
        return NextResponse.json(
          { error: '服务器LLM配置不完整' },
          { status: 500 }
        );
      }
    } else if (!config || !userInput) {
      return NextResponse.json(
        { error: 'Missing required parameters: config, userInput' },
        { status: 400 }
      );
    }

    if (!['excalidraw', 'mermaid'].includes(engine)) {
      return NextResponse.json(
        { error: 'Unsupported drawing engine' },
        { status: 400 }
      );
    }

    const buildUserPrompt = engine === 'mermaid'
      ? buildMermaidUserPrompt
      : USER_PROMPT_TEMPLATE;

    // Build messages array
    let userMessage;

    // Handle different input types
    if (typeof userInput === 'object' && userInput.image) {
      // Image input with text and image data
      const { text, image } = userInput;
      userMessage = {
        role: 'user',
        content: buildUserPrompt(text, chartType),
        image: {
          data: image.data,
          mimeType: image.mimeType
        }
      };
    } else {
      // Regular text input
      userMessage = {
        role: 'user',
        content: buildUserPrompt(userInput, chartType)
      };
    }

    const fullMessages = [
      {
        role: 'system',
        content: engine === 'mermaid' ? MERMAID_SYSTEM_PROMPT : SYSTEM_PROMPT,
      },
      userMessage
    ];

    // Create a readable stream for SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await callLLM(finalConfig, fullMessages, (chunk) => {
            // Send each chunk as SSE
            const data = `data: ${JSON.stringify({ content: chunk })}\n\n`;
            controller.enqueue(encoder.encode(data));
          });

          // Send done signal
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          reportApiError({
            request,
            operation: 'ai.generate.stream',
            error,
            errorId,
            status: 502,
            context: { engine },
          });
          const errorData = `data: ${JSON.stringify({ error: error.message, errorId })}\n\n`;
          controller.enqueue(encoder.encode(errorData));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    return apiErrorResponse({ request, operation: 'ai.generate', error, errorId, status: 500, message: error.message || 'Failed to generate code' });
  }
}

export const POST = withApiObservability('ai.generate', handlePOST);

