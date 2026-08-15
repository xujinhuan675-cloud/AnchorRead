'use client';

import { useState } from 'react';
import { BookMarked, Pencil, Plus, Trash2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';

const EMPTY_FORM = { id: '', term: '', aliases: '', explanation: '' };

function parseAliases(value) {
  const seen = new Set();
  return value
    .split(/[,，、\s]+/u)
    .map((alias) => alias.trim().toLowerCase())
    .filter((alias) => {
      if (!alias || seen.has(alias)) return false;
      seen.add(alias);
      return true;
    });
}

/**
 * 术语表管理器：用户自维护的术语定义列表（增删改）
 * 表中术语会作为背景交代给 AI：不再从零解释，并沿用既定定义
 * 以弹窗形式从工作台导航栏打开，不占用知识面板 tab
 */
export default function GlossaryManager({ isOpen, onClose, entries = [], onSave, onRemove }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState('');

  // 关闭弹窗时顺手重置表单，避免下次打开残留上次编辑内容
  const handleClose = () => {
    setForm(EMPTY_FORM);
    setFormOpen(false);
    setFormError('');
    onClose?.();
  };

  // 表单只在打开动作（新建/编辑）时重置，关闭后无需额外清理
  const startCreate = () => {
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const startEdit = (entry) => {
    setForm({
      id: entry.id,
      term: entry.term,
      aliases: (Array.isArray(entry.aliases) ? entry.aliases : []).join('，'),
      explanation: entry.explanation || '',
    });
    setFormOpen(true);
  };

  const submit = async (event) => {
    event.preventDefault();
    setFormError('');
    const term = form.term.trim();
    if (!term) {
      setFormError('主术语不能为空。');
      return;
    }
    const aliases = parseAliases(form.aliases);
    if (aliases.includes(term.trim().toLowerCase())) {
      setFormError('别名不能与主术语重复。');
      return;
    }
    const duplicate = entries.find((entry) =>
      entry.normalizedTerm === term.trim().toLowerCase() && entry.id !== form.id
    );
    if (duplicate) {
      setFormError(`术语「${duplicate.term}」已在术语表中，请直接编辑该条目。`);
      return;
    }
    try {
      await onSave?.({
        id: form.id || undefined,
        term,
        aliases,
        explanation: form.explanation.trim(),
      });
      setFormOpen(false);
    } catch (error) {
      setFormError(error?.message || '保存失败');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="术语表" maxWidth="max-w-3xl">
      <div className="p-4" aria-label="术语表管理">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] leading-5 text-gray-500">
          维护你自己的术语定义。解读与分析请求会把术语表作为背景告知 AI：
          表中术语不再重复解释，并沿用你的定义。
        </p>
        <button
          type="button"
          onClick={startCreate}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded border border-gray-200 px-2.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
        >
          <Plus size={13} aria-hidden="true" />
          添加术语
        </button>
      </div>

      {formOpen ? (
        <form onSubmit={submit} className="mt-3 space-y-3 rounded border border-gray-200 bg-gray-50 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-gray-600">
              主术语
              <input
                type="text"
                value={form.term}
                onChange={(event) => setForm((current) => ({ ...current, term: event.target.value }))}
                placeholder="例如：幂等键"
                maxLength={100}
                className="mt-1 h-8 w-full rounded border border-gray-200 bg-white px-2.5 text-sm text-gray-900 outline-none focus:border-gray-400"
              />
            </label>
            <label className="block text-xs font-medium text-gray-600">
              别名（可选，逗号或顿号分隔）
              <input
                type="text"
                value={form.aliases}
                onChange={(event) => setForm((current) => ({ ...current, aliases: event.target.value }))}
                placeholder="例如：Idempotency Key，幂等性键"
                className="mt-1 h-8 w-full rounded border border-gray-200 bg-white px-2.5 text-sm text-gray-900 outline-none focus:border-gray-400"
              />
            </label>
          </div>
          <label className="block text-xs font-medium text-gray-600">
            定义（作为背景交代给 AI）
            <textarea
              value={form.explanation}
              onChange={(event) => setForm((current) => ({ ...current, explanation: event.target.value }))}
              rows={3}
              maxLength={1000}
              placeholder="一句话定义这个术语；AI 解读时会沿用这里的说法。"
              className="mt-1 w-full resize-y rounded border border-gray-200 bg-white px-2.5 py-2 text-sm leading-6 text-gray-900 outline-none focus:border-gray-400"
            />
          </label>
          {formError ? <p role="alert" className="text-xs text-red-600">{formError}</p> : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="h-8 rounded border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 hover:bg-gray-100"
            >
              取消
            </button>
            <button
              type="submit"
              className="h-8 rounded bg-gray-900 px-4 text-xs font-medium text-white hover:bg-gray-700"
            >
              保存术语
            </button>
          </div>
        </form>
      ) : null}

      {entries.length === 0 && !formOpen ? (
        <div className="mt-3 rounded border border-dashed border-gray-200 bg-white p-6 text-center">
          <BookMarked size={20} className="mx-auto text-gray-300" aria-hidden="true" />
          <p className="mt-2 text-xs leading-5 text-gray-500">
            术语表还是空的。添加你已掌握或需要固定释义的术语，AI 解读时会直接沿用。
          </p>
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded border border-gray-200 bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-xs font-semibold text-gray-800">{entry.term}</p>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(entry)}
                    aria-label={`编辑术语"${entry.term}"`}
                    className="flex h-7 w-7 items-center justify-center rounded text-gray-500 hover:bg-gray-100"
                  >
                    <Pencil size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove?.(entry.id)}
                    aria-label={`删除术语"${entry.term}"`}
                    className="flex h-7 w-7 items-center justify-center rounded text-red-500 hover:bg-red-50"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              </div>
              {entry.explanation ? (
                <p className="mt-2 break-words text-xs leading-5 text-gray-600">{entry.explanation}</p>
              ) : null}
              {Array.isArray(entry.aliases) && entry.aliases.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {entry.aliases.map((alias) => (
                    <span key={alias} className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-500">
                      {alias}
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="mt-2 text-[11px] text-gray-400">术语表条目 · AI 解读时沿用此定义，不再重复解释。</p>
            </li>
          ))}
        </ul>
      )}
      </div>
    </Modal>
  );
}
