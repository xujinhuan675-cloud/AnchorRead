'use client';

import { Database, Download, FolderOpen } from 'lucide-react';

export default function LocalDataNotice({ status = 'saved', onSave, onOpen }) {
  const statusText = {
    saving: '正在保存到此浏览器...',
    saved: '已保存到此浏览器',
    error: '本地保存失败',
  }[status] || '已保存到此浏览器';

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div
        className={`hidden min-w-0 items-center gap-2 rounded border px-3 py-2 md:flex ${
          status === 'error'
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-gray-200 bg-gray-50 text-gray-600'
        }`}
        title="数据默认仅保存在本机浏览器，由您自行控制。浏览器数据可能被意外清除，请定期保存工作区文件。调用 AI 时，相关内容会发送给您配置的模型服务。"
      >
        <Database size={15} className="shrink-0" aria-hidden="true" />
        <span className="truncate text-xs">{statusText} · 数据由您控制</span>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="flex h-9 w-9 items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-900"
        title="打开本地工作区文件"
        aria-label="打开本地工作区文件"
      >
        <FolderOpen size={17} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onSave}
        className="flex h-9 items-center gap-2 rounded border border-gray-200 px-3 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
        title="保存工作区文件，防止浏览器数据被意外清除"
      >
        <Download size={16} aria-hidden="true" />
        <span className="hidden xl:inline">保存工作区</span>
      </button>
    </div>
  );
}
