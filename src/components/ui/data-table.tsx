/**
 * 共通テーブル — ダークテーマ業務テーブル
 *
 * 使い方は標準の <table> 互換。サブコンポーネントを組み合わせて使う:
 *
 *   <Table>
 *     <THead>
 *       <TH>ID</TH>
 *       <TH align="right">数量</TH>
 *     </THead>
 *     <TBody>
 *       {rows.map((r) => (
 *         <TR key={r.id} onClick={...}>
 *           <TD>{r.id}</TD>
 *           <TD align="right" mono>{r.qty}</TD>
 *         </TR>
 *       ))}
 *     </TBody>
 *   </Table>
 */

import { cn } from '@/lib/cn';

interface TableProps {
  children: React.ReactNode;
  className?: string;
}

export function Table({ children, className }: TableProps) {
  return (
    <div
      className={cn(
        'border border-surface-border rounded-lg overflow-hidden bg-surface-panel',
        className,
      )}
    >
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="bg-surface-base border-b border-surface-border">
      <tr>{children}</tr>
    </thead>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

interface RowProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  /** 論理削除など、薄く表示したい行 */
  muted?: boolean;
}

export function TR({ children, onClick, className, muted }: RowProps) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'border-t border-surface-border',
        onClick && 'cursor-pointer hover:bg-surface-raised transition-colors',
        muted && 'opacity-50',
        className,
      )}
    >
      {children}
    </tr>
  );
}

interface CellProps {
  children: React.ReactNode;
  align?: 'left' | 'center' | 'right';
  mono?: boolean;
  className?: string;
}

export function TH({ children, align = 'left', className }: CellProps) {
  const alignCls =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      className={cn(
        'px-3 py-2 text-3xs uppercase tracking-wider text-ink-subtle font-bold',
        alignCls,
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TD({ children, align = 'left', mono, className }: CellProps) {
  const alignCls =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <td
      className={cn(
        'px-3 py-2 text-ink',
        alignCls,
        mono && 'font-mono tabular-nums',
        className,
      )}
    >
      {children}
    </td>
  );
}

/** 「データなし」行 */
export function EmptyRow({ colSpan, message }: { colSpan: number; message?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-ink-muted text-xs">
        {message ?? 'データがありません'}
      </td>
    </tr>
  );
}
