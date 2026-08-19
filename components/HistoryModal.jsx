'use client';

import { useState } from 'react';
import { historyManager } from '../lib/history-manager.js';
import { CHART_TYPES } from '../lib/constants.js';
import ConfirmDialog from './ConfirmDialog';
import { useLocale } from './LocaleProvider';

export default function HistoryModal({ isOpen, onClose, onApply, documentId = '' }) {
  if (!isOpen) return null;

  return <HistoryModalContent onClose={onClose} onApply={onApply} documentId={documentId} />;
}

function HistoryModalContent({ onClose, onApply, documentId }) {
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
    setConfirmDialog({
      isOpen: true,
      title: t('diagram.confirmDeleteTitle'),
      message: t('diagram.confirmDeleteMessage'),
      onConfirm: () => {
        historyManager.deleteHistory(id);
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
        historyManager.clearAll();
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

          <div className="space-y-3">
            {histories.length === 0 ? (
              <div className="text-center py-8 text-stone-500 dark:text-stone-400">
                {t('diagram.historyEmpty')}
              </div>
            ) : (
              histories.map((history) => (
                <div
                  key={history.id}
                  className="border border-stone-200 rounded-lg p-4 hover:border-stone-300 dark:border-stone-800 dark:hover:border-stone-600"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded dark:bg-blue-950 dark:text-blue-300">
                          {chartTypeLabel(history.chartType)}
                        </span>
                        <span className="px-2 py-1 text-xs bg-stone-100 text-stone-600 rounded dark:bg-white/10 dark:text-stone-300">
                          {history.engine === 'mermaid' ? 'Mermaid' : 'Excalidraw'}
                        </span>
                        <span className="text-xs text-stone-500 dark:text-stone-400">
                          {new Date(history.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-stone-900 mb-2 dark:text-stone-100">
                        {truncateText(history.userInput)}
                      </p>
                      {history.config && (
                        <div className="text-xs text-stone-500 dark:text-stone-400">
                          {t('diagram.historyModel', { name: history.config.name, model: history.config.model })}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={() => handleApply(history)}
                        className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors duration-200"
                      >
                        {t('diagram.apply')}
                      </button>
                      <button
                        onClick={() => handleDelete(history.id)}
                        className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors duration-200"
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
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
