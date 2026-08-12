'use client';

import { markdownToSafeHtml } from '@/lib/document-content';
import { deriveReaderDraft } from '@/lib/reader-lab';

export default function DerivedDraft({ document, explanations, mastery, onFocus }) {
  const draft = deriveReaderDraft(document, explanations);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-white">
      <article className="reader-lab-derived mx-auto w-full max-w-[760px] px-5 pb-24 pt-10 sm:px-8 lg:px-12 lg:pt-14">
        <div className="mb-10 border-b border-gray-200 pb-7">
          <p className="text-xs font-semibold text-teal-700">派生阅读视图</p>
          <h2 className="mt-2 text-2xl font-semibold leading-tight text-gray-950">{document.title}</h2>
          <p className="mt-3 text-sm leading-6 text-gray-500">
            由源文档块与当前解读实时编排。源文档没有被复制或修改。
          </p>
        </div>

        {draft.blocks.map((block) => (
          <section key={block.id} className="mb-7">
            <div
              className="reader-lab-derived-source"
              dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(block.source) }}
            />
            {block.explanations.map((record) => (
              <button
                key={record.id}
                type="button"
                onClick={() => onFocus(record.id)}
                className="mt-3 w-full border-l-2 border-teal-600 bg-teal-50/70 px-4 py-3 text-left outline-none transition-colors hover:bg-teal-50 focus-visible:ring-2 focus-visible:ring-teal-600"
              >
                <span className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-teal-800">
                  解读
                  {record.isDemo && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">Demo</span>}
                  {mastery[record.id] && <span className="text-gray-500">已掌握</span>}
                </span>
                <span className="mt-2 block text-sm leading-7 text-gray-800">
                  {record.explanation.plainExplanation}
                </span>
              </button>
            ))}
          </section>
        ))}

        {draft.unplaced.length > 0 && (
          <section className="mt-10 border-t border-gray-200 pt-6">
            <h3 className="text-sm font-semibold text-gray-900">待重新定位的解读</h3>
            {draft.unplaced.map((record) => (
              <button
                key={record.id}
                type="button"
                onClick={() => onFocus(record.id)}
                className="mt-3 block w-full border-l-2 border-gray-300 px-4 py-2 text-left text-sm leading-6 text-gray-600"
              >
                {record.explanation.plainExplanation}
              </button>
            ))}
          </section>
        )}
      </article>
    </div>
  );
}
