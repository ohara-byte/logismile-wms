'use client';

/**
 * 連絡事項モーダル（ハンディ起動時 / タブレット任意）
 *
 * - mount 時に `/api/notices?date=today` から取得
 * - 1 件ずつ Enter キーで「☑ 確認」して進める
 * - 全件確認したら自動で閉じる
 *
 * 既読フラグはユーザー単位で持たないため、起動するたびに表示される簡易仕様。
 */

import { useEffect, useState } from 'react';

export interface Notice {
  id: number;
  title: string;
  body: string | null;
  priority: number;
}

interface Props {
  /** 表示する場面の文脈。"handy-launch" は KEYENCE BT-A500 の Enter 操作中心。 */
  variant: 'handy-launch' | 'tablet-launch';
  onClose: () => void;
}

export function NoticesModal({ variant, onClose }: Props) {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    fetch('/api/notices')
      .then((r) => r.json())
      .then((j) => setNotices(j.data?.items ?? []))
      .catch(() => setNotices([]));
  }, []);

  useEffect(() => {
    if (!notices) return;
    if (notices.length === 0) {
      onClose();
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        if (idx < (notices?.length ?? 0) - 1) setIdx((i) => i + 1);
        else onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notices, idx, onClose]);

  if (!notices || notices.length === 0) return null;
  const cur = notices[idx];

  const wide = variant === 'tablet-launch';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div
        className={`bg-white rounded-2xl shadow-2xl ${
          wide ? 'max-w-xl' : 'max-w-md'
        } w-full p-6`}
      >
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-bold">📢 連絡事項 {idx + 1} / {notices.length}</h2>
        </div>
        <h3 className="text-xl font-semibold mb-2">{cur.title}</h3>
        <p className="text-sm text-gray-700 whitespace-pre-wrap mb-6 min-h-[2em]">
          {cur.body ?? ''}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => {
              if (idx < notices.length - 1) setIdx((i) => i + 1);
              else onClose();
            }}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium"
          >
            ☑ 確認 {idx < notices.length - 1 ? '(次へ)' : '(閉じる)'}
          </button>
        </div>
        <p className="text-xs text-gray-400 text-center mt-3">Enter キーで進めます</p>
      </div>
    </div>
  );
}
