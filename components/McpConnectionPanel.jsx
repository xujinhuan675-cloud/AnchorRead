'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CircleAlert,
  Clipboard,
  KeyRound,
  LoaderCircle,
  PlugZap,
  RotateCw,
  Trash2,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { useLocale } from '@/components/LocaleProvider';
import { createDiagramAgentIdentity } from '@/lib/diagram-agent-session';

const TOKEN_ENV_NAME = 'ANCHORREAD_MCP_BEARER_TOKEN';

function formatDate(value, locale) {
  if (!value) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

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

function IconButton({ label, onClick, children, disabled = false }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-stone-200 text-stone-600 transition hover:bg-stone-50 hover:text-stone-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-white/5 dark:hover:text-white"
    >
      {children}
    </button>
  );
}

function Step({ number, title, description, children }) {
  return (
    <section className="grid gap-3 border-t border-stone-200 py-5 dark:border-stone-800 sm:grid-cols-[28px_minmax(0,1fr)]">
      <span className="inline-flex size-7 items-center justify-center rounded-full bg-stone-900 text-xs font-semibold text-white dark:bg-stone-100 dark:text-stone-900">{number}</span>
      <div className="min-w-0">
        <div className="font-medium text-stone-950 dark:text-stone-100">{title}</div>
        {description ? <p className="mt-1 text-xs leading-5 text-stone-500">{description}</p> : null}
        <div className="mt-3">{children}</div>
      </div>
    </section>
  );
}

export default function McpConnectionPanel({ isOpen, onClose, onOpenDiagrams, oauthTransaction = '' }) {
  const { locale } = useLocale();
  const zh = locale === 'zh-CN';
  const [snapshot, setSnapshot] = useState(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [diagramPage, setDiagramPage] = useState(false);
  const oauthApprovalStartedRef = useRef(false);

  const configSnippet = useMemo(() => (
    `[mcp_servers.anchor_read_diagram]\nurl = "${endpoint || 'https://<your-host>/mcp'}"\nbearer_token_env_var = "${TOKEN_ENV_NAME}"\n`
  ), [endpoint]);

  const request = useCallback(async (action, extra = {}) => {
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
        ...extra,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      const error = new Error(payload.error || `MCP pairing failed (${response.status}).`);
      error.code = payload.code;
      throw error;
    }
    return payload;
  }, []);

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!diagramPage) return;
    try {
      const payload = await request('status');
      setSnapshot(payload);
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
      setSecret('');
      setMessage(null);
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

  const createToken = () => perform('create', async () => {
    const payload = await request('create-token', { name: 'Codex' });
    setSecret(payload.token);
    setSnapshot((current) => ({ ...current, tokens: payload.tokens }));
  });

  const revokeToken = (tokenId) => perform(`revoke:${tokenId}`, async () => {
    const payload = await request('revoke-token', { tokenId });
    setSnapshot((current) => ({ ...current, tokens: payload.tokens }));
    setSecret('');
  });

  const rotateToken = (tokenId) => perform(`rotate:${tokenId}`, async () => {
    const payload = await request('rotate-token', { tokenId, name: 'Codex' });
    setSecret(payload.token);
    setSnapshot((current) => ({ ...current, tokens: payload.tokens }));
  });

  const testConnection = () => perform('test', async () => {
    const payload = await request('test');
    const count = Array.isArray(payload.result) ? payload.result.length : null;
    setMessage({
      type: 'success',
      text: zh
        ? `图解通道测试通过${count === null ? '' : `，当前工作区有 ${count} 个图解`}。`
        : `Diagram channel test passed${count === null ? '' : `; this workspace has ${count} diagram(s)`}.`,
    });
    await refresh({ quiet: true });
  });

  const approveOAuth = useCallback(() => perform('oauth-approve', async () => {
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
  }), [oauthTransaction, zh, perform]);

  useEffect(() => {
    if (!isOpen) oauthApprovalStartedRef.current = false;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !diagramPage || !oauthTransaction || oauthApprovalStartedRef.current) return undefined;
    oauthApprovalStartedRef.current = true;
    const timer = window.setTimeout(() => {
      approveOAuth().catch(() => {
        oauthApprovalStartedRef.current = false;
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [isOpen, diagramPage, oauthTransaction, approveOAuth]);

  const copy = async (key, value) => {
    try {
      await copyText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(''), 1_500);
    } catch (error) {
      setMessage({ type: 'error', text: String(error?.message || error) });
    }
  };

  const connection = snapshot?.connection;
  const connected = connection?.status === 'connected' && connection?.currentClient !== false;
  const activeTokens = (snapshot?.tokens || []).filter((token) => token.status === 'active');
  const primaryToken = activeTokens[0] || null;
  const lastUsedAt = activeTokens.reduce((latest, token) => (
    Number(token.lastUsedAt) > Number(latest || 0) ? token.lastUsedAt : latest
  ), null);
  const configured = Boolean(primaryToken);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={zh ? '连接 Codex' : 'Connect Codex'}
      maxWidth="max-w-2xl"
    >
      <div className="text-sm text-stone-700 dark:text-stone-300">
        {!diagramPage ? (
          <div className="flex flex-col items-start gap-4 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium text-stone-950 dark:text-stone-100">{zh ? '先打开图解工作区' : 'Open a diagram workspace first'}</div>
              <p className="mt-1 text-xs leading-5 text-stone-500">{zh ? 'Codex 创建和修改的图解会写入当前浏览器工作区。' : 'Diagrams created or changed by Codex are written to the current browser workspace.'}</p>
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
                <div className="font-medium text-stone-950 dark:text-stone-100">{zh ? '完成 MCP 授权' : 'Complete MCP authorization'}</div>
                <p className="mt-1 text-xs leading-5 text-stone-500">
                  {zh ? '授权后，客户端会自动保存访问令牌；当前浏览器将作为图解工作区。' : 'After approval, the client saves the access token and this browser becomes the diagram workspace.'}
                </p>
                <button type="button" disabled={!connected || Boolean(busy)} onClick={approveOAuth} className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900">
                  {busy === 'oauth-approve' ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
                  {zh ? '授权并绑定此浏览器' : 'Authorize and bind this browser'}
                </button>
              </section>
            ) : null}
            <section className="flex items-start gap-3 pb-5">
              <span className={`inline-flex size-9 shrink-0 items-center justify-center rounded-md ${connected ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}`}>
                {connected ? <Check className="size-4" /> : <CircleAlert className="size-4" />}
              </span>
              <div>
                <div className="font-medium text-stone-950 dark:text-stone-100">
                  {connected
                    ? (zh ? '图解工作区已就绪' : 'Diagram workspace is ready')
                    : (connection?.status === 'replaced'
                      ? (zh ? '另一个图解标签页正在接收连接' : 'Another diagram tab owns the connection')
                      : (zh ? '正在连接图解工作区' : 'Connecting the diagram workspace'))}
                </div>
                <p className="mt-1 text-xs leading-5 text-stone-500">
                  {connected
                    ? (zh ? '保持这个图解标签页打开，Codex 的操作会实时显示在这里。' : 'Keep this diagram tab open to see Codex changes in real time.')
                    : (zh ? '连接恢复后即可生成配置。' : 'You can generate the configuration after the connection recovers.')}
                </p>
              </div>
            </section>

            {!configured ? (
              <section className="border-t border-stone-200 py-6 text-center dark:border-stone-800">
                <KeyRound className="mx-auto size-5 text-stone-500" />
                <div className="mt-3 font-medium text-stone-950 dark:text-stone-100">{zh ? '生成 Codex 连接信息' : 'Generate Codex connection details'}</div>
                <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-stone-500">
                  {zh ? '只需生成一次。Token 默认长期有效，直到你主动撤销或重新生成。' : 'Generate once. The token remains valid until you revoke or regenerate it.'}
                </p>
                <button type="button" disabled={!connected || busy === 'create'} onClick={createToken} className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900">
                  {busy === 'create' ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                  {zh ? '生成连接信息' : 'Generate connection details'}
                </button>
              </section>
            ) : (
              <>
                <section className="flex items-center justify-between gap-4 border-t border-stone-200 py-4 dark:border-stone-800">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`size-2 shrink-0 rounded-full ${lastUsedAt ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <div className="min-w-0">
                      <div className="font-medium text-stone-950 dark:text-stone-100">{lastUsedAt ? (zh ? 'Codex 已连接' : 'Codex connected') : (zh ? '等待 Codex 首次连接' : 'Waiting for Codex')}</div>
                      <div className="mt-1 text-xs text-stone-500">
                        {lastUsedAt
                          ? `${zh ? '最近使用' : 'Last used'} ${formatDate(lastUsedAt, locale)}`
                          : (zh ? '完成下面两步并重启 Codex 后，状态会自动更新。' : 'Complete the two steps below and restart Codex; this status updates automatically.')}
                      </div>
                    </div>
                  </div>
                  <button
                      type="button"
                      disabled={!connected || Boolean(busy)}
                      onClick={testConnection}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-300 px-2.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-white/5"
                    >
                      {busy === 'test' ? <LoaderCircle className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
                      {zh ? '测试连接' : 'Test connection'}
                  </button>
                </section>

                <Step
                  number="1"
                  title={zh ? '设置 Token' : 'Set the token'}
                  description={secret
                    ? (zh ? '将下面这一行设置为 Codex 启动时可用的环境变量。Token 明文只显示这一次。' : 'Set this line as an environment variable available when Codex starts. The secret is shown only once.')
                    : (zh ? 'Token 明文已经隐藏。如尚未保存，请重新生成连接。' : 'The token secret is now hidden. Regenerate the connection if you did not save it.')}
                >
                  {secret ? (
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-stone-100 px-3 py-2 text-xs text-stone-800 dark:bg-stone-800 dark:text-stone-200">{`${TOKEN_ENV_NAME}=${secret}`}</code>
                      <IconButton label={zh ? '复制 Token 环境变量' : 'Copy token environment variable'} onClick={() => copy('token', `${TOKEN_ENV_NAME}=${secret}`)}>
                        {copied === 'token' ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                      </IconButton>
                    </div>
                  ) : (
                    <code className="text-xs text-stone-500">{primaryToken.prefix}</code>
                  )}
                </Step>

                <Step
                  number="2"
                  title={zh ? '添加 Codex 配置' : 'Add the Codex configuration'}
                  description={zh ? '复制到本地 Codex 的 config.toml 后手动合并。浏览器不会修改你的本地文件。' : 'Copy this into your local Codex config.toml and merge it manually. The browser never edits local files.'}
                >
                  <div className="flex items-start gap-2">
                    <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-stone-950 p-3 text-xs leading-5 text-stone-100"><code>{configSnippet}</code></pre>
                    <IconButton label={zh ? '复制配置' : 'Copy configuration'} onClick={() => copy('config', configSnippet)}>
                      {copied === 'config' ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                    </IconButton>
                  </div>
                </Step>

                <section className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-5 dark:border-stone-800">
                  <div className="text-xs text-stone-500">{zh ? '重新生成会立即停用当前 Token。' : 'Regenerating immediately disables the current token.'}</div>
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={!connected || Boolean(busy)} onClick={() => rotateToken(primaryToken.id)} className="inline-flex h-8 items-center gap-2 rounded-md border border-stone-300 px-3 text-xs font-medium text-stone-800 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-white/5">
                      {busy === `rotate:${primaryToken.id}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
                      {zh ? '重新生成连接' : 'Regenerate'}
                    </button>
                    <button type="button" disabled={Boolean(busy)} onClick={() => revokeToken(primaryToken.id)} className="inline-flex h-8 items-center gap-2 rounded-md border border-red-200 px-3 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/50">
                      <Trash2 className="size-3.5" />
                      {zh ? '撤销连接' : 'Revoke'}
                    </button>
                  </div>
                </section>

                {activeTokens.length > 1 ? (
                  <details className="mt-5 border-t border-stone-200 pt-4 text-xs dark:border-stone-800">
                    <summary className="cursor-pointer text-stone-600 dark:text-stone-400">{zh ? `管理其他连接（${activeTokens.length - 1}）` : `Manage other connections (${activeTokens.length - 1})`}</summary>
                    <div className="mt-2 divide-y divide-stone-200 dark:divide-stone-800">
                      {activeTokens.slice(1).map((token) => (
                        <div key={token.id} className="flex items-center gap-3 py-3">
                          <code className="min-w-0 flex-1 truncate text-stone-500">{token.prefix}</code>
                          <span className="text-stone-500">{token.lastUsedAt ? formatDate(token.lastUsedAt, locale) : (zh ? '未使用' : 'Unused')}</span>
                          <IconButton label={zh ? '撤销连接' : 'Revoke connection'} onClick={() => revokeToken(token.id)} disabled={Boolean(busy)}>
                            <Trash2 className="size-4" />
                          </IconButton>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </>
            )}
          </>
        )}

        {message ? (
          <div className="mt-5 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{message.text}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
