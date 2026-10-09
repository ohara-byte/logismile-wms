'use client';

/**
 * キャンセル（論理削除）伝票 警告モーダル（タブレット / ハンディ共用）
 *
 * 2026-05-22 新規:
 *   待機画面でキャンセル伝票（deletedAt != null）をスキャンしたとき、
 *   現場の誤作業防止のため赤背景で前面表示する。
 *
 * 動作:
 *   - 操作系は「閉じる」のみ（検品画面へは遷移させない）
 *   - Esc / 背景クリックで閉じる
 *   - 削除日時 / 削除者 / 削除理由 を表示し、原因把握を助ける
 *
 * 2026-10-09 HUB 当日キャンセル（小原様「WMS へチャット連絡と検品遮断をしたい」「お届先様名も追加」）:
 *   hubCancel があれば「この伝票はキャンセルされました」（検品の途中なら「検品中にキャンセルされました」）と出し、
 *   お届先様名を大きく、理由・時刻と「キャンセル棚へ戻す」案内を出す（モック oeno-echub 22b_wms_cancel_devices.html）。
 *   検品の途中で止めたときは、閉じると待機画面へ戻る（onClose 側で遷移）。
 */

import { useEffect } from 'react';

interface CancelOrderInfo {
  pkNo: string;
  invoiceNo: string | null;
  destName: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
  /** HUB 当日キャンセル（印が付いた伝票）。during: start=始めようとした／inspect=検品の途中 */
  hubCancel?: { at: string; reason: string | null; during: 'start' | 'inspect' } | null;
}

interface Props {
  open: boolean;
  order: CancelOrderInfo | null;
  onClose: () => void;
}

export function CancelWarningModal({ open, order, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !order) return null;
  if (order.hubCancel) return <HubCancelView order={order} hub={order.hubCancel} onClose={onClose} />;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface-panel border-2 border-status-error rounded-2xl shadow-modal max-w-lg w-full p-5">
        <h2 className="text-lg font-bold text-status-error mb-1">⛔ キャンセル伝票です</h2>
        <p className="text-2xs text-ink-subtle mb-3 leading-snug">
          この伝票は <b className="text-status-error">取消・削除済</b> です。
          検品はできません。「閉じる」を押してから次の伝票をスキャンしてください。
        </p>

        <div className="bg-status-error-bg border-l-4 border-status-error rounded p-3 mb-4">
          <Field
            k="ピッキングNo"
            v={<span className="font-mono text-accent-amber">{order.pkNo}</span>}
          />
          <Field
            k="納品書No"
            v={<span className="font-mono">{order.invoiceNo ?? '—'}</span>}
          />
          <Field k="お届け先" v={order.destName ?? '—'} />
          <Field
            k="削除日時"
            v={
              order.deletedAt ? (
                <span className="text-status-error">
                  {new Date(order.deletedAt).toLocaleString('ja-JP')}
                </span>
              ) : (
                '—'
              )
            }
          />
          <Field k="削除者" v={order.deletedBy ?? '—'} />
          <Field
            k="削除理由"
            v={<span className="text-status-error">{order.deleteReason ?? '—'}</span>}
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            autoFocus
            className="px-4 py-2 rounded bg-status-error text-white text-xs font-bold hover:brightness-110"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

/** HUB 当日キャンセルの表示（検品を始めさせない・途中なら止める） */
function HubCancelView({
  order,
  hub,
  onClose,
}: {
  order: CancelOrderInfo;
  hub: NonNullable<CancelOrderInfo['hubCancel']>;
  onClose: () => void;
}) {
  const inspecting = hub.during === 'inspect';
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm" data-hub-cancel>
      <div className="bg-status-error-bg border-4 border-status-error rounded-2xl shadow-modal max-w-lg w-full p-5 text-center">
        <h2 className="text-xl font-bold text-status-error mb-2">
          {inspecting ? '⛔ 検品中にキャンセルされました' : '⛔ この伝票はキャンセルされました'}
        </h2>
        {order.destName ? <p className="text-lg font-bold text-ink mb-1">お届先 {order.destName} 様</p> : null}
        <p className="text-xs font-mono text-ink mb-2">
          ピッキング№ {order.pkNo}
          {order.invoiceNo ? ` ／ 納品書 ${order.invoiceNo}` : ''}
        </p>
        <p className="text-sm text-ink mb-1">
          {inspecting
            ? 'ここで検品を止めます（完了できません）。スキャンした商品はキャンセル棚へ戻してください。'
            : '検品しないでください。商品はキャンセル棚へ戻してください。'}
        </p>
        <p className="text-2xs text-ink-subtle mb-4">
          HUB 当日キャンセル {new Date(hub.at).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
          {hub.reason ? ` ／ 理由: ${hub.reason}` : ''}
        </p>
        <button
          onClick={onClose}
          autoFocus
          className="px-6 py-3 rounded-xl bg-status-error text-white text-base font-bold hover:brightness-110"
        >
          {inspecting ? '戻しました（了解）' : '確認しました（次の伝票へ）'}
        </button>
      </div>
    </div>
  );
}

/**
 * 伝票（GET /api/orders/[pkNo] の data）または検品 API の 409 CANCELLED の data から、このモーダルに渡す中身を作る。
 * キャンセルでも削除でもなければ null。
 */
export function cancelInfoFrom(src: {
  pkNo: string;
  invoiceNo?: string | null;
  destName?: string | null;
  deleted?: boolean;
  deletedAt?: string | null;
  deletedBy?: string | null;
  deleteReason?: string | null;
  cancelRequestedAt?: string | null;
  cancelReason?: string | null;
  /** 409 CANCELLED の data */
  cancelledAt?: string | null;
  reason?: string | null;
  during?: 'start' | 'inspect';
}): CancelOrderInfo | null {
  const at = src.cancelRequestedAt ?? src.cancelledAt ?? null;
  if (!at && !src.deleted) return null;
  return {
    pkNo: src.pkNo,
    invoiceNo: src.invoiceNo ?? null,
    destName: src.destName ?? null,
    deletedAt: src.deletedAt ?? null,
    deletedBy: src.deletedBy ?? null,
    deleteReason: src.deleteReason ?? null,
    hubCancel: at ? { at, reason: src.cancelReason ?? src.reason ?? null, during: src.during ?? 'start' } : null,
  };
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-1.5 text-xs leading-relaxed">
      <span className="text-ink-subtle">{k}</span>
      <span className="text-ink">{v}</span>
    </div>
  );
}
