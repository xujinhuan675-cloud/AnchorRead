#!/usr/bin/env node
/**
 * Local AnchorRead workspace bootstrap MCP.
 *
 * The hosted AnchorRead MCP owns OAuth and browser-paired diagram operations.
 * This deliberately small local companion has one responsibility that an
 * HTTP server cannot perform: hand the workspace URL to the user's default
 * desktop browser before the hosted MCP submits a persisted operation.
 */

import { buildDiagramWorkspaceUrl, createMcpToolResult } from '../lib/diagram-mcp-links.js';
import { openDiagramUrl } from '../lib/diagram-mcp-browser-launch.js';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = {
  name: 'anchorread-browser-bootstrap',
  title: 'AnchorRead Browser Bootstrap',
  version: '1.0.0',
};
const TOOLS = [{
  name: 'ensure_anchorread_workspace',
  description: 'Best-effort open the AnchorRead diagram workspace in the local operating system default browser. This does not authenticate, grant permission, or claim that the browser pairing is online.',
  annotations: { readOnlyHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      open: { type: 'boolean', description: 'Open the workspace through the operating system. Defaults to true.' },
    },
    additionalProperties: false,
  },
}];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function ensureWorkspace(arguments_ = {}) {
  const url = buildDiagramWorkspaceUrl();
  const shouldOpen = arguments_?.open !== false;
  const launch = shouldOpen
    ? openDiagramUrl(url)
    : { opened: false, code: 'OPEN_NOT_REQUESTED', url };
  return createMcpToolResult({
    ready: false,
    readiness: 'browser_connection_pending',
    mode: 'local_browser_bootstrap',
    url,
    ...launch,
    openRequested: shouldOpen,
    openAction: launch.opened ? 'opened_by_local_companion' : 'open_url_if_supported',
    openTarget: 'default_browser',
    openResource: { kind: 'workspace', url },
    nextAction: launch.opened
      ? 'verify_browser_connection_with_anchor_read_diagram'
      : 'open_diagram_workspace_then_verify',
  });
}

function handleRequest(request) {
  const { id, method, params } = request || {};
  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: 'Use ensure_anchorread_workspace before a persisted AnchorRead diagram workflow. The result only confirms a local browser-open request; verify the hosted browser pairing before writing diagrams.',
      },
    });
  }
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    if (params?.name !== 'ensure_anchorread_workspace') {
      return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${params?.name || ''}` } });
    }
    return send({ jsonrpc: '2.0', id, result: ensureWorkspace(params.arguments) });
  }
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unsupported method: ${method || ''}` } });
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
    try {
      const request = JSON.parse(line);
      if (request.id !== undefined && request.id !== null) handleRequest(request);
    } catch {
      // Ignore malformed JSON-RPC frames and keep the stdio connection alive.
    }
  }
});
