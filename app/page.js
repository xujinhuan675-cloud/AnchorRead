'use client';

import { useCallback, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Chat from '@/components/Chat';
import ReaderLabWorkspace from '@/components/ReaderLabWorkspace';
import FlashcardReview from '@/components/FlashcardReview';
import CodeEditor from '@/components/CodeEditor';
import ConfigManager from '@/components/ConfigManager';
import ContactModal from '@/components/ContactModal';
import HistoryModal from '@/components/HistoryModal';
import AccessPasswordModal from '@/components/AccessPasswordModal';
import Notification from '@/components/Notification';
import WorkspaceNav from '@/components/WorkspaceNav';
import { Code2, KeyRound, Settings2 } from 'lucide-react';
import { getConfig, isConfigValid } from '@/lib/config';
import { flashcardStore } from '@/lib/flashcard-store';
import { optimizeExcalidrawCode } from '@/lib/optimizeArrows';
import { historyManager } from '@/lib/history-manager';
import { explanationStore } from '@/lib/explanation-store';
import { repairJsonClosure } from '@/lib/json-repair';
import MermaidCanvas from '@/components/MermaidCanvas';
import LocalDataNotice from '@/components/LocalDataNotice';
import { workspaceRepository } from '@/lib/local-workspace-db';
import { downloadWorkspaceFile, exportWorkspace, importWorkspace } from '@/lib/workspace-file';

// Dynamically import ExcalidrawCanvas to avoid SSR issues
const ExcalidrawCanvas = dynamic(() => import('@/components/ExcalidrawCanvas'), {
  ssr: false,
});

export default function Home() {
  const [config, setConfig] = useState(null);
  const [isConfigManagerOpen, setIsConfigManagerOpen] = useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isAccessPasswordModalOpen, setIsAccessPasswordModalOpen] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [elements, setElements] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplyingCode, setIsApplyingCode] = useState(false);
  const [isOptimizingCode, setIsOptimizingCode] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(25); // Percentage of viewport width
  const [isResizingHorizontal, setIsResizingHorizontal] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [jsonError, setJsonError] = useState(null);
  const [currentInput, setCurrentInput] = useState('');
  const [currentChartType, setCurrentChartType] = useState('auto');
  const [drawingEngine, setDrawingEngine] = useState('excalidraw');
  const [mermaidSource, setMermaidSource] = useState('');
  const [excalidrawSource, setExcalidrawSource] = useState('');
  const [localSaveStatus, setLocalSaveStatus] = useState('saved');
  const [workspaceReady, setWorkspaceReady] = useState(false);
  // 工作模式：draw 图表绘制 | article 文章理解
  const [mode, setMode] = useState('article');
  const [isFlashcardOpen, setIsFlashcardOpen] = useState(false);
  const [dueCount, setDueCount] = useState(0);
  const [usePassword, setUsePassword] = useState(false);
  const [notification, setNotification] = useState({
    isOpen: false,
    title: '',
    message: '',
    type: 'info'
  });

  // Load config on mount and listen for config changes
  useEffect(() => {
    const savedConfig = getConfig();
    if (savedConfig) {
      setConfig(savedConfig);
    }

    // Load password access state
    const passwordEnabled = localStorage.getItem('smart-excalidraw-use-password') === 'true';
    setUsePassword(passwordEnabled);

    // Listen for storage changes to sync across tabs
    const handleStorageChange = (e) => {
      if (e.key === 'smart-excalidraw-active-config' || e.key === 'smart-excalidraw-configs') {
        const newConfig = getConfig();
        setConfig(newConfig);
      }
      if (e.key === 'smart-excalidraw-use-password') {
        const passwordEnabled = localStorage.getItem('smart-excalidraw-use-password') === 'true';
        setUsePassword(passwordEnabled);
      }
    };

    // Listen for custom event from AccessPasswordModal (same tab)
    const handlePasswordSettingsChanged = (e) => {
      setUsePassword(e.detail.usePassword);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('password-settings-changed', handlePasswordSettingsChanged);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('password-settings-changed', handlePasswordSettingsChanged);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restoreWorkspace() {
      try {
        const [drawings, explanations] = await Promise.all([
          workspaceRepository.drawings.list({ index: 'updatedAt', direction: 'prev', limit: 1 }),
          workspaceRepository.explanations.list(),
        ]);
        if (cancelled) return;
        if (drawings[0]) {
          setDrawingEngine(drawings[0].engine || 'excalidraw');
          setGeneratedCode(drawings[0].source || '');
          if (drawings[0].engine === 'mermaid') setMermaidSource(drawings[0].source || '');
          else {
            setExcalidrawSource(drawings[0].source || '');
            tryParseAndApply(drawings[0].source || '');
          }
          setCurrentChartType(drawings[0].chartType || 'auto');
        }
        if (explanations.length > 0) explanationStore.replaceEntries(explanations);
      } catch (error) {
        console.error('Failed to restore local workspace:', error);
        setLocalSaveStatus('error');
      } finally {
        if (!cancelled) setWorkspaceReady(true);
      }
    }
    restoreWorkspace();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!workspaceReady) return undefined;
    setLocalSaveStatus('saving');
    const timer = window.setTimeout(async () => {
      try {
        await workspaceRepository.drawings.save({
          id: 'current-drawing',
          documentId: 'current-document',
          engine: drawingEngine,
          chartType: currentChartType,
          source: generatedCode,
          updatedAt: Date.now(),
        });
        setLocalSaveStatus('saved');
      } catch (error) {
        console.error('Failed to save drawing locally:', error);
        setLocalSaveStatus('error');
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [currentChartType, drawingEngine, generatedCode, workspaceReady]);

  // 跟踪闪卡到期数量，监听卡片库变化（同页签自定义事件）
  useEffect(() => {
    const refreshDueCount = () => setDueCount(flashcardStore.getDueCount());
    refreshDueCount();
    window.addEventListener('flashcards-changed', refreshDueCount);
    return () => window.removeEventListener('flashcards-changed', refreshDueCount);
  }, []);

  // Post-process Excalidraw code: remove markdown wrappers, repair closures, and fix unescaped quotes
  const postProcessExcalidrawCode = (code) => {
    if (!code || typeof code !== 'string') return code;
    
    let processed = code.trim();
    
    // Step 1: Remove markdown code fence wrappers (```json, ```javascript, ```js, or just ```)
    processed = processed.replace(/^```(?:json|javascript|js)?\s*\n?/i, '');
    processed = processed.replace(/\n?```\s*$/, '');
    processed = processed.trim();
    
    // Step 1.5: Repair common JSON closure issues (missing quotes/brackets at end)
    processed = repairJsonClosure(processed);
    
    // Step 2: Fix unescaped double quotes within JSON string values
    // This is a complex task - we need to be careful not to break valid JSON structure
    // Strategy: Parse the JSON structure and fix quotes only in string values
    try {
      // First, try to parse as-is to see if it's already valid
      JSON.parse(processed);
      return processed; // Already valid JSON, no need to fix
    } catch (e) {
      // JSON is invalid, try to fix unescaped quotes
      // This regex finds string values and fixes unescaped quotes within them
      // It looks for: "key": "value with "unescaped" quotes"
      processed = fixUnescapedQuotes(processed);
      // After fixing quotes, attempt a final repair of closures
      processed = repairJsonClosure(processed);
      return processed;
    }
  };

  // Helper function to fix unescaped quotes in JSON strings
  const fixUnescapedQuotes = (jsonString) => {
    let result = '';
    let inString = false;
    let escapeNext = false;
    let currentQuotePos = -1;
    
    for (let i = 0; i < jsonString.length; i++) {
      const char = jsonString[i];
      const prevChar = i > 0 ? jsonString[i - 1] : '';
      
      if (escapeNext) {
        result += char;
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        result += char;
        escapeNext = true;
        continue;
      }
      
      if (char === '"') {
        if (!inString) {
          // Starting a string
          inString = true;
          currentQuotePos = i;
          result += char;
        } else {
          // Potentially ending a string
          // Check if this is a structural quote (followed by : or , or } or ])
          const nextNonWhitespace = jsonString.slice(i + 1).match(/^\s*(.)/);
          const nextChar = nextNonWhitespace ? nextNonWhitespace[1] : '';
          
          if (nextChar === ':' || nextChar === ',' || nextChar === '}' || nextChar === ']' || nextChar === '') {
            // This is a closing quote for the string
            inString = false;
            result += char;
          } else {
            // This is an unescaped quote within the string - escape it
            result += '\\"';
          }
        }
      } else {
        result += char;
      }
    }
    
    return result;
  };

  // Handle sending a message (single-turn)
  const handleSendMessage = async (userMessage, chartType = 'auto', sourceType = 'text', engine = drawingEngine) => {
    const usePassword = typeof window !== 'undefined' && localStorage.getItem('smart-excalidraw-use-password') === 'true';
    const accessPassword = typeof window !== 'undefined' ? localStorage.getItem('smart-excalidraw-access-password') : '';

    if (!usePassword && !isConfigValid(config)) {
      setNotification({
        isOpen: true,
        title: '配置提醒',
        message: '请先配置您的 LLM 提供商或启用访问密码',
        type: 'warning'
      });
      setIsConfigManagerOpen(true);
      return;
    }

    setCurrentInput(userMessage);
    setCurrentChartType(chartType);
    setDrawingEngine(engine);
    setIsGenerating(true);
    setApiError(null); // Clear previous errors
    setJsonError(null); // Clear previous JSON errors

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (usePassword && accessPassword) {
        headers['x-access-password'] = accessPassword;
      }

      // Call generate API with streaming
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          config: usePassword ? null : config,
          userInput: userMessage,
          chartType,
          engine,
        }),
      });

      if (!response.ok) {
        // Parse error response body if available
        let errorMessage = '生成代码失败';
        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage = errorData.error;
          }
        } catch (e) {
          // If response body is not JSON, use status-based messages
          switch (response.status) {
            case 400:
              errorMessage = '请求参数错误，请检查输入内容';
              break;
            case 401:
            case 403:
              errorMessage = 'API 密钥无效或权限不足，请检查配置';
              break;
            case 429:
              errorMessage = '请求过于频繁，请稍后再试';
              break;
            case 500:
            case 502:
            case 503:
              errorMessage = '服务器错误，请稍后重试';
              break;
            default:
              errorMessage = `请求失败 (${response.status})`;
          }
        }
        throw new Error(errorMessage);
      }

      // Process streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedCode = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '' || line.trim() === 'data: [DONE]') continue;

          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                accumulatedCode += data.content;
                const processedCode = engine === 'mermaid'
                  ? accumulatedCode.trim().replace(/^```(?:mermaid)?\s*/i, '').replace(/\s*```$/, '').trim()
                  : postProcessExcalidrawCode(accumulatedCode);
                setGeneratedCode(processedCode);
              } else if (data.error) {
                throw new Error(data.error);
              }
            } catch (e) {
              // SSE parsing errors - show to user
              if (e.message && !e.message.includes('Unexpected')) {
                setApiError('数据流解析错误：' + e.message);
              }
              console.error('Failed to parse SSE:', e);
            }
          }
        }
      }

      let historyCode = '';
      if (engine === 'mermaid') {
        const source = accumulatedCode.trim().replace(/^```(?:mermaid)?\s*/i, '').replace(/\s*```$/, '').trim();
        setGeneratedCode(source);
        setMermaidSource(source);
        historyCode = source;
      } else {
        // Try to parse and apply the Excalidraw code.
        const processedCode = postProcessExcalidrawCode(accumulatedCode);
        tryParseAndApply(processedCode);
        const optimizedCode = optimizeExcalidrawCode(processedCode);
        setGeneratedCode(optimizedCode);
        setExcalidrawSource(optimizedCode);
        tryParseAndApply(optimizedCode);
        historyCode = optimizedCode;
      }

      // Save to history only for text input mode
      if (sourceType === 'text' && userMessage && accumulatedCode) {
        const userInputText = typeof userMessage === 'object' ? (userMessage.text || '') : userMessage;
        historyManager.addHistory({
          chartType,
          userInput: userInputText,
          generatedCode: historyCode,
          engine,
          config: {
            name: config?.name || config?.type,
            model: config?.model
          }
        });
      }
    } catch (error) {
      console.error('Error generating code:', error);
      // Check if it's a network error
      if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
        setApiError('网络连接失败，请检查网络连接');
      } else {
        setApiError(error.message);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // Try to parse and apply code to canvas
  const tryParseAndApply = (code) => {
    try {
      // Clear previous JSON errors
      setJsonError(null);

      // Code is already post-processed, just extract the array and parse
      const cleanedCode = code.trim();

      // Extract array from code if wrapped in other text
      const arrayMatch = cleanedCode.match(/\[[\s\S]*\]/);
      if (!arrayMatch) {
        setJsonError('代码中未找到有效的 JSON 数组');
        console.error('No array found in generated code');
        return;
      }

      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        setElements(parsed);
        setJsonError(null); // Clear error on success
      }
    } catch (error) {
      console.error('Failed to parse generated code:', error);
      // Extract native JSON error message
      if (error instanceof SyntaxError) {
        setJsonError('JSON 语法错误：' + error.message);
      } else {
        setJsonError('解析失败：' + error.message);
      }
    }
  };

  // Handle applying code from editor
  const handleApplyCode = async () => {
    setIsApplyingCode(true);
    try {
      // Simulate async operation for better UX
      await new Promise(resolve => setTimeout(resolve, 300));
      if (drawingEngine === 'mermaid') setMermaidSource(generatedCode);
      else tryParseAndApply(generatedCode);
    } catch (error) {
      console.error('Error applying code:', error);
    } finally {
      setIsApplyingCode(false);
    }
  };

  // Handle optimizing code
  const handleOptimizeCode = async () => {
    setIsOptimizingCode(true);
    try {
      // Simulate async operation for better UX
      await new Promise(resolve => setTimeout(resolve, 500));
      const optimizedCode = optimizeExcalidrawCode(generatedCode);
      setGeneratedCode(optimizedCode);
      tryParseAndApply(optimizedCode);
    } catch (error) {
      console.error('Error optimizing code:', error);
    } finally {
      setIsOptimizingCode(false);
    }
  };

  // Handle clearing code
  const handleClearCode = () => {
    setGeneratedCode('');
    setMermaidSource('');
    setExcalidrawSource('');
    setElements([]);
  };

  const handleEngineChange = (nextEngine) => {
    if (nextEngine === drawingEngine) return;
    if (drawingEngine === 'mermaid') setMermaidSource(generatedCode);
    else setExcalidrawSource(generatedCode);

    const nextSource = nextEngine === 'mermaid' ? mermaidSource : excalidrawSource;
    setDrawingEngine(nextEngine);
    setGeneratedCode(nextSource || '');
    if (nextEngine === 'mermaid') {
      setMermaidSource(nextSource || '');
    } else if (nextSource) {
      tryParseAndApply(nextSource);
    } else {
      setElements([]);
    }
  };

  // Handle config selection from manager
  const handleConfigSelect = (selectedConfig) => {
    if (selectedConfig) {
      setConfig(selectedConfig);
    }
  };

  // Handle applying history
  const handleApplyHistory = (history) => {
    // Ensure userInput is always a string when setting current input
    const userInputText = typeof history.userInput === 'object'
      ? (history.userInput.text || '图片上传生成')
      : history.userInput;

    setCurrentInput(userInputText);
    setCurrentChartType(history.chartType);
    setDrawingEngine(history.engine || 'excalidraw');
    setGeneratedCode(history.generatedCode);
    if (history.engine === 'mermaid') setMermaidSource(history.generatedCode);
    else {
      setExcalidrawSource(history.generatedCode);
      tryParseAndApply(history.generatedCode);
    }
    setMode('draw');
  };

  // 处理概念图：骨架元素直接交给画布组件转换渲染
  const handleShowGraph = (elements) => {
    setGeneratedCode(JSON.stringify(elements, null, 2));
    setJsonError(null);
    setElements(elements);
  };

  // 闪卡库变化后刷新到期徽标
  const handleCardsChanged = () => {
    setDueCount(flashcardStore.getDueCount());
  };

  const saveWorkspaceFile = async () => {
    try {
      setLocalSaveStatus('saving');
      for (const card of flashcardStore.getAll()) {
        await workspaceRepository.reviewStates.save({
          ...card,
          id: card.id,
          documentId: card.documentId || 'current-document',
          dueAt: card.due,
          updatedAt: card.lastReview || card.createdAt || Date.now(),
        });
      }
      for (const entry of explanationStore.exportEntries()) {
        await workspaceRepository.explanations.save({
          ...entry,
          id: entry.key,
          documentId: 'current-document',
          updatedAt: entry.accessedAt || Date.now(),
        });
      }
      const payload = await exportWorkspace(workspaceRepository);
      downloadWorkspaceFile(payload);
      setLocalSaveStatus('saved');
    } catch (error) {
      setLocalSaveStatus('error');
      setNotification({ isOpen: true, title: '保存失败', message: error.message, type: 'error' });
    }
  };

  const openWorkspaceFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.anchorread,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!window.confirm('打开工作区文件会覆盖此浏览器中的当前工作区，是否继续？')) return;
      try {
        setLocalSaveStatus('saving');
        await importWorkspace(workspaceRepository, await file.text(), { replace: true });
        const drawings = await workspaceRepository.drawings.list({
          index: 'updatedAt',
          direction: 'prev',
          limit: 1,
        });
        if (drawings[0]) {
          setDrawingEngine(drawings[0].engine || 'excalidraw');
          setCurrentChartType(drawings[0].chartType || 'auto');
          setGeneratedCode(drawings[0].source || '');
          if (drawings[0].engine === 'mermaid') setMermaidSource(drawings[0].source || '');
          else {
            setExcalidrawSource(drawings[0].source || '');
            tryParseAndApply(drawings[0].source || '');
          }
        }
        const restoredExplanations = await workspaceRepository.explanations.list();
        explanationStore.replaceEntries(restoredExplanations);
        const restoredCards = await workspaceRepository.reviewStates.list();
        if (restoredCards.length > 0) {
          flashcardStore.replaceAll(
            restoredCards.map(({ dueAt, ...card }) => ({ ...card, due: card.due ?? dueAt }))
          );
        }
        setNotification({ isOpen: true, title: '工作区已打开', message: '本地文章与绘图数据已恢复。', type: 'info' });
        setLocalSaveStatus('saved');
      } catch (error) {
        setLocalSaveStatus('error');
        setNotification({ isOpen: true, title: '打开失败', message: error.message, type: 'error' });
      }
    };
    input.click();
  };

  const handleNewArticle = () => {
    setMode('article');
  };

  // Handle horizontal resizing (left panel vs right panel)
  const handleHorizontalMouseDown = (e) => {
    setIsResizingHorizontal(true);
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizingHorizontal) return;
      
      const percentage = (e.clientX / window.innerWidth) * 100;
      
      // 可调节的范围
      setLeftPanelWidth(Math.min(Math.max(percentage, 20), 80));
    };

    const handleMouseUp = () => {
      setIsResizingHorizontal(false);
    };

    if (isResizingHorizontal) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingHorizontal]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#f5f7f6] text-gray-900">
      <WorkspaceNav
        mode={mode}
        dueCount={dueCount}
        onNewArticle={handleNewArticle}
        onModeChange={setMode}
        onFlashcards={() => setIsFlashcardOpen(true)}
        onHistory={() => setIsHistoryModalOpen(true)}
        onConfig={() => setIsConfigManagerOpen(true)}
        onPassword={() => setIsAccessPasswordModalOpen(true)}
        onAbout={() => setIsContactModalOpen(true)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {mode === 'draw' && (
          <>
            <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 md:px-7">
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold text-gray-950">ANCHOR READ</h1>
                <p className="truncate text-xs text-gray-500">专业文档阅读与概念理解工作台</p>
              </div>

              <div className="flex min-w-0 items-center gap-2">
                {(usePassword || (config && isConfigValid(config))) && (
                  <div className="hidden max-w-64 items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 sm:flex">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                    <span className="truncate text-xs font-medium text-emerald-900">
                      {usePassword ? '密码访问已启用' : `${config.name || config.type} · ${config.model}`}
                    </span>
                  </div>
                )}
                <a
                  href="https://github.com/xujinhuan675-cloud/smart-excalidraw-next"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="项目代码"
                  aria-label="项目代码"
                  className="flex h-9 w-9 items-center justify-center rounded border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900"
                >
                  <Code2 size={18} strokeWidth={1.8} aria-hidden="true" />
                </a>
                <LocalDataNotice status={localSaveStatus} onSave={saveWorkspaceFile} onOpen={openWorkspaceFile} />
                <button
                  type="button"
                  onClick={() => setIsAccessPasswordModalOpen(true)}
                  className="hidden h-9 items-center gap-2 rounded border border-gray-200 px-3 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 sm:flex md:hidden lg:flex"
                >
                  <KeyRound size={16} strokeWidth={1.8} aria-hidden="true" />
                  访问密码
                </button>
                <button
                  type="button"
                  onClick={() => setIsConfigManagerOpen(true)}
                  aria-label="管理配置"
                  className="flex h-9 items-center gap-2 rounded bg-gray-900 px-3 text-xs font-medium text-white transition-colors hover:bg-gray-700"
                >
                  <Settings2 size={16} strokeWidth={1.8} aria-hidden="true" />
                  <span className="hidden sm:inline">管理配置</span>
                  <span className="sm:hidden">配置</span>
                </button>
              </div>
            </header>

            <div className="flex min-h-8 shrink-0 items-center border-b border-gray-200 bg-gray-50 px-4 text-[11px] leading-4 text-gray-500 md:px-7">
              数据默认保存在此浏览器，由您自行控制。浏览器数据可能被意外清除，请定期保存工作区文件；调用 AI 时，相关内容会发送给您配置的模型服务。
            </div>
          </>
        )}

        <WorkspaceNav
          mobile
          mode={mode}
          dueCount={dueCount}
          onNewArticle={handleNewArticle}
          onModeChange={setMode}
          onFlashcards={() => setIsFlashcardOpen(true)}
          onHistory={() => setIsHistoryModalOpen(true)}
          onConfig={() => setIsConfigManagerOpen(true)}
          onPassword={() => setIsAccessPasswordModalOpen(true)}
          onAbout={() => setIsContactModalOpen(true)}
        />

      {/* Reader Lab owns the reading DOM; drawing keeps the original split view. */}
      {mode === 'article' ? (
        <main className="min-h-0 flex-1 overflow-hidden">
          <ReaderLabWorkspace embedded />
        </main>
      ) : (
      <main className="flex min-h-0 flex-1 overflow-hidden pb-1">
        <div id="left-panel" style={{ width: `${leftPanelWidth}%` }} className="flex min-w-0 flex-col border-r border-gray-200 bg-white">
          {/* API Error Banner */}
          {apiError && (
            <div className="bg-red-50 border-b border-red-200 px-4 py-3 flex items-start justify-between">
              <div className="flex items-start space-x-2 min-w-0 flex-1">
                <svg className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-red-800">请求失败</p>
                  <p className="text-xs text-red-700 mt-1 break-words">{apiError}</p>
                </div>
              </div>
              <button
                onClick={() => setApiError(null)}
                className="text-red-600 hover:text-red-800 transition-colors"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          )}

          <div style={{ height: '50%' }} className="overflow-auto">
            <Chat
              onSendMessage={handleSendMessage}
              isGenerating={isGenerating}
              initialInput={currentInput}
              initialChartType={currentChartType}
              initialEngine={drawingEngine}
              onEngineChange={handleEngineChange}
            />
          </div>

          <div style={{ height: '50%' }} className="overflow-hidden">
            <CodeEditor
              code={generatedCode}
              onChange={setGeneratedCode}
              onApply={handleApplyCode}
              onOptimize={handleOptimizeCode}
              onClear={handleClearCode}
              jsonError={jsonError}
              onClearJsonError={() => setJsonError(null)}
              isGenerating={isGenerating}
              isApplyingCode={isApplyingCode}
              isOptimizingCode={isOptimizingCode}
              engine={drawingEngine}
            />
          </div>
        </div>

        {/* Horizontal Resizer */}
        <div
          onMouseDown={handleHorizontalMouseDown}
          className="w-1 bg-gray-200 hover:bg-gray-400 cursor-col-resize transition-colors duration-200 flex-shrink-0"
        />

        {/* Right Panel - Excalidraw Canvas */}
        <div style={{ width: `${100 - leftPanelWidth}%` }} className="bg-gray-50">
          {drawingEngine === 'mermaid' ? (
            <MermaidCanvas source={mermaidSource || generatedCode} title="Mermaid 绘图" />
          ) : (
            <ExcalidrawCanvas
              elements={elements}
              onElementsChange={(nextElements) => {
                setElements(nextElements);
                const source = JSON.stringify(nextElements, null, 2);
                setGeneratedCode(source);
                setExcalidrawSource(source);
              }}
            />
          )}
        </div>
        </main>
        )}
      </div>

      {/* Config Manager Modal */}
      <ConfigManager
        isOpen={isConfigManagerOpen}
        onClose={() => setIsConfigManagerOpen(false)}
        onConfigSelect={handleConfigSelect}
      />

      {/* History Modal */}
      <HistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        onApply={handleApplyHistory}
      />

      {/* Flashcard Review Modal */}
      <FlashcardReview
        isOpen={isFlashcardOpen}
        onClose={() => {
          setIsFlashcardOpen(false);
          handleCardsChanged();
        }}
        onStatsChanged={handleCardsChanged}
      />

      {/* Access Password Modal */}
      <AccessPasswordModal
        isOpen={isAccessPasswordModalOpen}
        onClose={() => setIsAccessPasswordModalOpen(false)}
      />

      {/* Contact Modal */}
      <ContactModal
        isOpen={isContactModalOpen}
        onClose={() => setIsContactModalOpen(false)}
      />

      {/* Notification */}
      <Notification
        isOpen={notification.isOpen}
        onClose={() => setNotification({ ...notification, isOpen: false })}
        title={notification.title}
        message={notification.message}
        type={notification.type}
      />

    </div>
  );
}
