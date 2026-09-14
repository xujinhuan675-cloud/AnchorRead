'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  CircleAlert,
  Clipboard,
  Eye,
  LoaderCircle,
  PlugZap,
  ShieldOff,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { useLocale } from '@/components/LocaleProvider';
import { createDiagramAgentIdentity } from '@/lib/diagram-agent-session';
import {
  getDiagramMcpCodexOAuthSetup,
  getDiagramMcpCodexPersonalTokenConfig,
} from '@/lib/diagram-mcp-authorization';

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
  const [copiedOAuthSetup, setCopiedOAuthSetup] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [diagramPage, setDiagramPage] = useState(false);
  const [authorizations, setAuthorizations] = useState(null);
  const [personalToken, setPersonalToken] = useState('');
  const [copiedPersonalConfig, setCopiedPersonalConfig] = useState(false);
  // OAuth approval is an explicit user action. Keep a local guard because a
  // double click or a delayed browser event must not consume the one-shot
  // transaction twice.
  const oauthApprovalInFlightRef = useRef(false);
  const oauthAutoApprovalAttemptRef = useRef('');

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
      setCopiedOAuthSetup(false);
      setCopiedPersonalConfig(false);
      setPersonalToken('');
      setAuthorizations(null);
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

  const viewAuthorizations = () => perform('authorizations', async () => {
    const payload = await request('authorizations');
    setAuthorizations({
      binding: payload.binding,
      grants: Array.isArray(payload.authorizations) ? payload.authorizations : [],
      accessTokens: Array.isArray(payload.accessTokens) ? payload.accessTokens : [],
    });
    setMessage({
      type: 'success',
      text: zh ? '已读取当前浏览器保存的授权。' : 'Authorizations saved for this browser are loaded.',
    });
  });

  const revokeAuthorizations = (clientId = '') => perform(`revoke:${clientId || 'all'}`, async () => {
    const label = clientId || (zh ? '全部授权' : 'all authorizations');
    if (typeof window !== 'undefined' && !window.confirm(zh ? `确定撤销${label}吗？` : `Revoke ${label}?`)) return;
    const payload = await request('revoke-authorizations', clientId ? { clientId } : {});
    const grants = Array.isArray(payload.authorizations) ? payload.authorizations : [];
    const accessTokens = Array.isArray(payload.accessTokens) ? payload.accessTokens : [];
    setAuthorizations({ binding: payload.binding, grants, accessTokens });
    const targetStillExists = clientId
      ? grants.some((grant) => grant.clientId === clientId)
        || accessTokens.some((token) => token.clientId === clientId)
      : grants.length > 0 || accessTokens.length > 0;
    if (targetStillExists) {
      throw new Error(zh ? '服务端仍返回待撤销的授权，请稍后重试。' : 'The server still reports the authorization. Please retry.');
    }
    setMessage({
      type: 'success',
      text: zh
        ? `已撤销 ${payload.refreshTokensRevoked || 0} 个长期授权和 ${payload.revokedTokens?.length || 0} 个访问授权。`
        : `${payload.refreshTokensRevoked || 0} refresh authorization(s) and ${payload.revokedTokens?.length || 0} access authorization(s) revoked.`,
    });
  });

  const submitOAuthApproval = useCallback(async ({ silent = false } = {}) => {
    if (oauthApprovalInFlightRef.current) return Promise.resolve();
    oauthApprovalInFlightRef.current = true;
    try {
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
          silent,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok || !payload.redirectUrl) {
        const error = new Error(payload.error || `OAuth approval failed (${response.status}).`);
        error.code = payload.code;
        throw error;
      }
      window.location.assign(payload.redirectUrl);
    } finally {
      oauthApprovalInFlightRef.current = false;
    }
  }, [oauthTransaction, zh]);

  const approveOAuth = useCallback(() => perform('oauth-approve', () => submitOAuthApproval()), [perform, submitOAuthApproval]);

  useEffect(() => {
    if (!isOpen || !diagramPage || !oauthTransaction || oauthAutoApprovalAttemptRef.current === oauthTransaction) return;
    oauthAutoApprovalAttemptRef.current = oauthTransaction;
    submitOAuthApproval({ silent: true }).catch((error) => {
      if (error?.code !== 'CONSENT_REQUIRED') {
        setMessage({ type: 'error', text: String(error?.message || error) });
      }
    });
  }, [diagramPage, isOpen, oauthTransaction, submitOAuthApproval]);

  const copyOAuthSetup = async () => {
    try {
      await copyText(getDiagramMcpCodexOAuthSetup(endpoint));
      setCopiedOAuthSetup(true);
      setMessage({
        type: 'success',
        text: zh ? 'OAuth 连接命令已复制，请粘贴到终端运行。' : 'OAuth setup commands copied. Paste them into a terminal.',
      });
      window.setTimeout(() => setCopiedOAuthSetup(false), 1_500);
    } catch (error) {
      setMessage({ type: 'error', text: String(error?.message || error) });
    }
  };

  const createPersonalToken = () => perform('personal-token', async () => {
    const payload = await request('create-personal-token');
    setPersonalToken(String(payload.token || ''));
    setCopiedPersonalConfig(false);
    setMessage({
      type: 'success',
      text: zh
        ? '个人 Token 已生成，只显示这一次。现在可一键复制完整 Codex 配置。'
        : 'Personal Token created. It is shown only once; copy the complete Codex configuration now.',
    });
  });

  const copyPersonalConfig = async () => {
    if (!personalToken) return;
    try {
      await copyText(getDiagramMcpCodexPersonalTokenConfig(endpoint, personalToken));
      setCopiedPersonalConfig(true);
      setMessage({
        type: 'success',
        text: zh
          ? '完整配置已复制，请粘贴到 ~/.codex/config.toml；如已有同名配置，请先替换原配置。'
          : 'Complete configuration copied. Paste it into ~/.codex/config.toml, replacing any existing entry with the same name.',
      });
      window.setTimeout(() => setCopiedPersonalConfig(false), 1_500);
    } catch (error) {
      setMessage({ type: 'error', text: String(error?.message || error) });
    }
  };

  const connection = snapshot?.connection;
  const connected = connection?.status === 'connected' && connection?.currentClient !== false;
  const grants = authorizations?.grants || [];
  const accessTokens = authorizations?.accessTokens || [];

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
                <button type="button" disabled={Boolean(busy)} onClick={approveOAuth} className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900">
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

            <section className="border-t border-stone-200 py-5 dark:border-stone-800">
              <div className="font-medium text-stone-950 dark:text-stone-100">{zh ? '方式一：OAuth 自动授权' : 'Option 1: OAuth authorization'}</div>
              <p className="mt-1 text-xs leading-5 text-stone-500">
                {zh ? '适合支持 OAuth 的客户端。复制并运行下面两行命令，浏览器会自动打开授权。' : 'For OAuth-capable clients. Copy and run these two commands to open browser authorization.'}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-md bg-stone-100 px-3 py-2 text-xs leading-5 text-stone-800 dark:bg-stone-800 dark:text-stone-200">{endpoint ? getDiagramMcpCodexOAuthSetup(endpoint) : ''}</code>
                <button type="button" disabled={!endpoint} title={zh ? '复制 OAuth 连接命令' : 'Copy OAuth setup commands'} aria-label={zh ? '复制 OAuth 连接命令' : 'Copy OAuth setup commands'} onClick={copyOAuthSetup} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-stone-200 text-stone-600 transition hover:bg-stone-50 hover:text-stone-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-white/5 dark:hover:text-white">
                  {copiedOAuthSetup ? <Check className="size-4" /> : <Clipboard className="size-4" />}
                </button>
              </div>

              <div className="mt-4 flex items-start justify-between gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
                <div>
                  <div className="font-medium text-stone-950 dark:text-stone-100">{zh ? '授权管理' : 'Authorization management'}</div>
                  <p className="mt-1 text-xs leading-5 text-stone-500">
                    {zh ? '同一浏览器中的标签页共享这些授权，不会显示访问令牌内容。' : 'Tabs in this browser share these authorizations; token contents are never exposed.'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" disabled={Boolean(busy)} onClick={viewAuthorizations} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-300 px-2.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-white/5">
                    {busy === 'authorizations' ? <LoaderCircle className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
                    {zh ? '查看授权' : 'View authorization'}
                  </button>
                  <button type="button" disabled={Boolean(busy)} onClick={() => revokeAuthorizations()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200 px-2.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40">
                    {busy === 'revoke:all' ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldOff className="size-3.5" />}
                    {zh ? '撤销授权' : 'Revoke authorization'}
                  </button>
                </div>
              </div>

              {authorizations ? (
                <div className="mt-4 space-y-2">
                  {grants.length === 0 && accessTokens.length === 0 ? (
                    <p className="rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-500 dark:bg-stone-900/60">{zh ? '当前浏览器没有已保存的 OAuth 授权。' : 'No saved OAuth authorization for this browser.'}</p>
                  ) : null}
                  {grants.map((grant) => (
                    <div key={grant.clientId} className="flex items-center justify-between gap-3 rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-stone-800 dark:text-stone-200">{grant.clientName || grant.clientId}</div>
                        <div className="mt-1 text-[11px] text-stone-500">{grant.scopes?.join(' · ') || (zh ? '无范围信息' : 'No scope information')}</div>
                      </div>
                      <button type="button" disabled={Boolean(busy)} onClick={() => revokeAuthorizations(grant.clientId)} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-red-200 px-2 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40">
                        {busy === `revoke:${grant.clientId}` ? <LoaderCircle className="size-3 animate-spin" /> : <ShieldOff className="size-3" />}
                        {zh ? '撤销' : 'Revoke'}
                      </button>
                    </div>
                  ))}
                  {accessTokens.length > 0 ? (
                    <p className="text-[11px] leading-5 text-stone-500">
                      {zh ? `当前浏览器共有 ${accessTokens.filter((token) => token.status === 'active').length} 个有效访问授权。` : `${accessTokens.filter((token) => token.status === 'active').length} active access authorization(s) belong to this browser.`}
                    </p>
                  ) : null}
                </div>
              ) : null}

            </section>

            {!oauthTransaction ? (
              <section className="border-t border-stone-200 pt-5 dark:border-stone-800">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-stone-950 dark:text-stone-100">{zh ? '方式二：个人 Token' : 'Option 2: Personal Token'}</div>
                    <p className="mt-1 text-xs leading-5 text-stone-500">
                      {zh ? '适合你自己的 Codex。生成后，一键复制可直接粘贴的完整配置。' : 'For your own Codex. Create a token, then copy a complete ready-to-paste configuration.'}
                    </p>
                  </div>
                  <button type="button" disabled={!connected || Boolean(busy)} onClick={createPersonalToken} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-stone-900 px-2.5 text-xs font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300">
                    {busy === 'personal-token' ? <LoaderCircle className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
                    {zh ? '生成 Token' : 'Create Token'}
                  </button>
                </div>
                {personalToken ? (
                  <div className="mt-3">
                    <code className="block overflow-x-auto whitespace-nowrap rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{personalToken}</code>
                    <button type="button" onClick={copyPersonalConfig} className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-300 px-3 text-xs font-medium text-stone-700 transition hover:bg-stone-50 hover:text-stone-950 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-white/5 dark:hover:text-white">
                      {copiedPersonalConfig ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}
                      {copiedPersonalConfig
                        ? (zh ? '配置已复制' : 'Configuration copied')
                        : (zh ? '复制 Codex 配置' : 'Copy Codex configuration')}
                    </button>
                  </div>
                ) : null}
                <p className="mt-2 text-[11px] leading-5 text-stone-500">
                  {zh ? 'Token 只显示一次；重新生成会立即移除旧 Token。请勿分享复制出的配置。' : 'The token is shown once; creating another immediately removes the old token. Do not share the copied configuration.'}
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
