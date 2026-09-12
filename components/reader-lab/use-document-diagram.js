'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { historyManager } from '@/lib/history-manager';
import { getConfig, isConfigValid } from '@/lib/config';
import {
  buildDocumentDiagramMessage,
  createDocumentDrawingId,
  finalizeDiagramSource,
  parseExcalidrawElements,
  postProcessExcalidrawCode,
} from '@/lib/diagram-generation';
import {
  normalizeExcalidrawScene,
  normalizeExcalidrawSceneForPersistence,
  parseExcalidrawScene,
} from '@/lib/excalidraw-scene';
import {
  mergeCanvasAppStateForPersistence,
  normalizePersistedExcalidrawAppState,
} from '@/lib/excalidraw-app-state';
import {
  commitDiagramScene,
  createDiagramRevision,
  getDiagramRevision,
  restoreDiagramRevision,
} from '@/lib/diagram-scene-record';
import { createDiagramMetadata, DIAGRAM_SCOPES, switchDiagramVariant } from '@/lib/diagram-product';
import { parseStreamSnapshot } from '@/lib/diagram-stream';
import { stripMermaidFence } from '@/lib/mermaid-prompts';
import { convertMermaidToExcalidrawScene } from '@/lib/mermaid-excalidraw';

// 文档关系图的共享状态：左侧画布区与右侧对话区共用同一份状态，
// 由 ReaderLabWorkspace 实例化一次后分别注入两个区域。
export function useDocumentDiagram({
  document,
  activeDrawing,
  anchor = null,
  onCreateDrawing,
  onPersistDrawing,
  onClearAnchor,
  onNotice,
}) {
  const initialExcalidrawScene = (() => {
    if (activeDrawing?.engine !== 'excalidraw') {
      return normalizeExcalidrawScene([]);
    }
    try {
      return parseExcalidrawScene(activeDrawing.scene || activeDrawing.variants?.excalidraw?.scene || activeDrawing.source || []);
    } catch {
      return normalizeExcalidrawScene([]);
    }
  })();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isConvertingMermaid, setIsConvertingMermaid] = useState(false);
  const [isApplyingCode, setIsApplyingCode] = useState(false);
  const [isOptimizingCode, setIsOptimizingCode] = useState(false);
  // 默认引擎为 Mermaid：存量图解按自身 engine 恢复，无记录时兜底 mermaid
  const [engine, setEngine] = useState(activeDrawing?.engine || 'mermaid');
  const [chartType, setChartType] = useState(activeDrawing?.chartType || 'auto');
  const [code, setCode] = useState(activeDrawing?.source || '');
  const [elements, setElements] = useState(() => {
    return initialExcalidrawScene.elements;
  });
  const [appState, setAppState] = useState(() => normalizePersistedExcalidrawAppState(initialExcalidrawScene.appState));
  const [files, setFiles] = useState(() => initialExcalidrawScene.files);
  const [revisionHistory, setRevisionHistory] = useState(() => (
    Array.isArray(activeDrawing?.revisionHistory) ? activeDrawing.revisionHistory : []
  ));
  const [presentation, setPresentation] = useState(() => activeDrawing?.presentation || activeDrawing?.presentationSpec || null);
  const [presentationDisabled, setPresentationDisabled] = useState(() => activeDrawing?.presentationDisabled === true);
  // 流式生成预览：SSE 增量解析出的可绘制元素，画布侧逐个显现且不回写持久化
  const [streamElements, setStreamElements] = useState(null);
  const [externalSceneRevision, setExternalSceneRevision] = useState(0);
  const [error, setError] = useState('');
  const saveTimerRef = useRef(null);
  const draftDrawingRef = useRef(activeDrawing);
  const mermaidConversionSeqRef = useRef(0);

  const applyExternalDrawing = useCallback((nextDrawing, { force = false } = {}) => {
    const currentDrawing = draftDrawingRef.current || activeDrawing;
    if (!nextDrawing?.id || nextDrawing.id !== currentDrawing?.id) return false;
    if (!force && getDiagramRevision(nextDrawing) <= getDiagramRevision(currentDrawing)) return false;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    mermaidConversionSeqRef.current += 1;
    setIsConvertingMermaid(false);
    draftDrawingRef.current = nextDrawing;
    setEngine(nextDrawing.engine || 'mermaid');
    setChartType(nextDrawing.chartType || 'auto');
    setCode(nextDrawing.source || '');
    const nextScene = nextDrawing.engine === 'excalidraw'
      ? (() => {
        try {
          return parseExcalidrawScene(nextDrawing.scene || nextDrawing.variants?.excalidraw?.scene || nextDrawing.source || []);
        } catch { return normalizeExcalidrawScene([]); }
      })()
      : normalizeExcalidrawScene([]);
    setElements(nextScene.elements);
    setAppState(normalizePersistedExcalidrawAppState(nextScene.appState));
    setFiles(nextScene.files);
    setRevisionHistory(Array.isArray(nextDrawing.revisionHistory) ? nextDrawing.revisionHistory : []);
    setPresentation(nextDrawing.presentation || nextDrawing.presentationSpec || null);
    setPresentationDisabled(nextDrawing.presentationDisabled === true);
    setExternalSceneRevision((revision) => revision + 1);
    return true;
  }, [activeDrawing]);

  useEffect(() => {
    const isOwnPersistenceEcho = activeDrawing?.id
      && activeDrawing.id === draftDrawingRef.current?.id
      && activeDrawing.updatedAt === draftDrawingRef.current?.updatedAt
      && getDiagramRevision(activeDrawing) === getDiagramRevision(draftDrawingRef.current);
    if (isOwnPersistenceEcho) return;
    mermaidConversionSeqRef.current += 1;
    setIsConvertingMermaid(false);
    draftDrawingRef.current = activeDrawing;
    setEngine(activeDrawing?.engine || 'mermaid');
    setChartType(activeDrawing?.chartType || 'auto');
    setCode(activeDrawing?.source || '');
    const nextScene = activeDrawing?.engine === 'excalidraw'
      ? (() => {
        try {
          return parseExcalidrawScene(activeDrawing.scene || activeDrawing.variants?.excalidraw?.scene || activeDrawing.source || []);
        } catch { return normalizeExcalidrawScene([]); }
      })()
      : normalizeExcalidrawScene([]);
    setElements(nextScene.elements);
    setAppState(normalizePersistedExcalidrawAppState(nextScene.appState));
    setFiles(nextScene.files);
    setRevisionHistory(Array.isArray(nextDrawing?.revisionHistory) ? nextDrawing.revisionHistory : []);
    setPresentation(nextDrawing?.presentation || nextDrawing?.presentationSpec || null);
    setPresentationDisabled(nextDrawing?.presentationDisabled === true);
  }, [activeDrawing]);

  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
  }, []);

  const persistCurrent = useCallback((changes = {}) => {
    if (!activeDrawing) return;
    const recordChanges = { ...changes };
    const requestedVariants = recordChanges.variants;
    delete recordChanges.variants;
    delete recordChanges.elements;
    delete recordChanges.appState;
    delete recordChanges.files;
    delete recordChanges.scene;
    const baseDrawing = draftDrawingRef.current?.id === activeDrawing.id
      ? draftDrawingRef.current
      : activeDrawing;
    const nextEngine = changes.engine || engine;
    const nextSource = changes.source ?? code;
    const nextElements = changes.elements ?? elements;
    const nextAppState = normalizePersistedExcalidrawAppState(changes.appState ?? appState);
    const nextFiles = changes.files ?? files;
    const nextScene = nextEngine === 'excalidraw'
      ? normalizeExcalidrawScene({
        elements: nextElements,
        appState: nextAppState,
        files: nextFiles,
      })
      : null;
    const now = Date.now();
    const shouldCommitScene = Boolean(
      nextScene
      && (Object.hasOwn(changes, 'elements')
        || Object.hasOwn(changes, 'appState')
        || Object.hasOwn(changes, 'files')),
    );
    let next;
    if (shouldCommitScene) {
      const metadataChanges = { ...recordChanges };
      delete metadataChanges.engine;
      delete metadataChanges.renderer;
      delete metadataChanges.source;
      next = commitDiagramScene(baseDrawing, nextScene, {
        expectedRevision: getDiagramRevision(baseDrawing),
        author: 'user',
        reason: changes.reason || 'edit',
        now,
      });
      next = {
        ...next,
        chartType: changes.chartType || chartType,
        ...metadataChanges,
        updatedAt: now,
      };
      if (requestedVariants && typeof requestedVariants === 'object') {
        next.variants = Object.entries(requestedVariants).reduce(
          (merged, [renderer, variant]) => ({
            ...merged,
            [renderer]: { ...(merged[renderer] || {}), ...(variant || {}) },
          }),
          next.variants || {},
        );
      }
    } else {
      next = {
        ...baseDrawing,
        engine: nextEngine,
        chartType: changes.chartType || chartType,
        source: nextSource,
        scene: nextScene,
        variants: {
          ...(baseDrawing.variants || {}),
          [nextEngine]: {
            source: nextSource,
            ...(nextScene ? { scene: nextScene } : {}),
            chartType: changes.chartType || chartType,
            updatedAt: now,
          },
        },
        ...recordChanges,
        updatedAt: now,
      };
      if (requestedVariants && typeof requestedVariants === 'object') {
        next.variants = Object.entries(requestedVariants).reduce(
          (merged, [renderer, variant]) => ({
            ...merged,
            [renderer]: { ...(merged[renderer] || {}), ...(variant || {}) },
          }),
          next.variants || {},
        );
      }
    }
    draftDrawingRef.current = next;
    setRevisionHistory(Array.isArray(next.revisionHistory) ? next.revisionHistory : []);
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    const expectedRevision = getDiagramRevision(baseDrawing);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      Promise.resolve(onPersistDrawing(next, { expectedRevision })).catch((caughtError) => {
        if (caughtError?.code === 'REVISION_CONFLICT' && caughtError.latestDrawing) {
          applyExternalDrawing(caughtError.latestDrawing, { force: true });
        }
        setError(caughtError?.message || '图解保存失败。');
      });
    }, 400);
  }, [activeDrawing, appState, applyExternalDrawing, chartType, code, elements, engine, files, onPersistDrawing]);

  // anchorOverride：划词图解不跳转，锚点在同一次调用里随参数传入，
  // 不等 hook 的 anchor prop 下一帧生效
  const generate = useCallback(async (message, nextChartType, sourceType, nextEngine, anchorOverride = null, generationOptions = {}) => {
    if (isGenerating || !document) return;
    const effectiveAnchor = anchorOverride || anchor;
    setIsGenerating(true);
    setError('');
    try {
      const usePassword = typeof window !== 'undefined' && localStorage.getItem('smart-excalidraw-use-password') === 'true';
      const accessPassword = typeof window !== 'undefined' ? localStorage.getItem('smart-excalidraw-access-password') : '';
      const config = getConfig();
      if (!usePassword && !isConfigValid(config)) {
        // AI 生成依赖模型配置：未配置时直接报错；独立画布仍可自由手绘
        throw new Error(document?.standaloneDiagram
          ? '未配置 LLM：AI 图解不可用，可直接在画布上自由绘制。'
          : '未检测到可用模型配置，请先在设置中配置模型后再生成图解。');
      }
      // 锚定选区时让模型重点围绕该段落建模
      const anchoredMessage = effectiveAnchor && typeof message === 'string'
        ? `${message}\n\n请重点围绕以下原文段落建模：「${effectiveAnchor.source}」`
        : message;
      setEngine(nextEngine);
      setChartType(nextChartType);
      const headers = { 'Content-Type': 'application/json' };
      if (usePassword && accessPassword) headers['x-access-password'] = accessPassword;
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          config: usePassword ? null : config,
          userInput: buildDocumentDiagramMessage(anchoredMessage, document),
          chartType: nextChartType,
          engine: nextEngine,
        }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `图解生成失败 (${response.status})`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ') || line.trim() === 'data: [DONE]') continue;
          const data = JSON.parse(line.slice(6));
          if (data.error) throw new Error(data.error);
          if (data.content) {
            accumulated += data.content;
            setCode(nextEngine === 'mermaid' ? stripMermaidFence(accumulated) : postProcessExcalidrawCode(accumulated));
            if (nextEngine === 'excalidraw') {
              // 实时渐进渲染：部分 JSON 容错解析后推给画布逐个显现；
              // 元素数未变的 chunk 复用旧引用避免无谓重渲染
              const snapshot = parseStreamSnapshot(accumulated);
              setStreamElements((previous) => (previous && previous.length === snapshot.length ? previous : snapshot));
            }
          }
        }
      }
      const finalCode = finalizeDiagramSource(nextEngine, accumulated);
      setStreamElements(null);
      const nextElements = nextEngine === 'excalidraw' ? parseExcalidrawElements(finalCode) : [];
      const nextScene = nextEngine === 'excalidraw'
        ? normalizeExcalidrawScene({ elements: nextElements })
        : null;
      const scope = generationOptions.scope
        || (effectiveAnchor ? DIAGRAM_SCOPES.selection : document?.standaloneDiagram ? DIAGRAM_SCOPES.freeform : DIAGRAM_SCOPES.articleOverview);
      const metadata = createDiagramMetadata({
        scope,
        intent: generationOptions.intent || nextChartType,
        renderer: nextEngine,
        diagramSpec: generationOptions.diagramSpec || null,
      });
      const titlePrefix = scope === DIAGRAM_SCOPES.articleDeep
        ? '深度图解'
        : scope === DIAGRAM_SCOPES.articleOverview
          ? '全文概览'
          : scope === DIAGRAM_SCOPES.selection
            ? '局部图解'
          : (nextChartType || '图解');
      const drawingId = createDocumentDrawingId(document.id);
      const generatedRevision = nextScene
        ? createDiagramRevision({
          drawingId,
          revision: 1,
          scene: nextScene,
          author: 'agent',
          reason: 'generate',
        })
        : null;
      const drawing = {
        id: drawingId,
        documentId: document.id,
        title: `${titlePrefix} · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
        ...metadata,
        source: finalCode,
        ...(nextScene ? { scene: nextScene } : {}),
        ...(generatedRevision ? { revision: 1, revisionHistory: [generatedRevision] } : {}),
        variants: {
          [nextEngine]: {
            source: finalCode,
            ...(nextScene ? { scene: nextScene } : {}),
            chartType: metadata.chartType,
            updatedAt: Date.now(),
          },
        },
        prompt: typeof message === 'string' ? message : message?.text || '',
        anchor: effectiveAnchor ? { from: effectiveAnchor.from, to: effectiveAnchor.to, source: effectiveAnchor.source } : null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setCode(finalCode);
      setElements(nextElements);
      setAppState(normalizePersistedExcalidrawAppState(nextScene?.appState));
      setFiles(nextScene?.files || {});
      setRevisionHistory(generatedRevision ? [generatedRevision] : []);
      await onCreateDrawing(drawing);
      onClearAnchor?.();
      historyManager.addHistory({
        documentId: document.id,
        drawingId: drawing.id,
        chartType: nextChartType,
        userInput: drawing.prompt,
        generatedCode: finalCode,
        engine: nextEngine,
      });
      onNotice?.({ type: 'success', message: document?.standaloneDiagram ? '图解已保存到自由画布。' : '图解已保存到当前文档。' });
    } catch (caughtError) {
      setError(caughtError.message || '图解生成失败。');
      onNotice?.({ type: 'error', message: caughtError.message || '图解生成失败。' });
    } finally {
      setStreamElements(null);
      setIsGenerating(false);
    }
  }, [document, isGenerating, anchor, onCreateDrawing, onClearAnchor, onNotice]);

  const handleApply = async () => {
    setIsApplyingCode(true);
    try {
      const nextElements = engine === 'excalidraw' ? parseExcalidrawElements(code) : [];
      setElements(nextElements);
      persistCurrent({ source: code, elements: nextElements });
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsApplyingCode(false);
    }
  };

  const handleOptimize = async () => {
    setIsOptimizingCode(true);
    try {
      const optimized = finalizeDiagramSource('excalidraw', code);
      setCode(optimized);
      const nextElements = parseExcalidrawElements(optimized);
      setElements(nextElements);
      persistCurrent({ engine: 'excalidraw', source: optimized, elements: nextElements });
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsOptimizingCode(false);
    }
  };

  const handleEngineChange = async (nextEngine) => {
    if (nextEngine === engine) return;
    const conversionSequence = mermaidConversionSeqRef.current + 1;
    mermaidConversionSeqRef.current = conversionSequence;
    setIsConvertingMermaid(false);
    const nextVariant = switchDiagramVariant({
      drawing: draftDrawingRef.current || activeDrawing,
      currentRenderer: engine,
      currentSource: code,
      currentScene: engine === 'excalidraw' ? { elements, appState, files } : null,
      currentChartType: chartType,
      nextRenderer: nextEngine,
    });
    setEngine(nextVariant.engine);
    setChartType(nextVariant.chartType);
    setCode(nextVariant.source);
    let nextElements = [];
    let nextAppState = normalizeExcalidrawScene([]).appState;
    let nextFiles = {};
    let nextSource = nextVariant.source;
    if (nextVariant.engine === 'excalidraw' && (nextVariant.scene || nextVariant.source)) {
      try {
        const nextScene = parseExcalidrawScene(nextVariant.scene || nextVariant.source);
        nextElements = nextScene.elements;
        nextAppState = nextScene.appState;
        nextFiles = nextScene.files;
      } catch {
        nextElements = [];
      }
    }
    if (nextVariant.engine === 'excalidraw' && nextElements.length > 0) {
      // 场景是 Excalidraw 变体的事实来源；旧记录可能只有 scene 没有 source。
      nextSource = JSON.stringify(nextElements, null, 2);
    }
    // A Mermaid variant has no Excalidraw JSON until the user first switches
    // renderers. Convert it with the official browser converter instead of
    // leaving the target variant empty. Existing target scenes always win.
    const shouldConvertMermaid = nextVariant.engine === 'excalidraw'
      && nextElements.length === 0
      && engine === 'mermaid'
      && typeof code === 'string'
      && code.trim();
    if (shouldConvertMermaid) {
      setIsConvertingMermaid(true);
      try {
        const converted = await convertMermaidToExcalidrawScene(code, {
          baseScene: normalizeExcalidrawScene([]),
          idPrefix: activeDrawing?.id || 'mermaid',
        });
        if (mermaidConversionSeqRef.current !== conversionSequence) return;
        nextElements = converted.scene.elements;
        nextAppState = converted.scene.appState;
        nextFiles = converted.scene.files;
        nextSource = JSON.stringify(nextElements, null, 2);
      } catch (caughtError) {
        if (mermaidConversionSeqRef.current !== conversionSequence) return;
        setError(caughtError?.message || 'Mermaid 转 Excalidraw 失败。');
        // 转换失败时保留原 Mermaid 视图，避免把空场景写入目标变体。
        setEngine(engine);
        setChartType(chartType);
        setCode(code);
        return;
      } finally {
        if (mermaidConversionSeqRef.current === conversionSequence) setIsConvertingMermaid(false);
      }
    }
    if (mermaidConversionSeqRef.current !== conversionSequence) return;
    setCode(nextSource);
    setElements(nextElements);
    const persistedAppState = normalizePersistedExcalidrawAppState(nextAppState);
    setAppState(persistedAppState);
    setFiles(nextFiles);
    const nextVariants = {
      ...nextVariant.variants,
      [nextVariant.engine]: {
        ...(nextVariant.variants?.[nextVariant.engine] || {}),
        source: nextSource,
        chartType: nextVariant.chartType,
        updatedAt: Date.now(),
        ...(nextVariant.engine === 'excalidraw'
          ? { scene: { elements: nextElements, appState: persistedAppState, files: nextFiles } }
          : {}),
      },
    };
    persistCurrent({
      engine: nextVariant.engine,
      source: nextSource,
      chartType: nextVariant.chartType,
      elements: nextElements,
      appState: persistedAppState,
      files: nextFiles,
      variants: nextVariants,
    });
  };

  const changeChartType = (nextChartType) => {
    setChartType(nextChartType);
    persistCurrent({ chartType: nextChartType });
  };

  const changeCode = (nextCode) => {
    setCode(nextCode);
    persistCurrent({ source: nextCode });
  };

  const clearCode = () => {
    setCode('');
    setElements([]);
    setAppState(normalizePersistedExcalidrawAppState(normalizeExcalidrawScene([]).appState));
    setFiles({});
    persistCurrent({ source: '', elements: [], appState: normalizeExcalidrawScene([]).appState, files: {} });
  };

  const changeElements = (nextElements) => {
    const source = JSON.stringify(nextElements, null, 2);
    setElements(nextElements);
    // Excalidraw 会在初始化/规范化时重复触发 onChange，内容未变时不再回写，避免持久化循环
    if (source !== code) {
      setCode(source);
      persistCurrent({ source, elements: nextElements });
    }
  };

  // Excalidraw 运行时协作字段每次回调都会变化（versionNonce/updated/seed 等），
  // 全量 JSON 比较永远不等，会把无变化的场景反复入库产生修订风暴。
  const ELEMENT_RUNTIME_FIELDS = ['versionNonce', 'updated', 'seed'];
  const stableElementKey = (element) => {
    if (!element || typeof element !== 'object') return JSON.stringify(element);
    const cleaned = { ...element };
    for (const key of ELEMENT_RUNTIME_FIELDS) delete cleaned[key];
    return JSON.stringify(cleaned);
  };
  const stableElementsEqual = (left, right) => (
    Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((element, index) => stableElementKey(element) === stableElementKey(right[index]))
  );

  const changeScene = (nextScene) => {
    const normalized = normalizeExcalidrawSceneForPersistence(nextScene);
    // Runtime interaction state must not turn a pan or selection into a persisted update.
    const current = normalizeExcalidrawScene({ elements, appState, files });
    const currentAppState = normalizePersistedExcalidrawAppState(current.appState);
    const persistedAppState = mergeCanvasAppStateForPersistence(currentAppState, normalized.appState);
    if (stableElementsEqual(normalized.elements, current.elements)
      && JSON.stringify(persistedAppState) === JSON.stringify(currentAppState)
      && JSON.stringify(normalized.files) === JSON.stringify(current.files)) return;
    const source = JSON.stringify(normalized.elements, null, 2);
    setElements(normalized.elements);
    setAppState(persistedAppState);
    setFiles(normalized.files);
    setCode(source);
    persistCurrent({
      source,
      elements: normalized.elements,
      appState: persistedAppState,
      files: normalized.files,
    });
  };

  // 本地 .excalidraw 导入从 Excalidraw 原生主菜单触发。导入后切换到
  // Excalidraw 引擎并提交完整场景，避免把自由图解元素误写进 Mermaid 记录。
  const importExcalidrawScene = (value) => {
    const normalized = normalizeExcalidrawScene(value);
    const persistedAppState = normalizePersistedExcalidrawAppState(normalized.appState);
    const source = JSON.stringify(normalized.elements, null, 2);
    setEngine('excalidraw');
    setElements(normalized.elements);
    setAppState(persistedAppState);
    setFiles(normalized.files);
    setCode(source);
    setError('');
    persistCurrent({
      engine: 'excalidraw',
      renderer: 'excalidraw',
      source,
      elements: normalized.elements,
      appState: persistedAppState,
      files: normalized.files,
      reason: 'import',
    });
  };

  const restoreRevision = useCallback((revisionOrId) => {
    const baseDrawing = draftDrawingRef.current || activeDrawing;
    if (!baseDrawing || engine !== 'excalidraw') return;
    try {
      const next = restoreDiagramRevision(baseDrawing, revisionOrId, {
        expectedRevision: getDiagramRevision(baseDrawing),
        author: 'user',
        now: Date.now(),
      });
      draftDrawingRef.current = next;
      setElements(next.scene.elements);
      setAppState(normalizePersistedExcalidrawAppState(next.scene.appState));
      setFiles(next.scene.files);
      setCode(next.source);
      setRevisionHistory(next.revisionHistory || []);
      Promise.resolve(onPersistDrawing(next, { expectedRevision: getDiagramRevision(baseDrawing) })).catch((caughtError) => {
        if (caughtError?.code === 'REVISION_CONFLICT' && caughtError.latestDrawing) {
          applyExternalDrawing(caughtError.latestDrawing, { force: true });
        }
        setError(caughtError?.message || '图解版本恢复失败。');
      });
    } catch (caughtError) {
      setError(caughtError.message || '图解版本恢复失败。');
    }
  }, [activeDrawing, applyExternalDrawing, engine, onPersistDrawing]);

  return {
    drawingId: (draftDrawingRef.current || activeDrawing)?.id || null,
    engine,
    chartType,
    setChartType: changeChartType,
    code,
    elements,
    appState,
    files,
    revision: getDiagramRevision(draftDrawingRef.current || activeDrawing),
    revisionHistory,
    presentation,
    presentationDisabled,
    streamElements,
    externalSceneRevision,
    applyExternalDrawing,
    error,
    setError,
    isGenerating,
    isApplyingCode,
    isOptimizingCode,
    isConvertingMermaid,
    generate,
    handleApply,
    handleOptimize,
    handleEngineChange,
    changeCode,
    clearCode,
    changeElements,
    changeScene,
    importExcalidrawScene,
    restoreRevision,
  };
}
