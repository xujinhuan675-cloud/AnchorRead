'use client';

import { useMemo, useRef, useState } from 'react';
import DocumentReader from '@/components/DocumentReader';
import ExcalidrawCanvas from '@/components/ExcalidrawCanvas';
import MermaidConceptView from '@/components/MermaidConceptView';
import { isConfigValid } from '@/lib/config';
import { HIGHLIGHT_LEVELS } from '@/lib/article-prompts';
import { locateHighlights } from '@/lib/highlight-matcher';
import { buildConceptGraph } from '@/lib/concept-graph';
import { flashcardStore } from '@/lib/flashcard-store';
import { SAMPLE_ARTICLES } from '@/lib/sample-articles';
import {
  ArrowRight,
  Brain,
  FileText,
  FileUp,
  GitBranch,
  Pencil,
  Sparkles,
  Trash2,
} from 'lucide-react';

const EMPTY_CONCEPT_DATA = { concepts: [], relations: [] };
const SAMPLE_META = {
  'payment-idempotency': { label: 'API 设计', accent: 'bg-blue-100 text-blue-700' },
  'rag-acceptance': { label: 'AI 工程', accent: 'bg-emerald-100 text-emerald-700' },
  'fsrs-memory': { label: '记忆科学', accent: 'bg-amber-100 text-amber-800' },
};

export default function ArticlePanel({
  config,
  onShowGraph,
  onCardsChanged,
  notify,
  onRequireConfig,
  graphElements = [],
}) {
  const [articleTitle, setArticleTitle] = useState('');
  const [articleText, setArticleText] = useState('');
  const [summary, setSummary] = useState('');
  const [highlights, setHighlights] = useState([]);
  const [selectedHighlight, setSelectedHighlight] = useState(null);
  const [conceptData, setConceptData] = useState(EMPTY_CONCEPT_DATA);
  const [activeTab, setActiveTab] = useState('reader');
  const [busyAction, setBusyAction] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const located = useMemo(
    () => locateHighlights(articleText, highlights),
    [articleText, highlights]
  );
  const hasAnalysis = highlights.length > 0;
  const hasConceptGraph = conceptData.concepts.length > 0;
  const isBusy = busyAction !== null;

  const resetDerivedContent = () => {
    setHighlights([]);
    setSummary('');
    setSelectedHighlight(null);
    setConceptData(EMPTY_CONCEPT_DATA);
    setActiveTab('reader');
    setError(null);
  };

  const callArticleApi = async (url, payload) => {
    const usePassword =
      typeof window !== 'undefined' &&
      localStorage.getItem('smart-excalidraw-use-password') === 'true';
    const accessPassword =
      typeof window !== 'undefined'
        ? localStorage.getItem('smart-excalidraw-access-password')
        : '';

    const headers = { 'Content-Type': 'application/json' };
    if (usePassword && accessPassword) {
      headers['x-access-password'] = accessPassword;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...payload,
        config: usePassword ? null : config,
      }),
    });

    if (!response.ok) {
      let message = `请求失败 (${response.status})`;
      try {
        const data = await response.json();
        if (data.error) message = data.error;
      } catch {
        // 非 JSON 响应时保留默认错误信息。
      }
      throw new Error(message);
    }

    return response.json();
  };

  const checkReady = () => {
    const usePassword =
      typeof window !== 'undefined' &&
      localStorage.getItem('smart-excalidraw-use-password') === 'true';

    if (!usePassword && !isConfigValid(config)) {
      notify('配置提醒', '请先配置您的 LLM 提供商或启用访问密码', 'warning');
      onRequireConfig();
      return false;
    }
    if (!articleText.trim()) {
      notify('内容为空', '请先粘贴或上传一篇文章', 'warning');
      return false;
    }
    return true;
  };

  const handleArticleChange = (event) => {
    setArticleText(event.target.value);
    if (hasAnalysis || hasConceptGraph) resetDerivedContent();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      setArticleText(text);
      if (!articleTitle) {
        setArticleTitle(file.name.replace(/\.[^.]+$/, ''));
      }
      resetDerivedContent();
    } catch {
      notify('读取失败', '无法读取该文件，请确认是 UTF-8 文本文件', 'error');
    }
  };

  const loadSample = (sample) => {
    if (!sample) return;

    if (
      articleText.trim() &&
      !window.confirm('加载示例会覆盖当前正文，是否继续？')
    ) {
      return;
    }

    setArticleTitle(sample.title);
    setArticleText(sample.content);
    resetDerivedContent();
    notify('示例已加载', `已载入《${sample.title}》`, 'info');
  };

  const handleSampleChange = (event) => {
    const sample = SAMPLE_ARTICLES.find(({ id }) => id === event.target.value);
    event.target.value = '';
    loadSample(sample);
  };

  const handleClear = () => {
    setArticleTitle('');
    setArticleText('');
    resetDerivedContent();
  };

  const handleParse = async () => {
    if (!checkReady()) return;
    setBusyAction('parse');
    setError(null);
    try {
      const result = await callArticleApi('/api/parse', {
        article: articleText.trim(),
      });
      const nextHighlights = result.highlights || [];
      setSummary(result.summary || '');
      setHighlights(nextHighlights);
      setSelectedHighlight(null);
      setActiveTab('reader');

      const matched = locateHighlights(articleText, nextHighlights);
      if (matched.length < nextHighlights.length) {
        notify(
          '解析完成',
          `共识别 ${matched.length}/${nextHighlights.length} 个高亮片段`,
          'info'
        );
      }
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleConceptGraph = async () => {
    if (!checkReady()) return;
    setBusyAction('graph');
    setError(null);
    try {
      const result = await callArticleApi('/api/concepts', {
        article: articleText.trim(),
      });
      const concepts = result.concepts || [];
      const relations = result.relations || [];
      const elements = buildConceptGraph(
        concepts,
        relations,
        articleTitle.trim()
      );
      if (elements.length === 0) {
        throw new Error('概念图生成为空，请重试');
      }

      setConceptData({ concepts, relations });
      onShowGraph(elements, result);
      setActiveTab('mermaid');
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleFlashcards = async () => {
    if (!checkReady()) return;
    setBusyAction('cards');
    setError(null);
    try {
      const result = await callArticleApi('/api/flashcards', {
        article: articleText.trim(),
        highlights: located.map((highlight) => ({
          text: highlight.text,
          level: highlight.level,
        })),
      });
      const created = flashcardStore.addCards(
        result.cards,
        articleTitle.trim() || '未命名文章'
      );
      onCardsChanged();
      notify(
        '闪卡已生成',
        `新增 ${created.length} 张记忆卡片${
          created.length < result.cards.length ? '（其余为重复卡片已跳过）' : ''
        }，可点击顶栏「闪卡复习」开始学习`,
        'success'
      );
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setBusyAction(null);
    }
  };

  const tabs = [
    { id: 'reader', label: '阅读', icon: FileText, disabled: false },
    { id: 'mermaid', label: 'Mermaid', icon: GitBranch, disabled: !hasConceptGraph },
    { id: 'excalidraw', label: 'Excalidraw', icon: Pencil, disabled: !hasConceptGraph },
  ];
  const isComposeView = activeTab === 'reader' && !hasAnalysis;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f5f7f6]">
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt,text/markdown,text/plain"
        onChange={handleFileChange}
        className="hidden"
      />

      {!isComposeView && (
        <header className="shrink-0 border-b border-gray-200 bg-white px-4 py-3 md:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <input
              type="text"
              value={articleTitle}
              onChange={(event) => setArticleTitle(event.target.value)}
              placeholder="文章标题"
              className="min-w-0 flex-1 border-0 bg-transparent px-0 py-1 text-base font-semibold text-gray-900 outline-none placeholder:text-gray-400"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                defaultValue=""
                onChange={handleSampleChange}
                disabled={isBusy}
                aria-label="加载示例文章"
                className="h-9 rounded border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 focus:border-gray-400 focus:outline-none disabled:opacity-50"
              >
                <option value="" disabled>切换示例</option>
                {SAMPLE_ARTICLES.map((sample) => (
                  <option key={sample.id} value={sample.id}>{sample.title}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isBusy}
                className="flex h-9 items-center gap-2 rounded border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                <FileUp size={15} strokeWidth={1.8} aria-hidden="true" />
                导入文档
              </button>
              <button
                type="button"
                onClick={() => {
                  setHighlights([]);
                  setSummary('');
                  setSelectedHighlight(null);
                  setActiveTab('reader');
                }}
                disabled={isBusy}
                className="flex h-9 items-center gap-2 rounded border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                <Pencil size={15} strokeWidth={1.8} aria-hidden="true" />
                编辑原文
              </button>
              <button
                type="button"
                onClick={handleClear}
                disabled={isBusy}
                title="清空文章"
                aria-label="清空文章"
                className="flex h-9 w-9 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 hover:text-red-600 disabled:opacity-50"
              >
                <Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          </div>

          <nav className="mt-3 flex items-center gap-1" aria-label="文章工作区视图">
            {tabs.map((tab) => {
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  disabled={tab.disabled}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  className={`flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:text-gray-300 ${
                    activeTab === tab.id
                      ? 'border-gray-900 text-gray-900'
                      : 'border-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <TabIcon size={15} strokeWidth={1.8} aria-hidden="true" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </header>
      )}

      <main className="min-h-0 flex-1">
        {activeTab === 'reader' && (
          hasAnalysis ? (
            <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_20rem]">
              <section className="min-h-[420px] overflow-auto bg-white" aria-label="文章正文">
                <DocumentReader
                  content={articleText}
                  highlights={located}
                  onSelectHighlight={setSelectedHighlight}
                />
              </section>

              <aside className="min-h-0 overflow-auto border-t border-gray-200 bg-gray-50 xl:border-l xl:border-t-0">
                <section className="border-b border-gray-200 px-4 py-4">
                  <h2 className="text-xs font-semibold text-gray-500">全文主旨</h2>
                  <p className="mt-2 text-sm leading-6 text-gray-800">
                    {summary || '暂无主旨概括'}
                  </p>
                </section>

                <section className="border-b border-gray-200 px-4 py-4">
                  <h2 className="text-xs font-semibold text-gray-500">当前高亮</h2>
                  {selectedHighlight ? (
                    <div className="mt-2">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-xs ${
                          (HIGHLIGHT_LEVELS[selectedHighlight.level] || HIGHLIGHT_LEVELS.core)
                            .badgeClass
                        }`}
                      >
                        {(HIGHLIGHT_LEVELS[selectedHighlight.level] || HIGHLIGHT_LEVELS.core).name}
                      </span>
                      <p className="mt-2 text-sm leading-6 text-gray-800">
                        {selectedHighlight.text}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-gray-500">
                        {selectedHighlight.reason || '暂无选择理由'}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs leading-5 text-gray-500">
                      点击正文中的高亮片段查看选择理由。
                    </p>
                  )}
                </section>

                <section className="border-b border-gray-200 px-4 py-4">
                  <h2 className="text-xs font-semibold text-gray-500">高亮类型</h2>
                  <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                    {Object.entries(HIGHLIGHT_LEVELS).map(([level, info]) => (
                      <div key={level} className="flex items-center gap-2 text-xs text-gray-600">
                        <span className={`h-2.5 w-2.5 rounded-sm ${info.markClass.split(' ')[0]}`} />
                        <span>{info.name}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="px-4 py-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-semibold text-gray-500">高亮清单</h2>
                    <span className="text-xs tabular-nums text-gray-400">{located.length}</span>
                  </div>
                  <div className="mt-2 divide-y divide-gray-200">
                    {located.map((item, index) => {
                      const levelInfo = HIGHLIGHT_LEVELS[item.level] || HIGHLIGHT_LEVELS.core;
                      const isSelected =
                        selectedHighlight?.start === item.start &&
                        selectedHighlight?.end === item.end;
                      return (
                        <button
                          key={`${item.start}-${item.end}-${index}`}
                          type="button"
                          onClick={() => setSelectedHighlight(item)}
                          className={`w-full py-3 text-left transition-colors ${
                            isSelected ? 'bg-gray-100' : 'hover:bg-white'
                          }`}
                        >
                          <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${levelInfo.badgeClass}`}>
                            {levelInfo.name}
                          </span>
                          <span className="mt-1.5 block text-xs leading-5 text-gray-700">
                            {item.text}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </aside>
            </div>
          ) : (
            <section className="h-full overflow-auto px-4 py-8 md:px-8 md:py-12" aria-label="文章输入">
              <div className="mx-auto w-full max-w-5xl">
                <div className="text-center">
                  <h2 className="text-3xl font-semibold text-gray-950 md:text-4xl">
                    读懂一篇专业文档
                  </h2>
                  <p className="mt-3 text-sm text-gray-500">
                    粘贴正文或导入 Markdown、TXT 文档
                  </p>
                </div>

                <div className="mt-8 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                  <input
                    type="text"
                    value={articleTitle}
                    onChange={(event) => setArticleTitle(event.target.value)}
                    placeholder="文章标题（可选）"
                    className="h-12 w-full border-0 border-b border-gray-100 px-5 text-sm font-medium text-gray-900 outline-none placeholder:text-gray-400"
                  />
                  <textarea
                    value={articleText}
                    onChange={handleArticleChange}
                    placeholder="在这里粘贴文章正文..."
                    className="block min-h-[240px] w-full resize-none border-0 px-5 py-4 text-sm leading-7 text-gray-800 outline-none placeholder:text-gray-400 md:min-h-[280px]"
                  />
                  <div className="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-center">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isBusy}
                      className="flex h-9 items-center justify-center gap-2 rounded border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                    >
                      <FileUp size={16} strokeWidth={1.8} aria-hidden="true" />
                      导入文档
                    </button>
                    <span className="text-xs tabular-nums text-gray-400 sm:ml-1">
                      {articleText.length > 0 ? `${articleText.length.toLocaleString()} 字符` : '等待输入'}
                    </span>
                    <button
                      type="button"
                      onClick={handleParse}
                      disabled={isBusy}
                      className="flex h-10 items-center justify-center gap-2 rounded bg-gray-900 px-5 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-50 sm:ml-auto"
                    >
                      <Sparkles size={17} strokeWidth={1.8} aria-hidden="true" />
                      {busyAction === 'parse' ? '正在解析...' : '解析文章'}
                      {busyAction !== 'parse' && <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />}
                    </button>
                  </div>
                </div>

                <section className="mt-10" aria-labelledby="sample-articles-title">
                  <div className="flex items-center justify-between">
                    <h3 id="sample-articles-title" className="text-base font-semibold text-gray-900">
                      示例文档
                    </h3>
                    <span className="text-xs text-gray-400">{SAMPLE_ARTICLES.length} 篇</span>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {SAMPLE_ARTICLES.map((sample) => {
                      const meta = SAMPLE_META[sample.id];
                      return (
                        <button
                          key={sample.id}
                          type="button"
                          onClick={() => loadSample(sample)}
                          className="min-h-32 rounded-lg border border-gray-200 bg-white p-4 text-left transition-colors hover:border-gray-400 hover:bg-gray-50"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-gray-100 text-gray-700">
                              <FileText size={18} strokeWidth={1.8} aria-hidden="true" />
                            </span>
                            <span className={`rounded px-2 py-1 text-[11px] font-medium ${meta.accent}`}>
                              {meta.label}
                            </span>
                          </div>
                          <span className="mt-4 block text-sm font-semibold leading-6 text-gray-900">
                            {sample.title}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            </section>
          )
        )}

        {activeTab === 'mermaid' && (
          <section className="h-full min-h-[420px] overflow-auto bg-white" aria-label="Mermaid 概念图">
            <MermaidConceptView
              concepts={conceptData.concepts}
              relations={conceptData.relations}
              title={articleTitle.trim() || '文章概念图'}
            />
          </section>
        )}

        {activeTab === 'excalidraw' && (
          <section className="h-full min-h-[420px] bg-white" aria-label="Excalidraw 概念图">
            <ExcalidrawCanvas elements={graphElements} />
          </section>
        )}
      </main>

      {error && (
        <div className="flex shrink-0 items-center justify-between border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="关闭错误提示"
            className="ml-3 px-1 text-red-500 hover:text-red-700"
          >
            关闭
          </button>
        </div>
      )}

      {!isComposeView && (
        <footer className="flex shrink-0 flex-col gap-2 border-t border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-center md:px-6">
          <button
            type="button"
            onClick={handleParse}
            disabled={isBusy}
            className="flex h-9 items-center justify-center gap-2 rounded bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-50"
          >
            <Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />
            {busyAction === 'parse' ? '正在重新解析...' : '重新解析'}
          </button>
          <button
            type="button"
            onClick={handleConceptGraph}
            disabled={isBusy}
            className="flex h-9 items-center justify-center gap-2 rounded border border-blue-200 bg-blue-50 px-4 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
          >
            <GitBranch size={16} strokeWidth={1.8} aria-hidden="true" />
            {busyAction === 'graph' ? '正在生成...' : '生成概念图'}
          </button>
          <button
            type="button"
            onClick={handleFlashcards}
            disabled={isBusy}
            className="flex h-9 items-center justify-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-4 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
          >
            <Brain size={16} strokeWidth={1.8} aria-hidden="true" />
            {busyAction === 'cards' ? '正在生成...' : '生成闪卡'}
          </button>
          <span className="text-xs tabular-nums text-gray-400 sm:ml-auto">
            {articleText.length.toLocaleString()} 字符
          </span>
        </footer>
      )}
    </div>
  );
}
