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

import { createContext, useContext } from 'react';
import { cn } from '@/lib/cn';

/**
 * 見出し固定（sticky header）用コンテキスト。
 * Table が stickyHead 指定のとき配下の THead に伝播し、見出しをスクロール領域の最上部へ固定する。
 * 既存の呼び出し側（<THead>）は変更不要。
 */
const StickyHeadContext = createContext(false);

interface TableProps {
  children: React.ReactNode;
  className?: string;
  /**
   * 見出し固定。一覧だけがスクロールし、見出し（列ヘッダ）は最上部に固定される。
   * maxHeight でスクロール領域の高さ上限を指定（既定 60vh）。
   */
  stickyHead?: boolean;
  /** stickyHead 時のスクロール領域の高さ上限（CSS 値）。既定 '60vh' */
  maxHeight?: string;
}

export function Table({ children, className, stickyHead = false, maxHeight = '60vh' }: TableProps) {
  return (
    <StickyHeadContext.Provider value={stickyHead}>
      <div
        className={cn(
          'border border-surface-border rounded-lg overflow-hidden bg-surface-panel',
          className,
        )}
      >
        {stickyHead ? (
          <div className="overflow-y-auto" style={{ maxHeight }}>
            <table className="w-full text-sm">{children}</table>
          </div>
        ) : (
          <table className="w-full text-sm">{children}</table>
        )}
      </div>
    </StickyHeadContext.Provider>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  const sticky = useContext(StickyHeadContext);
  return (
    <thead
      className={cn(
        'bg-surface-base border-b border-surface-border',
        // 見出し固定: スクロール領域の最上部に貼り付ける。bg-surface-base が不透明なので行は透けない。
        sticky && 'sticky top-0 z-10',
      )}
    >
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
