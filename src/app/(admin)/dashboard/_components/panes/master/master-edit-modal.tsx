'use client';

/**
 * マスタ汎用 編集モーダル
 *
 * モック準拠（管理用PCモック_v0.22.html L5070-5081 mstEditModal）。
 *
 * - 動的フォーム（FormField[] から生成）
 * - 'add' / 'edit' モード
 * - edit 時は 🗑 削除ボタン表示
 * - cancel / 保存
 */

import { useEffect, useState } from 'react';
import type { FormField } from './master-types';

interface Props<T extends Record<string, unknown>> {
  open: boolean;
  mode: 'add' | 'edit';
  title: string;
  hint?: string;
  fields: FormField[];
  initialValues?: Partial<T>;
  onSave: (values: Record<string, unknown>) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  onCancel: () => void;
}

export function MasterEditModal<T extends Record<string, unknown>>({
  open,
  mode,
  title,
  hint,
  fields,
  initialValues,
  onSave,
  onDelete,
  onCancel,
}: Props<T>) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // open のたびに値を初期化
  useEffect(() => {
    if (!open) return;
    const init: Record<string, unknown> = {};
    for (const f of fields) {
      const v = initialValues?.[f.name as keyof T];
      if (v !== undefined) {
        init[f.name] = v;
      } else if (f.type === 'boolean') {
        init[f.name] = false;
      } else if (f.type === 'number') {
        init[f.name] = '';
      } else {
        init[f.name] = '';
      }
    }
    setValues(init);
    setError(null);
    setBusy(false);
  }, [open, fields, initialValues]);

  // Esc キャンセル
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  function setField(name: string, v: unknown) {
    setValues((prev) => ({ ...prev, [name]: v }));
  }

  async function handleSave() {
    // 必須バリデーション
    for (const f of fields) {
      if (f.required) {
        const v = values[f.name];
        const empty =
          v === undefined ||
          v === null ||
          (typeof v === 'string' && v.trim().length === 0);
        if (empty) {
          setError(`「${f.label}」は必須項目です`);
          return;
        }
      }
    }
    setBusy(true);
    setError(null);
    try {
      // number 型は文字列から変換
      const out: Record<string, unknown> = {};
      for (const f of fields) {
        const v = values[f.name];
        if (f.type === 'number') {
          if (v === '' || v === null || v === undefined) {
            out[f.name] = null;
          } else {
            out[f.name] = Number(v);
          }
        } else if (f.type === 'boolean') {
          out[f.name] = !!v;
        } else {
          out[f.name] = v ?? null;
        }
      }
      await onSave(out);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    if (!confirm('このレコードを削除します。よろしいですか？')) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="bg-surface-panel border border-surface-border rounded-2xl shadow-modal max-w-xl w-full max-h-[90vh] overflow-auto">
        <div className="px-4 py-3 border-b border-surface-border">
          <h3 className="text-base font-bold text-ink-strong">
            {mode === 'add' ? '＋ ' : '✏ '}
            {title}
          </h3>
          {hint && <div className="text-3xs text-ink-muted mt-0.5">{hint}</div>}
        </div>

        <div className="p-4 space-y-2">
          {error && (
            <div className="text-2xs bg-status-error-bg text-status-error border border-status-error rounded p-2">
              {error}
            </div>
          )}

          {fields.map((f) => (
            <FieldRow
              key={f.name}
              field={f}
              value={values[f.name]}
              disabled={busy || (mode === 'edit' && !!f.readonlyOnEdit)}
              onChange={(v) => setField(f.name, v)}
            />
          ))}
        </div>

        <div className="px-4 py-3 border-t border-surface-border flex items-center gap-2">
          {mode === 'edit' && onDelete && (
            <button
              onClick={handleDelete}
              disabled={busy}
              className="px-3 py-1.5 rounded border border-status-error/50 bg-red-950/30 text-red-200 text-xs hover:bg-red-900 disabled:opacity-50"
            >
              🗑 削除
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded border border-surface-border bg-surface-base text-ink text-xs disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={busy}
            className="px-4 py-1.5 rounded bg-brand-primary text-white text-xs font-bold hover:bg-blue-600 disabled:opacity-50"
          >
            {busy ? '保存中…' : '✓ 保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  field,
  value,
  disabled,
  onChange,
}: {
  field: FormField;
  value: unknown;
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
      <label className="text-2xs text-ink-subtle pt-1.5">
        {field.label}
        {field.required && <span className="text-status-error ml-0.5">*</span>}
      </label>
      <div>
        {renderInput(field, value, disabled, onChange)}
        {field.helpText && (
          <div className="text-3xs text-ink-muted mt-0.5">{field.helpText}</div>
        )}
      </div>
    </div>
  );
}

function renderInput(
  field: FormField,
  value: unknown,
  disabled: boolean,
  onChange: (v: unknown) => void,
): React.ReactNode {
  const baseCls =
    'w-full bg-surface-base border border-surface-border rounded px-2 py-1.5 text-xs text-ink disabled:opacity-50';

  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={field.placeholder}
          rows={3}
          className={`${baseCls} resize-none`}
        />
      );
    case 'select':
      return (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={baseCls}
        >
          <option value="">─ 選択 ─</option>
          {field.options?.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'boolean':
      return (
        <label className="flex items-center gap-2 cursor-pointer text-xs text-ink">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className="cursor-pointer"
          />
          {field.helpText ?? '有効'}
        </label>
      );
    case 'number':
      return (
        <input
          type="number"
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          min={field.min}
          max={field.max}
          step={field.step}
          placeholder={field.placeholder}
          className={`${baseCls} font-mono tabular-nums`}
        />
      );
    case 'date':
      return (
        <input
          type="date"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`${baseCls} font-mono`}
        />
      );
    default:
      return (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={field.placeholder}
          className={baseCls}
        />
      );
  }
}
