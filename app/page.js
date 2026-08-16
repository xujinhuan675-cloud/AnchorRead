'use client';

import { useEffect, useState } from 'react';
import ReaderLabWorkspace from '@/components/ReaderLabWorkspace';
import ConfigManager from '@/components/ConfigManager';
import HistoryModal from '@/components/HistoryModal';
import Notification from '@/components/Notification';
import WorkspaceNav from '@/components/WorkspaceNav';
import { getConfig, isConfigValid } from '@/lib/config';

export default function Home() {
  const [config, setConfig] = useState(null);
  const [isConfigManagerOpen, setIsConfigManagerOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [mode, setMode] = useState('article');
  const [homeEntered, setHomeEntered] = useState(false);
  const [readerWorkspaceVersion, setReaderWorkspaceVersion] = useState(0);
  const [currentDocument, setCurrentDocument] = useState(null);
  const [pendingHistory, setPendingHistory] = useState(null);
  const [usePassword, setUsePassword] = useState(false);
  const [notification, setNotification] = useState({
    isOpen: false,
    title: '',
    message: '',
    type: 'info',
  });

  useEffect(() => {
    const handleStorageChange = (event) => {
      if (event.key === 'smart-excalidraw-active-config' || event.key === 'smart-excalidraw-configs') {
        setConfig(getConfig());
      }
      if (event.key === 'smart-excalidraw-use-password') {
        setUsePassword(localStorage.getItem('smart-excalidraw-use-password') === 'true');
      }
    };
    const handlePasswordSettingsChanged = (event) => setUsePassword(event.detail.usePassword);
    const initialize = () => {
      setConfig(getConfig());
      setUsePassword(localStorage.getItem('smart-excalidraw-use-password') === 'true');
    };

    const initializeTimer = window.setTimeout(initialize, 0);
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('password-settings-changed', handlePasswordSettingsChanged);
    return () => {
      window.clearTimeout(initializeTimer);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('password-settings-changed', handlePasswordSettingsChanged);
    };
  }, []);

  const handleConfigSelect = (selectedConfig) => {
    if (selectedConfig) setConfig(selectedConfig);
  };

  const handleApplyHistory = (history) => {
    if (!history?.generatedCode) return;
    setPendingHistory({ ...history, nonce: Date.now() });
    setMode('diagram');
    setIsHistoryModalOpen(false);
  };

  const handleNewArticle = () => {
    setMode('article');
    setHomeEntered(false);
    setPendingHistory(null);
    setReaderWorkspaceVersion((version) => version + 1);
  };

  const handleModeChange = (nextMode) => {
    const next = nextMode === 'diagram' ? 'diagram' : 'article';
    // 图表面板依附于阅读工作区，从首页切入时需先进入工作区，避免按钮无反应
    if (next === 'diagram') setHomeEntered(true);
    setMode(next);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#f5f7f6] text-gray-900">
      <WorkspaceNav
        mode={mode}
        onNewArticle={handleNewArticle}
        onModeChange={handleModeChange}
        onConfig={() => setIsConfigManagerOpen(true)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 首页只保留一条顶栏：品牌词标、文档信息与工具都在工作区头部，避免多条栏堆叠 */}
        <WorkspaceNav
          mobile
          mode={mode}
          onNewArticle={handleNewArticle}
          onModeChange={handleModeChange}
          onConfig={() => setIsConfigManagerOpen(true)}
        />

        <main className="min-h-0 flex-1 overflow-hidden">
          <ReaderLabWorkspace
            key={readerWorkspaceVersion}
            layout="home"
            started={homeEntered}
            requestedTool={mode === 'diagram' ? 'diagram' : 'read'}
            onToolChange={(tool) => setMode(tool === 'diagram' ? 'diagram' : 'article')}
            onCurrentDocumentChange={setCurrentDocument}
            onOpenHistory={() => setIsHistoryModalOpen(true)}
            historyDrawing={pendingHistory}
            headerStatus={
              usePassword || (config && isConfigValid(config))
                ? (
                  <div className="hidden max-w-64 items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 xl:flex">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                    <span className="truncate text-[11px] font-medium text-emerald-900">
                      {usePassword ? '密码访问已启用' : `${config.name || config.type} · ${config.model}`}
                    </span>
                  </div>
                )
                : null
            }
          />
        </main>
      </div>

      <ConfigManager isOpen={isConfigManagerOpen} onClose={() => setIsConfigManagerOpen(false)} onConfigSelect={handleConfigSelect} />
      <HistoryModal isOpen={isHistoryModalOpen} onClose={() => setIsHistoryModalOpen(false)} onApply={handleApplyHistory} documentId={currentDocument?.id || ''} />
      <Notification isOpen={notification.isOpen} onClose={() => setNotification({ ...notification, isOpen: false })} title={notification.title} message={notification.message} type={notification.type} />
    </div>
  );
}
