import type { MasterConfig } from '../master-types';

interface StdTime extends Record<string, unknown> {
  code: string;
  groupId: string | null;
  tableId: string;
  stdMin: number;
  source: string;
  updatedAt: string;
  note: string | null;
}

export const stdTimeConfig: MasterConfig<StdTime> = {
  name: 'stdtime',
  title: '⏱ 標準時間マスタ',
  icon: '⏱',
  endpoint: '/api/master/std-times',
  primaryKey: 'code',
  searchPlaceholder: '🔍 コード／グループ／テーブルで検索',
  hint: 'テーブル単位の 1 件あたり標準処理時間（分）。グループIDは任意ラベル（可変）',
  filterField: 'source',
  filterPlaceholder: '─ ソース ─',
  filterOptions: [
    { value: 'manual', label: '手動' },
    { value: 'auto', label: '自動更新' },
    { value: 'imported', label: '取込' },
  ],
  columns: [
    { key: 'code', label: 'コード', mono: true, width: 100 },
    { key: 'groupId', label: 'グループ', width: 80 },
    { key: 'tableId', label: 'テーブル', width: 80 },
    {
      key: 'stdMin',
      label: '標準分',
      align: 'right',
      mono: true,
      width: 80,
      render: (r) => Number(r.stdMin).toFixed(2),
    },
    {
      key: 'source',
      label: 'ソース',
      width: 80,
      render: (r) =>
        r.source === 'manual' ? '手動' :
        r.source === 'auto' ? '自動' :
        r.source === 'imported' ? '取込' : r.source,
    },
    { key: 'updatedAt', label: '更新日', mono: true, width: 100 },
  ],
  formFields: [
    { name: 'code', label: 'コード', type: 'text', required: true, readonlyOnEdit: true, helpText: '一意 (例: ABL-A)' },
    {
      name: 'tableId',
      label: 'テーブル ID',
      type: 'select',
      required: true,
      optionsEndpoint: '/api/master/tables',
      optionsValueField: 'code',
      optionsLabelField: 'name',
      helpText: '検品テーブルから選択。完了予測はこのテーブル単位で算出',
    },
    {
      name: 'groupId',
      label: 'グループ ID（任意）',
      type: 'text',
      placeholder: '例: ABL',
      helpText: '可変ラベル（任意）。空でも登録可',
    },
    {
      name: 'stdMin',
      label: '標準時間（分）',
      type: 'number',
      step: 0.01,
      min: 0,
      required: true,
      helpText: '1 件あたりの標準処理時間',
    },
    {
      name: 'source',
      label: 'ソース',
      type: 'select',
      options: [
        { value: 'manual', label: '手動' },
        { value: 'auto', label: '自動更新' },
        { value: 'imported', label: '取込' },
      ],
    },
    { name: 'note', label: '備考', type: 'textarea' },
  ],
  initialValues: { stdMin: 2.0, source: 'manual' },
};
