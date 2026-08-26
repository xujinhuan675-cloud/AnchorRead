'use client';

import { useState } from 'react';
import { historyManager } from '../lib/history-manager.js';
import { CHART_TYPES } from '../lib/constants.js';
import ConfirmDialog from './ConfirmDialog';
import { useLocale } from './LocaleProvider';

export default function HistoryModal({ isOpen, onClose, onApply, documentId = '', onDeleteDrawing = null, onClearAll = null }) {
  if (!isOpen) return null;

  return <HistoryModalContent onClose={onClose} onApply={onApply} documentId={documentId} onDeleteDrawing={onDeleteDrawing} onClearAll={onClearAll} />;
}

function HistoryModalContent({ onClose, onApply, documentId, onDeleteDrawing, onClearAll }) {
  const { t } = useLocale();
  const [histories, setHistories] = useState(() => documentId ? historyManager.getForDocument(documentId) : historyManager.getHistories());
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null
  });

  // 图类型展示走语言包：未知类型回退为原始键名
  const chartTypeLabel = (chartType) => (
    CHART_TYPES[chartType] ? t(`diagram.chartType.${chartType}`) : chartType
  );

  const loadHistories = () => {
    const allHistories = documentId ? historyManager.getForDocument(documentId) : historyManager.getHistories();
    setHistories(allHistories);
  };

  const handleApply = (history) => {
    onApply?.(history);
    onClose();
  };

  const handleDelete = (id) => {
    // 历史与图解一一对应后，删除历史条目同时移除关联图解，
    // 避免图解还在、下次打开又被回填复活
    const entry = histories.find((item) => item.id === id);
    setConfirmDialog({
      isOpen: true,
      title: t('diagram.confirmDeleteTitle'),
      message: t('diagram.confirmDeleteMessage'),
      onConfirm: () => {
        historyManager.deleteHistory(id);
        if (entry?.drawingId && onDeleteDrawing) onDeleteDrawing(entry.drawingId);
        loadHistories();
      }
    });
  };

  const handleClearAll = () => {
    setConfirmDialog({
      isOpen: true,
      title: t('diagram.confirmClearTitle'),
      message: t('diagram.confirmClearMessage'),
      onConfirm: () => {
        // 图解上下文传入文档级清空（连图解一起删）；缺省保留全局清空旧行为
        if (onClearAll) onClearAll();
        else historyManager.clearAll();
        loadHistories();
      }
    });
  };

  const truncateText = (text, maxLength = 100) => {
    if (!text) return '';
    // Handle case where text might be an object (for image uploads)
    if (typeof text === 'object') {
      return text.text || t('diagram.historyImageInput');
    }
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-white rounded border border-stone-300 w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden flex flex-col dark:bg-stone-900 dark:border-stone-700">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-stone-800">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">{t('diagram.historyTitle')}</h2>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-stone-400 hover:text-stone-600 transition-colors duration-200 dark:hover:text-stone-200"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {histories.length > 0 && (
            <div className="mb-4">
              <button
                onClick={handleClearAll}
                className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors duration-200"
              >
                {t('diagram.historyClearAll')}
              </button>
            </div>
          )}

          {histories.length === 0 ? (
            <div className="text-center py-8 text-stone-500 dark:text-stone-400">
              {t('diagram.historyEmpty')}
            </div>
          ) : (
            // 列表形态：单行多列（序号 | 标题 | 类型 | 引擎 | 时间 | 操作）+ 分隔线；
            // 窄屏隐藏引擎/时间列避免换行，标题 truncate 并在 title 属性保留全文
            <ul className="divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
              {histories.map((history, index) => (
                <li
                  key={history.id}
                  className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-stone-50 dark:hover:bg-white/5"
                >
                  <span className="w-6 shrink-0 text-right text-xs tabular-nums text-stone-400 dark:text-stone-500" aria-hidden="true">
                    {index + 1}
                  </span>
                  <p
                    className="min-w-0 flex-1 truncate text-sm text-stone-900 dark:text-stone-100"
                    title={typeof history.userInput === 'object' ? history.userInput?.text : history.userInput}
                  >
                    {truncateText(history.userInput)}
                  </p>
                  <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    {chartTypeLabel(history.chartType)}
                  </span>
                  <span className="hidden w-16 shrink-0 text-xs text-stone-500 dark:text-stone-400 sm:block">
                    {history.engine === 'mermaid' ? 'Mermaid' : 'Excalidraw'}
                  </span>
                  <time className="hidden shrink-0 text-xs text-stone-500 dark:text-stone-400 sm:block">
                    {new Date(history.timestamp).toLocaleString()}
                  </time>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => handleApply(history)}
                      className="rounded border border-blue-500 px-2.5 py-1 text-xs text-blue-600 transition-colors hover:bg-blue-500 hover:text-white dark:text-blue-400 dark:hover:text-white"
                    >
                      {t('diagram.apply')}
                    </button>
                    <button
                      onClick={() => handleDelete(history.id)}
                      className="rounded border border-stone-300 px-2.5 py-1 text-xs text-stone-500 transition-colors hover:border-red-500 hover:bg-red-500 hover:text-white dark:border-stone-700 dark:text-stone-400"
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        onConfirm={() => {
          confirmDialog.onConfirm?.();
          setConfirmDialog({ ...confirmDialog, isOpen: false });
        }}
        title={confirmDialog.title}
        message={confirmDialog.message}
        type="danger"
      />
    </div>
  );
}
