'use client';

/**
 * メンバー割当モーダル（Sprint G-3）
 *
 * モック準拠（管理用PCモック_v0.22.html L4788-4791「👥 メンバー割当」モーダル）。
 *
 * 既存の /assignment ページの AssignmentClient をモーダル内に埋め込み、
 * - 表示エリアをそのまま再利用（30 分刻みグリッド）
 * - 上部にプリセット（昨日と同じ／全クリア）と印刷ボタンを配置
 * - 「この割当で保存」で AssignmentClient 側の API 経由保存後に onSaved を発火
 *
 * バー両端リサイズ・ドラッグ移動の実装は AssignmentClient 側の改修で対応する想定。
 * 現状は AssignmentClient のクリックトグル UI で割当を編集できる。
 */

import { useCallback, useEffect, useState } from 'react';
import { AssignmentClient } from '@/app/(admin)/assignment/_components/assignment-client';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

// Sprint Y-13: 対象日を「本日 / 明日 / 翌日以降」でラベル化
function describeDate(iso: string): string {
  if (!iso) return '—';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  const wd = ['日', '月', '火', '水', '木', '金', '土'][target.getDay()];
  const m = target.getMonth() + 1;
  const d = target.getDate();
  const base = `${m}/${d}(${wd})`;
  if (diff === 0) return `本日 ${base}`;
  if (diff === 1) return `明日 ${base}`;
  if (diff === -1) return `昨日 ${base}`;
  if (diff > 1) return `${diff} 日先 ${base}`;
  return `${Math.abs(diff)} 日前 ${base}`;
}

export function StaffAssignmentModal({ open, onClose }: Props) {
  // Sprint Y-13: AssignmentClient の対象日を受け取ってタイトルに反映
  const [currentDate, setCurrentDate] = useState<string>('');
  const handleDateChange = useCallback((d: string) => setCurrentDate(d), []);

  // Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 z-[55] flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* 2026-05-20: 白背景テーマ（モーダル全体）— assignment-light で配下を一括変換 */}
      <div className="assignment-light bg-white border-2 border-accent-amber rounded-[10px] shadow-modal w-full max-w-[1400px] max-h-[92vh] flex flex-col overflow-hidden">
        {/* ヘッダ — Sprint Y-13: 対象日を動的表示（パープルアクセント維持） */}
        <div className="px-4 py-2.5 border-b border-purple-200 flex items-center justify-between bg-purple-50">
          <h2 className="text-base font-bold text-purple-800">
            👥 メンバー割当
            {currentDate && (
              <span className="ml-2 text-sm font-normal text-purple-700">
                （{describeDate(currentDate)} 9:00-18:00）
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-red-600 text-xl leading-none px-2"
            title="閉じる (Esc)"
          >
            ×
          </button>
        </div>

        {/* 操作ヒント */}
        <div className="px-4 py-1.5 bg-slate-50 border-b border-slate-200 text-2xs text-slate-700">
          💡 セルをクリックして時間帯を割当 ／ 同じセルを再クリックで解除
          <span className="ml-2 text-slate-500">
            （対象日を未来日にすると、その日のシフトを反映して事前割当が可能）
          </span>
        </div>

        {/* AssignmentClient（白背景テーマで描画） */}
        <div className="flex-1 overflow-auto p-3 bg-white">
          <AssignmentClient onDateChange={handleDateChange} theme="light" />
        </div>
      </div>
    </div>
  );
}
