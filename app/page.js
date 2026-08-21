'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppTopNav from '@/components/AppTopNav';
import ReaderLabWorkspace from '@/components/ReaderLabWorkspace';
import ConfigManager from '@/components/ConfigManager';
import HistoryModal from '@/components/HistoryModal';
import Notification from '@/components/Notification';
import { useLocale } from '@/components/LocaleProvider';
import { GO_IMPORT_EVENT } from '@/components/reader-lab/ReaderHome';
import { OPEN_GLOSSARY_EVENT, OPEN_TOOLBAR_CONFIG_EVENT } from '@/components/ReaderLabWorkspace';
import { getConfig, isConfigValid } from '@/lib/config';
import { STANDALONE_DIAGRAM_DOCUMENT_ID } from '@/lib/diagram-generation';
import { getDiagramRouteId } from '@/lib/diagram-route-id';
import { getDocumentRouteId } from '@/lib/document-route-id';
import { buildDiagramPath, buildDocumentPath, buildNewDiagramPath, parseWorkspaceResourceLocation } from '@/lib/workspace-routes';

export default function Home() {
  const router = useRouter();
  const { t } = useLocale();
  const [config, setConfig] = useState(null);
  const [isConfigManagerOpen, setIsConfigManagerOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [mode, setMode] = useState('article');
  // 导航「图解」入口进的是独立图解工作区；文档内触发（选区/工具栏/历史）仍是文档绑定图解
  const [standaloneDiagram, setStandaloneDiagram] = useState(false);
  const [diagramRequest, setDiagramRequest] = useState(null);
  const [readerDocumentRequest, setReaderDocumentRequest] = useState(null);
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
      router.push('/diagrams');
      return;
    }
    // 首页：回到首页视图（退出文档工作区），并广播事件让首页滚到导入区
    handleModeChange('article');
    setHomeEntered(false);
    window.dispatchEvent(new Event(GO_IMPORT_EVENT));
  };

  const handleCreateDiagram = () => {
    router.push(buildNewDiagramPath());
  };

  const handleDiagramResolved = useCallback((drawing) => {
    if (!drawing?.id || !drawing.documentId) {
      router.replace('/diagrams');
      return;
    }
    setMode('diagram');
    setStandaloneDiagram(drawing.documentId === STANDALONE_DIAGRAM_DOCUMENT_ID);
    setHomeEntered(true);
    const href = buildDiagramPath(getDiagramRouteId(drawing));
    if (window.location.pathname !== href || window.location.search) router.replace(href);
  }, [router]);

  const handleDocumentResolved = useCallback((document) => {
    if (!document?.id) {
      router.replace('/reader-lab');
      return;
    }
    const href = buildDocumentPath(getDocumentRouteId(document));
    if (window.location.pathname !== href || window.location.search) router.replace(href);
  }, [router]);

  // 资源库通过短暂 query 把目标交给唯一工作区，恢复后清参避免刷新重入。
  useEffect(() => {
    const location = parseWorkspaceResourceLocation(window.location.pathname, window.location.search);
    if (!location) return;
    const { view, drawingId, documentId, createNew, stable } = location;
    const request = {
      drawingId,
      documentId,
      createNew,
      requestKey: `${drawingId}:${documentId}:${createNew}:${Date.now()}`,
    };
    const applyTimer = window.setTimeout(() => {
      if (view === 'diagram') {
        setMode('diagram');
        setStandaloneDiagram(documentId === STANDALONE_DIAGRAM_DOCUMENT_ID);
        setDiagramRequest(request);
      } else {
        setMode('article');
        setStandaloneDiagram(false);
        setReaderDocumentRequest({
          documentId,
          requestKey: `${documentId}:${Date.now()}`,
        });
      }
      setHomeEntered(true);
      if (!stable && !createNew) {
        if (view === 'diagram' && drawingId) router.replace(buildDiagramPath(drawingId));
        if (view === 'read' && documentId) router.replace(buildDocumentPath(documentId));
      } else if (!stable) {
        const params = new URLSearchParams(window.location.search);
        params.delete('view');
        params.delete('drawing');
        params.delete('document');
        params.delete('new');
        const nextSearch = params.toString();
        window.history.replaceState(null, '', nextSearch ? `/?${nextSearch}` : '/');
      }
    }, 0);
    return () => window.clearTimeout(applyTimer);
  }, [router]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f5f7f6] text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      {/* 全局顶栏：所有页面共享的导航入口 */}
      <AppTopNav
        activeSlug={mode === 'diagram' ? 'diagram' : (homeEntered ? 'reader-lab' : 'read')}
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
          requestedDrawingId={diagramRequest?.drawingId || ''}
          requestedDocumentId={diagramRequest?.documentId || ''}
          newDiagramRequestKey={diagramRequest?.createNew ? diagramRequest.requestKey : ''}
          onDiagramResolved={handleDiagramResolved}
          onDocumentResolved={handleDocumentResolved}
          requestedReaderDocumentId={readerDocumentRequest?.documentId || ''}
          readerDocumentRequestKey={readerDocumentRequest?.requestKey || ''}
          onToolChange={(tool) => {
            // 工作区内触发的图解（选区锚定/一键全文图/历史应用）都是文档绑定形态
            if (tool === 'diagram') setStandaloneDiagram(false);
            setMode(tool === 'diagram' ? 'diagram' : 'article');
          }}
          onCurrentDocumentChange={setCurrentDocument}
          onOpenHistory={() => setIsHistoryModalOpen(true)}
          historyDrawing={pendingHistory}
          onOpenDocumentLibrary={() => router.push('/reader-lab')}
          onCreateDiagram={handleCreateDiagram}
          onOpenDiagram={(drawing) => {
            if (!drawing) {
              router.push('/diagrams');
              return;
            }
            setMode('diagram');
            setStandaloneDiagram(drawing.documentId === STANDALONE_DIAGRAM_DOCUMENT_ID);
            setHomeEntered(true);
            setDiagramRequest({
              drawingId: drawing.id,
              documentId: drawing.documentId,
              createNew: false,
              requestKey: `${drawing.id}:${drawing.documentId}:${Date.now()}`,
            });
          }}
          headerStatus={
            usePassword || (config && isConfigValid(config))
              ? (
                <div className="hidden max-w-64 items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 xl:flex dark:border-emerald-900 dark:bg-emerald-950">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                  <span className="truncate text-[11px] font-medium text-emerald-900 dark:text-emerald-200">
                    {usePassword ? t('home.passwordAccess') : `${config.name || config.type} · ${config.model}`}
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
