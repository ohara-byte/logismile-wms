import type { MasterConfig } from '../master-types';

interface AppSetting extends Record<string, unknown> {
  key: string;
  value: string;
  valueType: string;
  label: string | null;
  note: string | null;
}

export const appSettingConfig: MasterConfig<AppSetting> = {
  name: 'appSetting',
  title: '⚙ 梱包時間設定',
  icon: '⚙',
  endpoint: '/api/master/app-settings',
  primaryKey: 'key',
  searchPlaceholder: '🔍 キー・名称で検索',
  hint: '梱包の予定時間に関する全体設定。pack.noshi_add_sec / pack.airpack_add_sec は秒（注文に のし／エアパックがあるとき終了予測に加算）、pack.airpack_keyword は熨斗名称(O列)内でエアパックと判定する語。変更は終了予測(ETA)に即反映されます。',
  columns: [
    { key: 'label', label: '名称' },
    { key: 'value', label: '値', align: 'right' },
    { key: 'key', label: 'キー', mono: true },
    { key: 'note', label: '説明', truncate: true },
  ],
  formFields: [
    {
      name: 'key',
      label: 'キー',
      type: 'text',
      required: true,
      readonlyOnEdit: true,
      placeholder: 'pack.noshi_add_sec',
      helpText: '通常は既定キーの値を編集します',
    },
    { name: 'label', label: '名称', type: 'text', placeholder: 'のし追加工数(秒)' },
    { name: 'value', label: '値', type: 'text', required: true, helpText: '秒数 or 文字列' },
    {
      name: 'valueType',
      label: '型',
      type: 'select',
      options: [
        { value: 'int', label: '整数(秒)' },
        { value: 'string', label: '文字列' },
      ],
    },
    { name: 'note', label: '説明', type: 'textarea' },
  ],
  initialValues: { valueType: 'int' },
};
