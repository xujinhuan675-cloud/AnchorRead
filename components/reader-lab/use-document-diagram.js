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
import { stripMermaidFence } from '@/lib/mermaid-prompts';

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
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplyingCode, setIsApplyingCode] = useState(false);
  const [isOptimizingCode, setIsOptimizingCode] = useState(false);
  const [engine, setEngine] = useState(activeDrawing?.engine || 'excalidraw');
  const [chartType, setChartType] = useState(activeDrawing?.chartType || 'auto');
  const [code, setCode] = useState(activeDrawing?.source || '');
  const [elements, setElements] = useState(() => {
    try { return activeDrawing?.engine === 'excalidraw' ? parseExcalidrawElements(activeDrawing.source) : []; } catch { return []; }
  });
  const [error, setError] = useState('');
  const saveTimerRef = useRef(null);

  useEffect(() => {
    setEngine(activeDrawing?.engine || 'excalidraw');
    setChartType(activeDrawing?.chartType || 'auto');
    setCode(activeDrawing?.source || '');
    try {
      setElements(activeDrawing?.engine === 'excalidraw' ? parseExcalidrawElements(activeDrawing.source) : []);
    } catch {
      setElements([]);
    }
  }, [activeDrawing]);

  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
  }, []);

  const persistCurrent = useCallback((changes = {}) => {
    if (!activeDrawing) return;
    const next = {
      ...activeDrawing,
      engine,
      chartType,
      source: code,
      ...changes,
      updatedAt: Date.now(),
    };
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => onPersistDrawing(next), 400);
  }, [activeDrawing, chartType, code, engine, onPersistDrawing]);

  const generate = useCallback(async (message, nextChartType, sourceType, nextEngine) => {
    if (isGenerating || !document) return;
    setIsGenerating(true);
    setError('');
    try {
      const usePassword = typeof window !== 'undefined' && localStorage.getItem('smart-excalidraw-use-password') === 'true';
      const accessPassword = typeof window !== 'undefined' ? localStorage.getItem('smart-excalidraw-access-password') : '';
      const config = getConfig();
      if (!usePassword && !isConfigValid(config)) {
        throw new Error('请先配置 LLM 提供商，或启用访问密码。');
      }
      // 锚定选区时让模型重点围绕该段落建模
      const anchoredMessage = anchor && typeof message === 'string'
        ? `${message}\n\n请重点围绕以下原文段落建模：「${anchor.source}」`
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
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `图表生成失败 (${response.status})`);

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
          }
        }
      }
      const finalCode = finalizeDiagramSource(nextEngine, accumulated);
      const nextElements = nextEngine === 'excalidraw' ? parseExcalidrawElements(finalCode) : [];
      const drawing = {
        id: createDocumentDrawingId(document.id),
        documentId: document.id,
        title: `${nextChartType || '关系图'} · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
        engine: nextEngine,
        chartType: nextChartType,
        source: finalCode,
        prompt: typeof message === 'string' ? message : message?.text || '',
        anchor: anchor ? { from: anchor.from, to: anchor.to, source: anchor.source } : null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setCode(finalCode);
      setElements(nextElements);
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
      onNotice?.({ type: 'success', message: '图表已保存到当前文档。' });
    } catch (caughtError) {
      setError(caughtError.message || '图表生成失败。');
      onNotice?.({ type: 'error', message: caughtError.message || '图表生成失败。' });
    } finally {
      setIsGenerating(false);
    }
  }, [document, isGenerating, anchor, onCreateDrawing, onClearAnchor, onNotice]);

  const handleApply = async () => {
    setIsApplyingCode(true);
    try {
      const nextElements = engine === 'excalidraw' ? parseExcalidrawElements(code) : [];
      setElements(nextElements);
      persistCurrent({ source: code });
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
      setElements(parseExcalidrawElements(optimized));
      persistCurrent({ engine: 'excalidraw', source: optimized });
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsOptimizingCode(false);
    }
  };

  const handleEngineChange = (nextEngine) => {
    if (nextEngine === engine) return;
    setEngine(nextEngine);
    setCode('');
    setElements([]);
    persistCurrent({ engine: nextEngine, source: '' });
  };

  const changeCode = (nextCode) => {
    setCode(nextCode);
    persistCurrent({ source: nextCode });
  };

  const clearCode = () => {
    setCode('');
    setElements([]);
    persistCurrent({ source: '' });
  };

  const changeElements = (nextElements) => {
    const source = JSON.stringify(nextElements, null, 2);
    setElements(nextElements);
    // Excalidraw 会在初始化/规范化时重复触发 onChange，内容未变时不再回写，避免持久化循环
    if (source !== code) {
      setCode(source);
      persistCurrent({ source });
    }
  };

  return {
    engine,
    chartType,
    code,
    elements,
    error,
    setError,
    isGenerating,
    isApplyingCode,
    isOptimizingCode,
    generate,
    handleApply,
    handleOptimize,
    handleEngineChange,
    changeCode,
    clearCode,
    changeElements,
  };
}
