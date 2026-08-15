#!/usr/bin/env node
/**
 * AnchorRead MCP Server（零依赖，stdio 传输）
 *
 * 让 Claude Desktop / Qoder 等 MCP 客户端读取 AnchorRead 导出的
 * `.anchorread` 工作区文件（文档、解读、术语、闪卡）。
 *
 * 用法：
 *   node mcp/anchor-read-mcp.mjs <workspace-file.anchorread>
 * 或通过环境变量：
 *   ANCHORREAD_WORKSPACE_FILE=<path> node mcp/anchor-read-mcp.mjs
 *
 * MCP 客户端配置示例（Claude Desktop / claude_desktop_config.json）：
 * {
 *   "mcpServers": {
 *     "anchor-read": {
 *       "command": "node",
 *       "args": ["F:/AnchorOS/6-项目仓库/AnchorRead/mcp/anchor-read-mcp.mjs",
 *                "F:/path/to/anchor-read-workspace.anchorread"]
 *     }
 *   }
 * }
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseWorkspaceFile } from '../lib/workspace-file.js';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'anchor-read-mcp', version: '0.1.0' };

const workspacePath = resolve(process.argv[2] || process.env.ANCHORREAD_WORKSPACE_FILE || '');

let cachedWorkspace = null;
let cachedMtimeKey = '';

async function loadWorkspace() {
  if (!workspacePath) {
    throw new Error('未指定工作区文件。请通过命令行参数或 ANCHORREAD_WORKSPACE_FILE 环境变量提供 .anchorread 文件路径。');
  }
  const raw = await readFile(workspacePath, 'utf8');
  const payload = parseWorkspaceFile(raw);
  cachedWorkspace = payload;
  return payload;
}

async function getWorkspace() {
  if (!cachedWorkspace) await loadWorkspace();
  return cachedWorkspace;
}

function summarize(record) {
  if (!record || typeof record !== 'object') return record;
  const copy = { ...record };
  if (typeof copy.content === 'string' && copy.content.length > 200) {
    copy.contentPreview = `${copy.content.slice(0, 200)}...`;
    delete copy.content;
  }
  return copy;
}

const TOOLS = [
  {
    name: 'workspace_summary',
    description: '返回 AnchorRead 工作区概览：各存储区的记录数量与导出时间。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_documents',
    description: '列出工作区中所有已导入文档（id、标题、来源类型、更新时间）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_document',
    description: '按 id 获取单个文档的完整正文（Markdown）。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '文档 id' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_terms',
    description: '列出工作区中积累的术语及其解释。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_flashcards',
    description: '列出工作区中的记忆闪卡（front/back）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_workspace',
    description: '在工作区文档正文、术语、闪卡中进行关键词全文搜索，返回命中片段。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        limit: { type: 'number', description: '最大返回条数，默认 20' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

function textResult(value) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  };
}

async function callTool(name, args = {}) {
  const workspace = await getWorkspace();
  const data = workspace.data || {};

  switch (name) {
    case 'workspace_summary': {
      const counts = {};
      for (const [key, value] of Object.entries(data)) {
        counts[key] = Array.isArray(value) ? value.length : 0;
      }
      return textResult({
        file: workspacePath,
        version: workspace.version,
        exportedAt: workspace.exportedAt ? new Date(workspace.exportedAt).toISOString() : null,
        counts,
      });
    }
    case 'list_documents':
      return textResult((data.documents || []).map((doc) => ({
        id: doc.id,
        title: doc.title,
        sourceType: doc.sourceType,
        importSource: doc.importSource,
        contentLength: typeof doc.content === 'string' ? doc.content.length : 0,
        updatedAt: doc.updatedAt ?? doc.createdAt ?? null,
      })));
    case 'get_document': {
      const doc = (data.documents || []).find((item) => item.id === args.id);
      if (!doc) throw new Error(`未找到 id 为 ${args.id} 的文档。`);
      return textResult(doc);
    }
    case 'list_terms':
      return textResult((data.terms || []).map(summarize));
    case 'list_flashcards':
      return textResult((data.flashcards || []).map(summarize));
    case 'search_workspace': {
      const query = String(args.query || '').toLowerCase();
      if (!query) throw new Error('搜索关键词不能为空。');
      const limit = Number.isFinite(args.limit) ? Math.max(1, args.limit) : 20;
      const hits = [];
      const pushHit = (kind, id, label, text) => {
        const index = String(text || '').toLowerCase().indexOf(query);
        if (index === -1) return;
        hits.push({
          kind,
          id,
          label,
          snippet: String(text).slice(Math.max(0, index - 60), index + query.length + 120),
        });
      };
      for (const doc of data.documents || []) pushHit('document', doc.id, doc.title, doc.content);
      for (const term of data.terms || []) pushHit('term', term.id, term.source || term.term, term.explanation);
      for (const card of data.flashcards || []) pushHit('flashcard', card.id, card.front, `${card.front} ${card.back}`);
      return textResult(hits.slice(0, limit));
    }
    default:
      throw new Error(`未知工具：${name}`);
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleRequest(request) {
  const { id, method, params } = request;
  try {
    switch (method) {
      case 'initialize':
        return send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        });
      case 'tools/list':
        return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      case 'tools/call': {
        const result = await callTool(params?.name, params?.arguments);
        return send({ jsonrpc: '2.0', id, result });
      }
      case 'ping':
        return send({ jsonrpc: '2.0', id, result: {} });
      default:
        return send({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `方法不支持：${method}` },
        });
    }
  } catch (error) {
    if (method === 'tools/call') {
      return send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: String(error?.message || error) }], isError: true },
      });
    }
    return send({ jsonrpc: '2.0', id, error: { code: -32000, message: String(error?.message || error) } });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      continue;
    }
    // notifications（无 id）直接忽略处理，如 notifications/initialized
    if (request.id === undefined || request.id === null) continue;
    handleRequest(request);
  }
});
process.stdin.on('end', () => process.exit(0));
