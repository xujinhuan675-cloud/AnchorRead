'use client';

import { Editor } from '@monaco-editor/react';
import { useLocale } from '@/components/LocaleProvider';
import { useAppTheme } from '@/lib/theme';

export default function CodeEditor({ code, onChange, onApply, onOptimize, onClear, jsonError, onClearJsonError, isGenerating, isApplyingCode, isOptimizingCode, engine = 'excalidraw' }) {
  const { t } = useLocale();
  // Monaco 编辑器主题跟随全站明暗
  const { theme } = useAppTheme();
  return (
    <div className="flex relative flex-col h-full bg-stone-50 border-t border-stone-200 dark:bg-white/5 dark:border-stone-800">
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-stone-200 dark:bg-stone-900 dark:border-stone-800">
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">{t('diagram.codeTitle')}</h3>
        <div className="flex space-x-2">
          <button
            onClick={onClear}
            disabled={isGenerating || isApplyingCode || isOptimizingCode}
            className="px-4 py-2 text-sm font-medium text-stone-700 bg-white border border-stone-300 rounded hover:bg-stone-50 disabled:bg-stone-100 disabled:text-stone-400 disabled:cursor-not-allowed transition-colors duration-200 flex items-center gap-2 dark:text-stone-200 dark:bg-white/5 dark:border-stone-700 dark:hover:bg-white/10 dark:disabled:bg-white/5 dark:disabled:text-stone-500"
          >
            {t('diagram.clear')}
            {isGenerating && (
              <div className="w-3 h-3 border border-stone-400 border-t-transparent rounded-full animate-spin"></div>
            )}
          </button>
          <button
            onClick={onOptimize}
            disabled={engine === 'mermaid' || isGenerating || isApplyingCode || isOptimizingCode || !code.trim()}
            className="px-4 py-2 text-sm font-medium text-white rounded disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors duration-200 flex items-center gap-2 dark:disabled:bg-stone-700"
            style={{
              background: isGenerating || isApplyingCode || isOptimizingCode ? '#d1d5db' : 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)'
            }}
            title={t('diagram.optimizeTitle')}
          >
            {isOptimizingCode ? (
              <>
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>{t('diagram.optimizing')}</span>
              </>
            ) : (
              <>
                <span>{t('diagram.optimize')}</span>
                {isGenerating && (
                  <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                )}
              </>
            )}
          </button>
          <button
            onClick={onApply}
            disabled={isGenerating || isApplyingCode || isOptimizingCode || !code.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-stone-900 rounded hover:bg-stone-800 disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors duration-200 flex items-center gap-2 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white dark:disabled:bg-stone-700 dark:disabled:text-stone-400"
          >
            {isApplyingCode ? (
              <>
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin dark:border-stone-900 dark:border-t-transparent"></div>
                <span>{t('diagram.applying')}</span>
              </>
            ) : (
              <>
                <span>{t('diagram.apply')}</span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="w-4 h-4"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
                {isGenerating && (
                  <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                )}
              </>
            )}
          </button>
        </div>
      </div>

      {/* JSON Error Banner */}
      {jsonError && (
        <div className="absolute bottom-0 z-1 border-b border-red-200 px-4 py-3 flex items-start justify-between bg-white dark:border-red-900 dark:bg-stone-900" >
          <div className="flex items-start space-x-2">
            <svg className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <div className="flex-1">
              <p className="text-red-700 mt-1 font-mono dark:text-red-300" style={{ fontSize: '12px' }}>{jsonError}</p>
            </div>
          </div>
          <button
            onClick={onClearJsonError}
            className="text-red-600 hover:text-red-800 transition-colors ml-2 dark:text-red-400 dark:hover:text-red-300"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      )}

      <div className="flex-1">
        <Editor
          height="100%"
          language={engine === 'mermaid' ? 'plaintext' : 'javascript'}
          value={code}
          onChange={onChange}
          theme={theme === 'dark' ? 'vs-dark' : 'vs-light'}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
          }}
        />
      </div>
    </div>
  );
}

