'use client';

import { Check, LocateFixed, Trash2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function EmptyState({ children }) {
  return <p className="px-4 py-10 text-center text-xs leading-5 text-gray-500">{children}</p>;
}

function RecordItem({ record, mastered, onFocus, onMaster, onDelete }) {
  return (
    <article className="border-b border-gray-100 px-4 py-4">
      <button
        type="button"
        onClick={() => onFocus(record.id)}
        className="group w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
      >
        <div className="flex items-start gap-2">
          <LocateFixed size={14} className="mt-0.5 shrink-0 text-gray-400 group-hover:text-teal-700" />
          <p className="line-clamp-2 text-xs font-medium leading-5 text-gray-700 group-hover:text-gray-950">
            {record.selectedText}
          </p>
        </div>
        <p className="mt-2 line-clamp-3 text-xs leading-5 text-gray-500">
          {record.explanation.plainExplanation}
        </p>
      </button>
      <div className="mt-3 flex items-center gap-2">
        {record.isDemo && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">Demo</span>}
        <button
          type="button"
          onClick={() => onMaster(record)}
          aria-pressed={mastered}
          className={`ml-auto flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${mastered ? 'bg-teal-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          <Check size={12} />
          {mastered ? '已懂' : '懂了'}
        </button>
        <button
          type="button"
          onClick={() => onDelete(record)}
          title="删除解读"
          aria-label="删除解读"
          className="flex h-7 w-7 items-center justify-center rounded text-gray-400 outline-none hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </article>
  );
}

export default function KnowledgePanel({
  explanations,
  terms,
  mastery,
  onFocus,
  onMaster,
  onDelete,
  onFocusTerm,
}) {
  const reviewItems = explanations.filter((record) => !mastery[record.id]);
  return (
    <Tabs defaultValue="explanations" className="flex h-full min-h-0 flex-col bg-[#fafafa]">
      <header className="shrink-0 border-b border-gray-200 bg-white px-3 pb-3 pt-4 pr-12 lg:pr-3">
        <p className="px-1 text-sm font-semibold text-gray-950">知识面板</p>
        <TabsList className="mt-3 flex w-full">
          <TabsTrigger value="explanations">解读 {explanations.length}</TabsTrigger>
          <TabsTrigger value="terms">术语 {terms.length}</TabsTrigger>
          <TabsTrigger value="review">复习 {reviewItems.length}</TabsTrigger>
        </TabsList>
      </header>

      <TabsContent value="explanations" className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          {explanations.length > 0 ? explanations.map((record) => (
            <RecordItem
              key={record.id}
              record={record}
              mastered={Boolean(mastery[record.id])}
              onFocus={onFocus}
              onMaster={onMaster}
              onDelete={onDelete}
            />
          )) : <EmptyState>划选正文后，可以在这里集中查看解读。</EmptyState>}
        </ScrollArea>
      </TabsContent>

      <TabsContent value="terms" className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          {terms.length > 0 ? terms.map((term) => (
            <button
              key={term.id}
              type="button"
              onClick={() => onFocusTerm(term)}
              className="block w-full border-b border-gray-100 px-4 py-4 text-left outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600"
            >
              <div className="flex items-center gap-2">
                <h3 className="break-words text-sm font-semibold text-gray-900">{term.term}</h3>
                {term.isDemo && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">Demo</span>}
              </div>
              <p className="mt-2 text-xs leading-5 text-gray-500">{term.explanation}</p>
            </button>
          )) : <EmptyState>使用“识别术语”后，术语会附着在当前文档。</EmptyState>}
        </ScrollArea>
      </TabsContent>

      <TabsContent value="review" className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          {reviewItems.length > 0 ? reviewItems.map((record) => (
            <RecordItem
              key={`review-${record.id}`}
              record={record}
              mastered={false}
              onFocus={onFocus}
              onMaster={onMaster}
              onDelete={onDelete}
            />
          )) : <EmptyState>当前文档没有待复习的解读。</EmptyState>}
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}
