'use client';

/**
 * ⚠ 未マップ サブタブ（A-11b）
 *
 * モック準拠（管理用PCモック_v0.22.html L3066-3068 + 想定詳細）。
 *
 * 商品：ProductAuxAttr が無い active な Product を一覧
 * 顧客：CustomerAuxAttr 未実装のため案内文のみ
 *
 * 「補助マスタへ追加」ボタンで aux-prod / aux-cust タブへ誘導。
 */

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface UnmapData {
  products: Array<{
    code: string;
    name: string;
    jan: string | null;
    cat: string;
    frozen: boolean;
  }>;
  customers: unknown[];
  customerNote: string;
}

export function UnmapPane() {
  const [data, setData] = useState<UnmapData | null>(null);
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/link/unmap')
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setData(j.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function jumpTo(lsub: string) {
    const sp = new URLSearchParams(params.toString());
    sp.set('lsub', lsub);
    router.replace(`/dashboard?${sp.toString()}`, { scroll: false });
  }

  if (!data) {
    return <div className="text-2xs text-ink-muted p-3">読み込み中…</div>;
  }

  return (
    <div className="space-y-3 p-1">
      {/* 未マップ商品 */}
      <section>
        <div className="flex items-baseline justify-between mb-1">
          <h3 className="text-xs font-bold text-status-warn">
            ⚠ 未マップ商品 ({data.products.length})
          </h3>
          <button
            onClick={() => jumpTo('aux-prod')}
            className="text-2xs text-status-info hover:underline"
          >
            商品属性補助タブへ →
          </button>
        </div>
        {data.products.length === 0 ? (
          <p className="text-2xs text-ink-muted bg-surface-base border border-surface-border rounded p-3 text-center">
            ✅ 全ての商品が補助マスタに登録済みです
          </p>
        ) : (
          <div className="border border-surface-border rounded overflow-hidden max-h-[300px] overflow-y-auto">
            <table className="w-full text-2xs">
              <thead className="bg-surface-base sticky top-0 border-b border-surface-border">
                <tr>
                  <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">商品コード</th>
                  <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">JAN</th>
                  <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">名称</th>
                  <th className="px-1.5 py-1 text-left text-3xs uppercase text-ink-subtle">カテゴリ</th>
                  <th className="px-1.5 py-1 text-center text-3xs uppercase text-ink-subtle">冷凍</th>
                </tr>
              </thead>
              <tbody>
                {data.products.map((p) => (
                  <tr key={p.code} className="border-t border-surface-border">
                    <td className="px-1.5 py-1 font-mono text-accent-amber">{p.code}</td>
                    <td className="px-1.5 py-1 font-mono text-ink-subtle">{p.jan ?? '—'}</td>
                    <td className="px-1.5 py-1 truncate max-w-[260px]">{p.name}</td>
                    <td className="px-1.5 py-1 text-ink-subtle">{p.cat}</td>
                    <td className="px-1.5 py-1 text-center">{p.frozen ? '❄' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 未マップ顧客 */}
      <section>
        <h3 className="text-xs font-bold text-status-warn mb-1">⚠ 未マップ顧客 (—)</h3>
        <div className="text-2xs text-ink-muted bg-surface-base border border-surface-border rounded p-3">
          {data.customerNote}
        </div>
      </section>
    </div>
  );
}
