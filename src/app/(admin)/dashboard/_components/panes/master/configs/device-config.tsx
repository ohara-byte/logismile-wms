import type { MasterConfig } from '../master-types';
import type { ReactNode } from 'react';

interface Device extends Record<string, unknown> {
  code: string;
  name: string;
  type: string;
  model: string | null;
  location: string | null;
  active: boolean;
  // Sprint Y-9: 端末ごとのデフォルトプリンタ
  defaultPrinterCode: string | null;
  defaultPrinterName: string | null;
}

function renderPrinterCell(r: Record<string, unknown>): ReactNode {
  const code = r.defaultPrinterCode ? String(r.defaultPrinterCode) : '';
  const name = r.defaultPrinterName ? String(r.defaultPrinterName) : '';
  if (!code) {
    return <span className="text-3xs text-ink-muted">— 未設定 —</span>;
  }
  return (
    <div className="leading-tight">
      <div className="font-bold text-emerald-300">🖨 {name || code}</div>
      <div className="font-mono text-3xs text-ink-muted">{code}</div>
    </div>
  );
}

// Sprint Y-10: 端末マスタは tablet / handy のみ管理。
//   - PC は NextAuth（メール+PW）認証で device_code を持たないため不要
//   - プリンタは Sprint Y-6 の専用「🖨 プリンタマスタ」へ移管したため重複登録を避ける
export const deviceConfig: MasterConfig<Device> = {
  name: 'device',
  title: '📱 端末マスタ',
  icon: '📱',
  endpoint: '/api/master/devices',
  primaryKey: 'code',
  searchPlaceholder: '🔍 コード／名称／設置場所で検索',
  hint: 'タブレット / ハンディの業務端末を管理（プリンタは別マスタ「🖨 プリンタ」、PC は登録不要）',
  filterField: 'type',
  filterPlaceholder: '─ 種別 ─',
  filterOptions: [
    { value: 'tablet', label: 'タブレット' },
    { value: 'handy', label: 'ハンディ' },
  ],
  columns: [
    {
      key: 'active',
      label: '稼働',
      align: 'center',
      width: 56,
      render: (r) => (r.active ? '✓' : '✗'),
    },
    { key: 'code', label: 'コード', mono: true, width: 100 },
    { key: 'name', label: '名称' },
    {
      key: 'type',
      label: '種別',
      width: 90,
      render: (r) =>
        r.type === 'tablet'
          ? '📱 タブレット'
          : r.type === 'handy'
            ? '🔦 ハンディ'
            : r.type,
    },
    { key: 'model', label: '型番', truncate: true, width: 130 },
    { key: 'location', label: '設置場所', truncate: true, width: 140 },
    // Sprint Y-9: デフォルトプリンタ表示
    {
      key: 'defaultPrinterCode',
      label: 'デフォルトプリンタ',
      width: 180,
      render: (r) => renderPrinterCell(r as Record<string, unknown>),
    },
  ],
  formFields: [
    { name: 'code', label: 'コード', type: 'text', required: true, readonlyOnEdit: true },
    { name: 'name', label: '名称', type: 'text', required: true },
    {
      name: 'type',
      label: '種別',
      type: 'select',
      required: true,
      options: [
        { value: 'tablet', label: 'タブレット' },
        { value: 'handy', label: 'ハンディ' },
      ],
      helpText: 'プリンタは「🖨 プリンタ」マスタ／PC は登録不要',
    },
    { name: 'model', label: '型番', type: 'text', placeholder: '例: HP14-na2095TU' },
    { name: 'location', label: '設置場所', type: 'text', placeholder: '例: 1F 検品棚' },
    { name: 'active', label: '稼働中', type: 'boolean' },
    // Sprint Y-9: デフォルトプリンタ（端末からの QR 印刷時に既定で送る先）
    {
      name: 'defaultPrinterCode',
      label: 'デフォルトプリンタ',
      type: 'select',
      placeholder: '─ 未設定 ─',
      optionsEndpoint: '/api/master/printers',
      optionsValueField: 'code',
      optionsLabelField: 'name',
      helpText:
        '🖨 プリンタマスタから選択。検品完了時の QR ラベルがこの端末からはこのプリンタへ送信されます。',
    },
  ],
  initialValues: { type: 'tablet', active: true },
};
