'use client';

import { useEffect, useState } from 'react';
import { CloudUpload, CloudDownload, Download, LoaderCircle } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import {
  SyncStorageError,
  loadSyncConfig,
  saveSyncConfig,
  pickSyncAdapter,
} from '@/lib/sync-storage';
import { pushWorkspace, pullWorkspace, peekRemoteExportedAt } from '@/lib/sync-manager';
import { workspaceRepository } from '@/lib/local-workspace-db';
import { exportWorkspace, downloadWorkspaceFile } from '@/lib/workspace-file';
import { flashcardStore } from '@/lib/flashcard-store';
import { historyManager } from '@/lib/history-manager';

function formatTime(value) {
  if (!value) return '尚未同步';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function WorkspaceSyncPanel({ isOpen, onClose }) {
  const [config, setConfig] = useState(() => loadSyncConfig());
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (isOpen) setConfig(loadSyncConfig());
  }, [isOpen]);

  const updateWebDav = (patch) => {
    setConfig((previous) => ({ ...previous, webdav: { ...previous.webdav, ...patch } }));
  };

  const resolveAdapter = () => {
    saveSyncConfig(config);
    return pickSyncAdapter(config);
  };

  const push = async () => {
    setBusy('push');
    setMessage(null);
    try {
      const adapter = resolveAdapter();
      const syncedAt = await pushWorkspace(adapter, workspaceRepository);
      const next = { ...config, lastSyncAt: syncedAt };
      setConfig(next);
      saveSyncConfig(next);
      setMessage({ type: 'success', text: `已推送到「${adapter.label}」（${formatTime(syncedAt)}）。` });
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || '推送失败。' });
    } finally {
      setBusy('');
    }
  };

  // 本地备份：把整个工作区导出为 .anchorread 文件，不依赖同步存储
  const exportLocal = async () => {
    setBusy('export');
    setMessage(null);
    try {
      const payload = await exportWorkspace(workspaceRepository, {
        flashcards: flashcardStore.getAll(),
        diagramHistory: historyManager.getHistories(),
      });
      downloadWorkspaceFile(payload, `anchor-read-backup-${new Date().toISOString().slice(0, 10)}.anchorread`);
      setMessage({ type: 'success', text: 'JSON 备份已开始下载。' });
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || '导出失败。' });
    } finally {
      setBusy('');
    }
  };

  const pull = async () => {
    setBusy('pull');
    setMessage(null);
    try {
      const adapter = resolveAdapter();
      const remoteAt = await peekRemoteExportedAt(adapter);
      const { count } = await pullWorkspace(adapter, workspaceRepository, { replace: true });
      const next = { ...config, lastSyncAt: remoteAt || Date.now() };
      setConfig(next);
      saveSyncConfig(next);
      setMessage({ type: 'success', text: `已拉取远端备份，共导入 ${count} 条记录。页面刷新后生效。` });
    } catch (error) {
      const text = error instanceof SyncStorageError || error?.message
        ? error.message
        : '拉取失败。';
      setMessage({ type: 'error', text });
    } finally {
      setBusy('');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="工作区同步" maxWidth="max-w-lg">
      <div className="space-y-4 text-sm text-gray-800">
        <p className="text-xs leading-5 text-gray-500">
          同步会把整个工作区（文档、解读、术语、闪卡、自定义动作）作为一个备份整体推送/拉回，拉取会替换本地数据。
        </p>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">同步存储</span>
          <select
            value={config.provider}
            onChange={(event) => setConfig((previous) => ({ ...previous, provider: event.target.value }))}
            className="h-9 w-full rounded border border-gray-200 bg-white px-2 text-sm outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
          >
            <option value="browser-slot">浏览器本地同步槽（localStorage）</option>
            <option value="webdav">WebDAV（坚果云 / Alist / Nextcloud）</option>
          </select>
        </label>

        {config.provider === 'webdav' && (
          <div className="space-y-3 rounded border border-gray-200 bg-gray-50 p-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">WebDAV 文件地址</span>
              <input
                type="url"
                value={config.webdav.url || ''}
                onChange={(event) => updateWebDav({ url: event.target.value })}
                placeholder="https://dav.example.com/anchorread/workspace.anchorread"
                className="h-9 w-full rounded border border-gray-200 bg-white px-2 text-xs outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">用户名</span>
                <input
                  type="text"
                  value={config.webdav.username || ''}
                  onChange={(event) => updateWebDav({ username: event.target.value })}
                  autoComplete="username"
                  className="h-9 w-full rounded border border-gray-200 bg-white px-2 text-xs outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">密码 / 应用密码</span>
                <input
                  type="password"
                  value={config.webdav.password || ''}
                  onChange={(event) => updateWebDav({ password: event.target.value })}
                  autoComplete="current-password"
                  className="h-9 w-full rounded border border-gray-200 bg-white px-2 text-xs outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
                />
              </label>
            </div>
            <p className="text-[11px] leading-4 text-gray-500">
              凭据仅保存在本浏览器 localStorage。若服务未开启 CORS，浏览器直连会被拦截，可改用自建代理或 Alist 等支持 CORS 的服务。
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={push}
            disabled={Boolean(busy)}
            className="flex h-10 items-center justify-center gap-2 rounded bg-teal-700 text-xs font-medium text-white outline-none hover:bg-teal-800 focus-visible:ring-2 focus-visible:ring-teal-600 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {busy === 'push' ? <LoaderCircle size={15} className="animate-spin" /> : <CloudUpload size={15} />}
            推送备份
          </button>
          <button
            type="button"
            onClick={pull}
            disabled={Boolean(busy)}
            className="flex h-10 items-center justify-center gap-2 rounded border border-gray-300 bg-white text-xs font-medium text-gray-700 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'pull' ? <LoaderCircle size={15} className="animate-spin" /> : <CloudDownload size={15} />}
            拉取恢复
          </button>
        </div>

        <button
          type="button"
          onClick={exportLocal}
          disabled={Boolean(busy)}
          className="flex h-9 w-full items-center justify-center gap-2 rounded border border-gray-200 bg-white text-xs font-medium text-gray-700 outline-none hover:border-gray-300 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'export' ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />}
          导出本地备份文件
        </button>

        <p className="text-[11px] text-gray-400">上次同步：{formatTime(config.lastSyncAt)}</p>

        {message && (
          <p role={message.type === 'error' ? 'alert' : 'status'} className={`text-xs leading-5 ${message.type === 'error' ? 'text-red-700' : 'text-teal-700'}`}>
            {message.text}
          </p>
        )}
      </div>
    </Modal>
  );
}
