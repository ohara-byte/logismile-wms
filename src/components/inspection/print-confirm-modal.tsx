'use client';

/**
 * 🖨 印刷確認モーダル（モック L1362-1394 / L520-575 .print-modal 準拠）
 *
 * 納品書スキャン完了後、QR印刷フラグ ON または特殊梱包の場合に開く。
 * 「印刷せず完了」または「🖨 印刷して完了」を選択 → 検品完了 API を呼ぶ。
 */

import { useEffect } from 'react';

interface OrderInfo {
  pkNo: string;
  destName: string | null;
  destZip: string | null;
  carrierName: string | null;
  cool: boolean;
  noshiName: string | null;
  invoiceNo: string;
}

interface Props {
  open: boolean;
  order: OrderInfo;
  /** 印刷あり/なしで完了 */
  onConfirm: (print: boolean) => void;
  onCancel: () => void;
}

export function PrintConfirmModal({ open, order, onConfirm, onCancel }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[100] p-4 backdrop-blur-sm"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          background: '#1e293b',
          borderRadius: 14,
          padding: 24,
          width: 720,
          maxWidth: '94vw',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          color: '#f1f5f9',
        }}
      >
        <h2
          style={{
            color: '#f472b6',
            fontSize: 22,
            marginBottom: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontWeight: 'bold',
          }}
        >
          🖨 印刷確認
          <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 'normal' }}>
            自動表示（印刷フラグON）
          </span>
        </h2>
        <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 18 }}>
          以下の内容でプリンタ <b style={{ color: '#fbbf24' }}>SATO CT4-LX</b> に
          QR ラベルを出力します。
        </p>

        {/* 印刷プレビュー */}
        <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
          {/* QR ラベル風プレビュー */}
          <div
            style={{
              width: 180,
              height: 230,
              background: '#fff',
              borderRadius: 10,
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: 130,
                height: 130,
                background:
                  'repeating-conic-gradient(#000 0 25%, #fff 0 50%) 50% / 12px 12px',
                borderRadius: 4,
              }}
            />
            <div
              style={{
                color: '#000',
                fontSize: 13,
                fontWeight: 'bold',
                fontFamily: 'Consolas, monospace',
                textAlign: 'center',
                wordBreak: 'break-all',
                lineHeight: 1.2,
              }}
            >
              {order.invoiceNo || order.pkNo}
            </div>
            <div style={{ color: '#000', fontSize: 11, textAlign: 'center' }}>
              QR ラベル
            </div>
          </div>

          {/* 情報テーブル */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <table
              style={{
                width: '100%',
                fontSize: 13,
                borderCollapse: 'collapse',
              }}
            >
              <tbody>
                <Row k="ピッキング№" v={order.pkNo} mono />
                <Row k="納品書№" v={order.invoiceNo} mono />
                <Row k="お届け先" v={order.destName ?? '—'} />
                <Row
                  k="郵便番号"
                  v={order.destZip ? `〒 ${order.destZip}` : '—'}
                  mono
                />
                <Row k="配送便" v={order.carrierName ?? '—'} />
                <Row k="温度帯" v={order.cool ? '❄ 冷凍/冷蔵' : '常温'} />
                <Row k="のし" v={order.noshiName ?? '—'} />
              </tbody>
            </table>
          </div>
        </div>

        {/* オプション */}
        <div
          style={{
            background: '#0f172a',
            borderRadius: 8,
            padding: 12,
            marginBottom: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <PrintOption k="プリンタ" v="SATO CT4-LX（梱包ステーション最寄り）" />
          <PrintOption k="ラベル種別" v="QR ラベル（30×40mm 超高感度サーマルB）" />
          <PrintOption k="枚数" v="1 枚" />
        </div>

        {/* アクション */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={() => onConfirm(false)}
            style={{
              height: 44,
              padding: '0 16px',
              borderRadius: 8,
              background: '#475569',
              color: '#fff',
              fontWeight: 'bold',
              fontSize: 13,
            }}
            className="hover:brightness-110"
          >
            印刷しない（次へ）
          </button>
          <button
            onClick={() => onConfirm(true)}
            style={{
              height: 44,
              padding: '0 18px',
              borderRadius: 8,
              background: '#db2777',
              color: '#fff',
              fontWeight: 'bold',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            className="hover:brightness-110"
          >
            🖨 印刷して次へ
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <tr>
      <td
        style={{
          color: '#94a3b8',
          padding: '4px 8px 4px 0',
          width: 90,
          verticalAlign: 'top',
        }}
      >
        {k}
      </td>
      <td
        style={{
          color: '#f1f5f9',
          padding: '4px 0',
          fontFamily: mono ? 'Consolas, monospace' : undefined,
          fontWeight: 'bold',
          wordBreak: 'break-all',
        }}
      >
        {v}
      </td>
    </tr>
  );
}

function PrintOption({ k, v }: { k: string; v: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 12,
      }}
    >
      <span style={{ color: '#94a3b8' }}>{k}</span>
      <b style={{ color: '#f1f5f9' }}>{v}</b>
    </div>
  );
}
