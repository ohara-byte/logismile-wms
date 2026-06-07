/**
 * 🖨 プリンタマスタ（Sprint Y-6）
 *
 * SATO CT4-LX × 6 台想定。社内 LAN・固定 IP で管理。
 *  - 印刷方式：TCP Raw 9100（ZPL II 互換 / 既定）
 *  - 用紙：SATO レスプリ・シータラベル 30×40mm 超高感度サーマルB
 *  - device_printer_map で端末ごとの最寄りプリンタを別途設定
 */

import type { MasterConfig } from '../master-types';
import type { ReactNode } from 'react';

interface Printer extends Record<string, unknown> {
  code: string;
  name: string;
  ipAddress: string;
  port: number;
  model: string;
  location: string | null;
  labelSize: string;
  active: boolean;
  note: string | null;
}

/** 名称（太字） + 機種（小・モノ系）の 2 段表示 */
function renderNameModelCell(r: Record<string, unknown>): ReactNode {
  const name = String(r.name ?? '');
  const model = String(r.model ?? '');
  return (
    <div className="leading-tight">
      <div className="font-bold text-ink-strong text-sm truncate">
        {name || '—'}
      </div>
      <div className="font-mono text-3xs text-ink-muted truncate">{model}</div>
    </div>
  );
}

/** IP アドレス（モノ系） + ポート の 2 段表示 */
function renderHostPortCell(r: Record<string, unknown>): ReactNode {
  const ip = String(r.ipAddress ?? '');
  const port = Number(r.port ?? 9100);
  return (
    <div className="leading-tight font-mono">
      <div className="font-bold text-accent-amber">{ip || '—'}</div>
      <div className="text-3xs text-ink-muted">port {port}</div>
    </div>
  );
}

export const printerConfig: MasterConfig<Printer> = {
  name: 'printer',
  title: '🖨 プリンタマスタ',
  icon: '🖨',
  endpoint: '/api/master/printers',
  primaryKey: 'code',
  searchPlaceholder: '🔍 コード／名称／IP／配置で検索',
  hint: 'SATO CT4-LX × 6 台。TCP raw 9100 で ZPL/SBPL 送信（社内 LAN・固定 IP）',
  filterField: 'active',
  filterPlaceholder: '─ 状態 ─',
  filterOptions: [
    { value: 'true', label: '稼働中' },
    { value: 'false', label: '停止' },
  ],
  columns: [
    {
      key: 'active',
      label: '状態',
      align: 'center',
      width: 56,
      render: (r) => (r.active ? '✓' : '✗'),
    },
    { key: 'code', label: 'コード', mono: true, width: 110 },
    {
      key: 'name',
      label: '名称 / 機種',
      width: 200,
      truncate: true,
      render: (r) => renderNameModelCell(r as Record<string, unknown>),
    },
    {
      key: 'ipAddress',
      label: 'IP / Port',
      width: 140,
      render: (r) => renderHostPortCell(r as Record<string, unknown>),
    },
    { key: 'location', label: '配置', width: 120, truncate: true },
    {
      key: 'labelSize',
      label: 'ラベル',
      align: 'center',
      width: 90,
      mono: true,
      render: (r) => `${r.labelSize ?? '30x40'} mm`,
    },
  ],
  formFields: [
    {
      name: 'code',
      label: 'プリンタコード',
      type: 'text',
      required: true,
      readonlyOnEdit: true,
      helpText: '一意 (例: PR-A1, PR-B2 等)',
    },
    {
      name: 'name',
      label: '名称',
      type: 'text',
      required: true,
      placeholder: '例: 梱包ステーションA',
    },
    {
      name: 'ipAddress',
      label: 'IP アドレス',
      type: 'text',
      required: true,
      placeholder: '例: 192.168.1.50',
      helpText: '社内 LAN の固定 IP。ping で疎通確認後に登録',
    },
    {
      name: 'port',
      label: 'ポート',
      type: 'number',
      min: 1,
      max: 65535,
      helpText: 'TCP Raw 9100（既定）。CT4-LX の LAN ポート',
    },
    {
      name: 'model',
      label: '機種',
      type: 'select',
      options: [
        { value: 'SATO CT4-LX', label: 'SATO CT4-LX' },
        { value: 'SATO CT4-LX-HC', label: 'SATO CT4-LX-HC（高解像）' },
        { value: 'その他', label: 'その他' },
      ],
      helpText: '機種により ZPL/SBPL の挙動が変わる場合あり',
    },
    {
      name: 'labelSize',
      label: 'ラベルサイズ',
      type: 'select',
      options: [
        { value: '30x40', label: '30 × 40 mm（QR ラベル / 既定）' },
        { value: '40x30', label: '40 × 30 mm' },
        { value: '50x80', label: '50 × 80 mm' },
        { value: 'other', label: 'その他（備考に記載）' },
      ],
    },
    {
      name: 'location',
      label: '配置',
      type: 'text',
      placeholder: '例: 梱包ステーション A・冷凍ライン側',
    },
    {
      name: 'active',
      label: '稼働中',
      type: 'boolean',
      helpText: 'OFF にすると印刷ジョブ送信先候補から除外',
    },
    { name: 'note', label: '備考', type: 'textarea' },
  ],
  initialValues: {
    port: 9100,
    model: 'SATO CT4-LX',
    labelSize: '30x40',
    active: true,
  },
};
