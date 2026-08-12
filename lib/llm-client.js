/**
 * LLM Client for calling OpenAI and Anthropic APIs
 */

/**
 * Call LLM API with streaming support
 * @param {Object} config - Provider configuration
 * @param {Array} messages - Chat messages array
 * @param {Function} onChunk - Callback for each chunk
 * @returns {Promise<string>} Complete response
 */
export async function callLLM(config, messages, onChunk) {
  const { type, baseUrl, apiKey, model } = config;

  if (type === 'openai') {
    return callOpenAI(baseUrl, apiKey, model, messages, onChunk);
  } else if (type === 'anthropic') {
    return callAnthropic(baseUrl, apiKey, model, messages, onChunk);
  } else {
    throw new Error(`Unsupported provider type: ${type}`);
  }
}

/**
 * Call OpenAI-compatible API
 */
async function callOpenAI(baseUrl, apiKey, model, messages, onChunk) {
  const shouldStream = typeof onChunk === 'function';
  const urls = buildOpenAIUrls(baseUrl);

  // Process messages to support multimodal content (text + images)
  const processedMessages = messages.map(processMessageForOpenAI);

  const request = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: processedMessages,
      stream: shouldStream,
      // max_tokens: 64000,
    }),
  };

  let response;
  for (const [index, url] of urls.entries()) {
    response = await fetch(url, request);
    const contentType = response.headers.get('content-type') || '';
    const shouldTryNext =
      index < urls.length - 1 &&
      (response.status === 404 || contentType.includes('text/html'));

    if (!shouldTryNext) break;
    await response.body?.cancel();
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${error}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error('OpenAI API 地址返回了网页，请检查 Base URL 是否包含 /v1');
  }
  if (contentType.includes('application/json')) {
    const payload = await response.json();
    const upstreamError = extractResponseError(payload);
    if (upstreamError) throw new Error(`OpenAI API error: ${upstreamError}`);

    const content = extractResponseText(payload);
    if (!content) {
      throw new Error('OpenAI 接口返回成功，但响应中没有可识别的文本内容');
    }
    onChunk?.(content);
    return content;
  }

  if (!response.body) {
    throw new Error('OpenAI 接口返回成功，但响应体为空');
  }

  return processOpenAIStream(response.body, onChunk);
}

function buildOpenAIUrls(baseUrl) {
  const normalized = String(baseUrl || '').replace(/\/+$/, '');
  const primary = `${normalized}/chat/completions`;
  if (/\/v\d+(?:\/|$)/i.test(normalized)) return [primary];
  return [primary, `${normalized}/v1/chat/completions`];
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.text?.value === 'string') return content.text.value;
    if (typeof content.value === 'string') return content.value;
    return '';
  }
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.text?.value === 'string') return part.text.value;
      if (typeof part.value === 'string') return part.value;
      return '';
    })
    .join('');
}

/** Extract a complete answer from common OpenAI-compatible JSON shapes. */
export function extractResponseText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.output_text === 'string') return payload.output_text;

  const choice = payload.choices?.[0];
  const choiceContent = textFromContent(choice?.message?.content);
  if (choiceContent) return choiceContent;
  if (typeof choice?.text === 'string') return choice.text;

  const reasoningContent = textFromContent(
    choice?.message?.reasoning_content || choice?.message?.reasoning
  );
  if (reasoningContent) return reasoningContent;

  const directContent = textFromContent(payload.content);
  if (directContent) return directContent;

  const messageContent = textFromContent(payload.message?.content);
  if (messageContent) return messageContent;
  if (typeof payload.response === 'string') return payload.response;

  const responseOutput = payload.response?.output || payload.output;
  if (Array.isArray(responseOutput)) {
    const outputText = responseOutput
      .map((item) => textFromContent(item?.content))
      .join('');
    if (outputText) return outputText;
  }

  const candidateParts = payload.candidates?.[0]?.content?.parts;
  const candidateText = textFromContent(candidateParts);
  if (candidateText) return candidateText;

  if (
    typeof payload.text === 'string' &&
    /output_text\.(done|delta)/.test(payload.type || '')
  ) {
    return payload.text;
  }

  return '';
}

/** Extract only incremental text so completed events are not appended twice. */
export function extractResponseDelta(payload, eventName = '') {
  if (!payload || typeof payload !== 'object') return '';

  const chatDelta = textFromContent(payload.choices?.[0]?.delta?.content);
  if (chatDelta) return chatDelta;

  if (typeof payload.choices?.[0]?.delta?.text === 'string') {
    return payload.choices[0].delta.text;
  }

  const messageDelta = textFromContent(payload.message?.content);
  if (messageDelta && typeof payload.done === 'boolean') return messageDelta;
  if (typeof payload.response === 'string' && typeof payload.done === 'boolean') {
    return payload.response;
  }

  const eventType = payload.type || eventName;
  if (
    typeof payload.delta === 'string' &&
    /(^|\.)output_text\.delta$/.test(eventType)
  ) {
    return payload.delta;
  }

  if (
    eventType === 'content_block_delta' &&
    typeof payload.delta?.text === 'string'
  ) {
    return payload.delta.text;
  }

  return '';
}

function extractReasoningDelta(payload) {
  const delta = payload?.choices?.[0]?.delta;
  if (!delta || typeof delta !== 'object') return '';
  return textFromContent(delta.reasoning_content || delta.reasoning);
}

function extractResponseError(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const error = payload.error || payload.response?.error;
  if (typeof error === 'string') return error;
  if (typeof error?.message === 'string') return error.message;
  if (payload.type === 'error' && typeof payload.message === 'string') {
    return payload.message;
  }
  return '';
}

/**
 * Process OpenAI streaming response
 */
export async function processOpenAIStream(body, onChunk) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let finalText = '';
  let reasoningText = '';
  let buffer = '';
  let rawBody = '';
  let eventName = '';
  const eventTypes = new Set();

  const processPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.type) eventTypes.add(payload.type);
    const deltaKeys = Object.keys(payload.choices?.[0]?.delta || {});
    if (deltaKeys.length > 0) {
      eventTypes.add(`chat.delta[${deltaKeys.slice(0, 5).join(',')}]`);
    }
    const upstreamError = extractResponseError(payload);
    if (upstreamError) throw new Error(`OpenAI API error: ${upstreamError}`);

    const delta = extractResponseDelta(payload, eventName);
    if (delta) {
      fullText += delta;
      onChunk?.(delta);
      return;
    }

    const reasoningDelta = extractReasoningDelta(payload);
    if (reasoningDelta) reasoningText += reasoningDelta;

    const complete = extractResponseText(payload);
    if (complete) finalText = complete;
  };

  const processLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      eventName = '';
      return;
    }

    if (trimmed.startsWith('event:')) {
      eventName = trimmed.slice(6).trim();
      if (eventName) eventTypes.add(eventName);
      return;
    }

    const dataMatch = trimmed.match(/^data:\s*(.*)$/);
    const data = dataMatch ? dataMatch[1].trim() : trimmed;
    if (!data || data === '[DONE]') return;

    try {
      processPayload(JSON.parse(data));
    } catch (error) {
      if (error.message?.startsWith('OpenAI API error:')) throw error;
      // Pretty-printed JSON is handled by the complete-body fallback below.
    }
  };

  const processBufferedLines = (flush = false) => {
    const lines = buffer.split(/\r?\n/);
    buffer = flush ? '' : lines.pop() || '';
    for (const line of lines) processLine(line);
    if (flush && buffer) processLine(buffer);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const decoded = decoder.decode(value, { stream: true });
      rawBody += decoded;
      buffer += decoded;
      processBufferedLines();
    }

    const decodedTail = decoder.decode();
    rawBody += decodedTail;
    buffer += decodedTail;
    processBufferedLines(true);
  } finally {
    reader.releaseLock();
  }

  const streamedText = fullText || finalText || reasoningText;
  if (streamedText) {
    if (!fullText) onChunk?.(streamedText);
    return streamedText;
  }

  // Some compatible providers return JSON while declaring an SSE content type.
  try {
    const payload = JSON.parse(rawBody.trim());
    const upstreamError = extractResponseError(payload);
    if (upstreamError) throw new Error(`OpenAI API error: ${upstreamError}`);
    const jsonText = extractResponseText(payload);
    if (jsonText) {
      onChunk?.(jsonText);
      return jsonText;
    }
  } catch (error) {
    if (error.message?.startsWith('OpenAI API error:')) throw error;
  }

  const eventSummary = [...eventTypes].slice(0, 5).join(', ');
  throw new Error(
    eventSummary
      ? `OpenAI 接口返回成功，但未识别到文本内容（事件：${eventSummary}）`
      : 'OpenAI 接口返回成功，但未识别到文本内容'
  );
}

/**
 * Call Anthropic API
 */
async function callAnthropic(baseUrl, apiKey, model, messages, onChunk) {
  const url = `${baseUrl}/messages`;

  // Convert messages format for Anthropic with multimodal support
  const systemMessage = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');
  const processedMessages = chatMessages.map(processMessageForAnthropic);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model,
      messages: processedMessages,
      system: systemMessage ? [{ type: 'text', text: systemMessage.content }] : undefined,
      max_tokens: 64000,
      stream: true,
      temperature: 1,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${error}`);
  }

  return processAnthropicStream(response.body, onChunk);
}

/**
 * Process Anthropic streaming response
 */
async function processAnthropicStream(body, onChunk) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        
        try {
          const json = JSON.parse(trimmed.slice(6));
          
          if (json.type === 'content_block_delta') {
            const content = json.delta?.text;
            if (content) {
              fullText += content;
              if (onChunk) onChunk(content);
            }
          }
        } catch (e) {
          console.error('Failed to parse SSE:', e);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullText;
}

/**
 * Process message for OpenAI API with multimodal support
 * @param {Object} message - Message object
 * @returns {Object} Processed message for OpenAI
 */
function processMessageForOpenAI(message) {
  // If message doesn't have image data, return as-is
  if (!message.image) {
    return message;
  }

  // Process message with image
  const { image, content } = message;

  return {
    role: message.role,
    content: [
      {
        type: 'text',
        text: content
      },
      {
        type: 'image_url',
        image_url: {
          url: `data:${image.mimeType};base64,${image.data}`,
          detail: 'high'
        }
      }
    ]
  };
}

/**
 * Process message for Anthropic API with multimodal support
 * @param {Object} message - Message object
 * @returns {Object} Processed message for Anthropic
 */
function processMessageForAnthropic(message) {
  // If message doesn't have image data, return as-is
  if (!message.image) {
    return message;
  }

  // Process message with image
  const { image, content } = message;

  return {
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: [
      {
        type: 'text',
        text: content
      },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mimeType,
          data: image.data
        }
      }
    ]
  };
}

/**
 * Test configuration connection with a simple API call
 * @param {Object} config - Provider configuration
 * @returns {Promise<Object>} Test result with success status and message
 */
export async function testConnection(config) {
  const { type, baseUrl, apiKey } = config;

  try {
    // Try to fetch models as a simple connection test
    const models = await fetchModels(type, baseUrl, apiKey);

    if (models && models.length > 0) {
      return {
        success: true,
        message: `连接成功，找到 ${models.length} 个可用模型`,
        models: models.slice(0, 5) // Return first 5 models for preview
      };
    } else {
      return {
        success: false,
        message: '连接成功但未找到可用模型'
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `连接失败: ${error.message}`
    };
  }
}

/**
 * Fetch available models from provider
 * @param {string} type - Provider type
 * @param {string} baseUrl - API base URL
 * @param {string} apiKey - API key
 * @returns {Promise<Array>} List of available models
 */
export async function fetchModels(type, baseUrl, apiKey) {
  if (type === 'openai') {
    const url = `${baseUrl}/models`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }

    const data = await response.json();
    return (Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [])
      .map(model => ({
        id: typeof model === 'string' ? model : (model.id || model.name || model.model || model.slug),
        name: typeof model === 'string' ? model : (model.name || model.id || model.model || model.slug),
      }))
      .filter(m => m.id);
  } else if (type === 'anthropic') {
    // Request actual models from provider like OpenAI, but with Anthropic headers
    const url = `${baseUrl}/models`;
    const response = await fetch(url, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }

    const data = await response.json();
    return (Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [])
      .map(model => ({
        id: typeof model === 'string' ? model : (model.id || model.name || model.model || model.slug),
        name: typeof model === 'string' ? model : (model.name || model.id || model.model || model.slug),
      }))
      .filter(m => m.id);
  } else {
    throw new Error(`Unsupported provider type: ${type}`);
  }
}

