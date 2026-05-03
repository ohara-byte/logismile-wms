/**
 * 共通フォーム要素（ダーク） — input / select / textarea / label
 *
 * 既存の `<input className="border rounded px-2 py-1.5 text-sm">` を置き換える。
 */

import { cn } from '@/lib/cn';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const baseField =
  'w-full bg-surface-base border border-surface-border-strong text-ink-strong rounded px-2 py-1.5 text-sm focus:outline-none focus:border-accent-amber focus:ring-1 focus:ring-accent-amber/40 disabled:opacity-50 disabled:cursor-not-allowed';

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(baseField, className)} />;
}

export function NumberInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      type={rest.type ?? 'number'}
      className={cn(baseField, 'tabular-nums', className)}
    />
  );
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cn(baseField, className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(baseField, 'resize-y', className)} />;
}

interface LabelProps {
  children: React.ReactNode;
  required?: boolean;
  className?: string;
}
export function FieldLabel({ children, required, className }: LabelProps) {
  return (
    <label
      className={cn(
        'block text-2xs text-ink-subtle font-bold uppercase tracking-wider mb-1',
        className,
      )}
    >
      {children}
      {required && <span className="text-status-error ml-0.5">*</span>}
    </label>
  );
}

/** ファイル選択入力（ダーク） */
export function FileInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="file"
      {...rest}
      className={cn(
        'block w-full text-sm text-ink',
        'file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0',
        'file:bg-blue-700 file:text-white file:font-bold file:text-xs file:cursor-pointer',
        'hover:file:bg-blue-600',
        className,
      )}
    />
  );
}
