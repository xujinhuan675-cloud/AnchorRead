'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppTopNav from '@/components/AppTopNav';
import ReaderLabWorkspace from '@/components/ReaderLabWorkspace';
import ConfigManager from '@/components/ConfigManager';
import HistoryModal from '@/components/HistoryModal';
import Notification from '@/components/Notification';
import { GO_IMPORT_EVENT } from '@/components/reader-lab/ReaderHome';
import { OPEN_GLOSSARY_EVENT, OPEN_TOOLBAR_CONFIG_EVENT } from '@/components/ReaderLabWorkspace';
import { getConfig, isConfigValid } from '@/lib/config';
import { STANDALONE_DIAGRAM_DOCUMENT_ID } from '@/lib/diagram-generation';

export default function Home() {
  const router = useRouter();
  const [config, setConfig] = useState(null);
  const [isConfigManagerOpen, setIsConfigManagerOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [mode, setMode] = useState('article');
  // 导航「图解」入口进的是独立图解工作区；文档内触发（选区/工具栏/历史）仍是文档绑定图解
  const [standaloneDiagram, setStandaloneDiagram] = useState(false);
  const [homeEntered, setHomeEntered] = useState(false);
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
    setStandaloneDiagram(false);
    setMode('diagram');
    setIsHistoryModalOpen(false);
  };

  const handleModeChange = (nextMode) => {
    const next = nextMode === 'diagram' ? 'diagram' : 'article';
    // 图表面板依附于阅读工作区，从首页切入时需先进入工作区，避免按钮无反应
    if (next === 'diagram') {
      setHomeEntered(true);
      // 从导航进入图解：不绑定当前打开的文档，是可以自由建图的独立工作区
      setStandaloneDiagram(true);
    } else {
      setStandaloneDiagram(false);
    }
    setMode(next);
  };

  // 全局顶栏导航：文档库走独立路由，图解/首页在当前页内切换视图
  const handleHomeNavigate = (slug) => {
    if (slug === 'reader-lab') {
      router.push('/reader-lab');
      return;
    }
    if (slug === 'diagram') {
      handleModeChange('diagram');
      return;
    }
    // 首页：回到首页视图（退出文档工作区），并广播事件让首页滚到导入区
    handleModeChange('article');
    setHomeEntered(false);
    window.dispatchEvent(new Event(GO_IMPORT_EVENT));
  };

  // 从其他路由带 ?view=diagram 进入时直达图解视图，消费后清掉参数避免刷新重入
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') !== 'diagram') return;
    handleModeChange('diagram');
    params.delete('view');
    const nextUrl = params.toString() ? `/?${params.toString()}` : '/';
    window.history.replaceState(null, '', nextUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f5f7f6] text-stone-900">
      {/* 全局顶栏：所有页面共享的导航入口 */}
      <AppTopNav
        activeSlug={mode === 'diagram' ? 'diagram' : 'read'}
        onNavigate={handleHomeNavigate}
        onConfig={() => setIsConfigManagerOpen(true)}
        onToolbarConfig={() => window.dispatchEvent(new Event(OPEN_TOOLBAR_CONFIG_EVENT))}
        onGlossary={() => window.dispatchEvent(new Event(OPEN_GLOSSARY_EVENT))}
      />
      <main className="min-h-0 flex-1 overflow-hidden">
        <ReaderLabWorkspace
          layout="home"
          started={homeEntered}
          requestedTool={mode === 'diagram' ? 'diagram' : 'read'}
          standaloneDiagram={mode === 'diagram' && standaloneDiagram}
          onToolChange={(tool) => {
            // 工作区内触发的图解（选区锚定/一键全文图/历史应用）都是文档绑定形态
            if (tool === 'diagram') setStandaloneDiagram(false);
            setMode(tool === 'diagram' ? 'diagram' : 'article');
          }}
          onCurrentDocumentChange={setCurrentDocument}
          onOpenHistory={() => setIsHistoryModalOpen(true)}
          historyDrawing={pendingHistory}
          onOpenDiagram={() => handleModeChange('diagram')}
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

      <ConfigManager isOpen={isConfigManagerOpen} onClose={() => setIsConfigManagerOpen(false)} onConfigSelect={handleConfigSelect} />
      <HistoryModal isOpen={isHistoryModalOpen} onClose={() => setIsHistoryModalOpen(false)} onApply={handleApplyHistory} documentId={mode === 'diagram' && standaloneDiagram ? STANDALONE_DIAGRAM_DOCUMENT_ID : (currentDocument?.id || '')} />
      <Notification isOpen={notification.isOpen} onClose={() => setNotification({ ...notification, isOpen: false })} title={notification.title} message={notification.message} type={notification.type} />
    </div>
  );
}
