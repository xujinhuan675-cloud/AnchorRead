'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  CircleAlert,
  Clipboard,
  LoaderCircle,
  PlugZap,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { useLocale } from '@/components/LocaleProvider';
import { createDiagramAgentIdentity } from '@/lib/diagram-agent-session';

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const area = document.createElement('textarea');
  area.value = value;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

export default function McpConnectionPanel({ isOpen, onClose, onOpenDiagrams, oauthTransaction = '' }) {
  const { locale } = useLocale();
  const zh = locale === 'zh-CN';
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [diagramPage, setDiagramPage] = useState(false);
  // OAuth approval is an explicit user action. Keep a local guard because a
  // double click or a delayed browser event must not consume the one-shot
  // transaction twice.
  const oauthApprovalInFlightRef = useRef(false);

  const request = useCallback(async (action) => {
    const identity = createDiagramAgentIdentity();
    const response = await fetch('/api/mcp/pairing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AnchorRead-Session-Secret': identity.managementSecret,
      },
      cache: 'no-store',
      body: JSON.stringify({
        action,
        workspaceId: identity.workspaceId,
        browserSessionId: identity.browserSessionId,
        tabId: identity.tabId,
        clientId: identity.clientId,
        href: window.location.href,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      const error = new Error(payload.error || `MCP connection failed (${response.status}).`);
      error.code = payload.code;
      throw error;
    }
    return payload;
  }, []);

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!diagramPage) return;
    try {
      setSnapshot(await request('status'));
      if (!quiet) setMessage(null);
    } catch (error) {
      setSnapshot((current) => ({
        ...(current || {}),
        connection: { status: error.code === 'CONNECTION_REPLACED' ? 'replaced' : 'disconnected', connected: false },
      }));
      if (!quiet) setMessage({ type: 'error', text: String(error.message || error) });
    }
  }, [diagramPage, request]);

  useEffect(() => {
    if (!isOpen) {
      setMessage(null);
      setCopied(false);
      return undefined;
    }
    const onDiagramPage = /^\/diagrams(?:\/|$)/u.test(window.location.pathname);
    setEndpoint(`${window.location.origin}/mcp`);
    setDiagramPage(onDiagramPage);
    if (!onDiagramPage) {
      setSnapshot(null);
      return undefined;
    }
    const onBridgeConnection = (event) => {
      const connection = event.detail;
      if (!connection || typeof connection !== 'object') return;
      setSnapshot((current) => ({ ...(current || {}), connection }));
    };
    window.addEventListener('anchor-read:diagram-agent-connection', onBridgeConnection);
    const initial = window.setTimeout(() => refresh(), 100);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener('anchor-read:diagram-agent-connection', onBridgeConnection);
    };
  }, [isOpen, refresh]);

  const perform = useCallback(async (name, action) => {
    setBusy(name);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({ type: 'error', text: String(error?.message || error) });
    } finally {
      setBusy('');
    }
  }, []);

  const testConnection = () => perform('test', async () => {
    const payload = await request('test');
    const count = Array.isArray(payload.result) ? payload.result.length : null;
    setMessage({
      type: 'success',
      text: zh
        ? `连接正常${count === null ? '' : `，当前有 ${count} 个图解`}。`
        : `Connection is ready${count === null ? '' : ` with ${count} diagram(s)`}.`,
    });
    await refresh({ quiet: true });
  });

  const approveOAuth = useCallback(() => {
    if (oauthApprovalInFlightRef.current) return Promise.resolve();
    oauthApprovalInFlightRef.current = true;
    return perform('oauth-approve', async () => {
      if (!oauthTransaction) throw new Error(zh ? '授权请求已过期，请从 MCP 客户端重新连接。' : 'The authorization request expired. Reconnect from the MCP client.');
      const identity = createDiagramAgentIdentity();
      const response = await fetch('/api/mcp/oauth/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AnchorRead-Session-Secret': identity.managementSecret,
        },
        cache: 'no-store',
        body: JSON.stringify({
          transaction: oauthTransaction,
          workspaceId: identity.workspaceId,
          browserSessionId: identity.browserSessionId,
          tabId: identity.tabId,
          clientId: identity.clientId,
          href: window.location.href,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok || !payload.redirectUrl) {
        const error = new Error(payload.error || `OAuth approval failed (${response.status}).`);
        error.code = payload.code;
        throw error;
      }
      window.location.assign(payload.redirectUrl);
    }).finally(() => {
      oauthApprovalInFlightRef.current = false;
    });
  }, [oauthTransaction, zh, perform]);

  const copyEndpoint = async () => {
    try {
      await copyText(endpoint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch (error) {
      setMessage({ type: 'error', text: String(error?.message || error) });
    }
  };

  const connection = snapshot?.connection;
  const connected = connection?.status === 'connected' && connection?.currentClient !== false;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={zh ? '连接 MCP' : 'Connect MCP'}
      maxWidth="max-w-xl"
    >
      <div className="text-sm text-stone-700 dark:text-stone-300">
        {!diagramPage ? (
          <div className="flex flex-col items-start gap-4 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium text-stone-950 dark:text-stone-100">{zh ? '先打开图解页' : 'Open diagrams first'}</div>
              <p className="mt-1 text-xs leading-5 text-stone-500">{zh ? '授权会把 MCP 连接到当前浏览器中的图解页。' : 'Authorization connects MCP to the diagrams open in this browser.'}</p>
            </div>
            <button type="button" onClick={() => { onClose(); onOpenDiagrams?.(); }} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-stone-900 px-4 text-xs font-medium text-white dark:bg-stone-100 dark:text-stone-900">
              <PlugZap className="size-4" />
              {zh ? '打开图解库' : 'Open diagrams'}
            </button>
          </div>
        ) : (
          <>
            {oauthTransaction ? (
              <section className="border-b border-stone-200 pb-5 dark:border-stone-800">
                <div className="font-medium text-stone-950 dark:text-stone-100">{zh ? '等待确认 OAuth 授权' : 'Confirm OAuth authorization'}</div>
                <p className="mt-1 text-xs leading-5 text-stone-500">
                  {zh ? '授权成功后会自动返回 MCP 客户端。' : 'After approval, you will return to the MCP client automatically.'}
                </p>
                <button type="button" disabled={!connected || Boolean(busy)} onClick={approveOAuth} className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900">
                  {busy === 'oauth-approve' ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
                  {zh ? '允许连接' : 'Allow connection'}
                </button>
              </section>
            ) : null}

            <section className="flex items-start gap-3 py-5">
              <span className={`inline-flex size-9 shrink-0 items-center justify-center rounded-md ${connected ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}`}>
                {connected ? <Check className="size-4" /> : <CircleAlert className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-stone-950 dark:text-stone-100">
                  {connected
                    ? (zh ? '当前图解页已就绪' : 'This diagrams page is ready')
                    : (connection?.status === 'replaced'
                      ? (zh ? '另一个图解标签页正在接收连接' : 'Another diagrams tab owns the connection')
                      : (zh ? '正在连接当前图解页' : 'Connecting this diagrams page'))}
                </div>
                <p className="mt-1 text-xs leading-5 text-stone-500">
                  {zh ? '保持此标签页打开，MCP 操作会实时显示在这里。' : 'Keep this tab open to receive MCP operations.'}
                </p>
              </div>
              <button type="button" disabled={!connected || Boolean(busy)} onClick={testConnection} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-stone-300 px-2.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-white/5">
                {busy === 'test' ? <LoaderCircle className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
                {zh ? '测试' : 'Test'}
              </button>
            </section>

            {!oauthTransaction ? (
              <section className="border-t border-stone-200 pt-5 dark:border-stone-800">
                <div className="font-medium text-stone-950 dark:text-stone-100">{zh ? 'MCP 地址' : 'MCP endpoint'}</div>
                <div className="mt-3 flex items-center gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-stone-100 px-3 py-2 text-xs text-stone-800 dark:bg-stone-800 dark:text-stone-200">{endpoint}</code>
                  <button type="button" title={zh ? '复制 MCP 地址' : 'Copy MCP endpoint'} aria-label={zh ? '复制 MCP 地址' : 'Copy MCP endpoint'} onClick={copyEndpoint} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-stone-200 text-stone-600 transition hover:bg-stone-50 hover:text-stone-950 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-white/5 dark:hover:text-white">
                    {copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                  </button>
                </div>
                <p className="mt-2 text-xs leading-5 text-stone-500">
                  {zh ? '客户端添加此地址后会自动打开浏览器授权，不需要配置 Token。' : 'Adding this endpoint opens browser authorization automatically; no token setup is required.'}
                </p>
              </section>
            ) : null}
          </>
        )}

        {message ? (
          <div className={`mt-5 flex items-start gap-2 rounded-md px-3 py-2 text-xs ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'}`}>
            {message.type === 'success' ? <Check className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}
            <span>{message.text}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
