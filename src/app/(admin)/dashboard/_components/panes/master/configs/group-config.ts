import type { MasterConfig } from '../master-types';

interface Group extends Record<string, unknown> {
  id: string;
  name: string;
  tables: string[];
  tablesText?: string;
  category: string;
  needStaff: number;
  sortOrder: number;
  /** 作業ペース 🔴/🟡 の境界（件/時）。未設定ならバッジを出さない */
  paceYellowMin: number | null;
  /** 作業ペース 🟡/🟢 の境界（件/時） */
  paceGreenMin: number | null;
  note: string | null;
}

export const groupConfig: MasterConfig<Group> = {
  name: 'group',
  title: '🏷 検品グループ構成',
  icon: '🏷',
  endpoint: '/api/master/groups',
  primaryKey: 'id',
  searchPlaceholder: '🔍 ID／名称／カテゴリで検索',
  hint: '表示順は数字が小さい順に並びます（10 / 20 / 30 ... のように間隔を空けると後で挿入しやすい）',
  columns: [
    // Sprint Y-10: 表示順を先頭に
    {
      key: 'sortOrder',
      label: '表示順',
      align: 'right',
      mono: true,
      width: 70,
    },
    { key: 'id', label: 'ID', mono: true, width: 80 },
    { key: 'name', label: '名称' },
    { key: 'category', label: 'カテゴリ', width: 100 },
    {
      key: 'tablesText',
      label: 'テーブル',
      truncate: true,
      width: 200,
      render: (r) => {
        if (typeof r.tablesText === 'string' && r.tablesText.length > 0) return r.tablesText;
        if (Array.isArray(r.tables)) return (r.tables as string[]).join(', ');
        return '—';
      },
    },
    { key: 'needStaff', label: '必要人数', align: 'right', mono: true, width: 80 },
    // 作業ペースの目標（要望書 2026-09-27 要望③）。🔴〜/🟡〜〜/🟢〜 の範囲で見せる
    {
      key: 'paceYellowMin',
      label: 'ペース目標(件/時)',
      align: 'right',
      mono: true,
      width: 150,
      render: (r) => {
        const y = r.paceYellowMin;
        const g = r.paceGreenMin;
        if (typeof y !== 'number' || typeof g !== 'number') return '—';
        return `🔴〜${y} 🟡${y}〜${g} 🟢${g}〜`;
      },
    },
  ],
  formFields: [
    { name: 'id', label: 'ID', type: 'text', required: true, readonlyOnEdit: true, helpText: '英数字 10 文字以内' },
    { name: 'name', label: '名称', type: 'text', required: true },
    { name: 'category', label: 'カテゴリ', type: 'text', required: true, placeholder: '例: 通常 / 冷凍 / 仕分' },
    {
      name: 'tables',
      label: 'テーブル',
      type: 'text',
      placeholder: 'カンマ区切り 例: A, B, C',
      helpText: 'グループに紐付くテーブル ID をカンマ区切りで列挙',
    },
    { name: 'needStaff', label: '必要人数', type: 'number', min: 0 },
    // Sprint Y-10: 表示順
    {
      name: 'sortOrder',
      label: '表示順',
      type: 'number',
      min: 0,
      max: 9999,
      placeholder: '100',
      helpText:
        'ダッシュボード「テーブルグループ別 進捗」の表示順。小さい順に左上から並びます（例: 10, 20, 30, ...）。',
    },
    // 作業ペースの目標値（要望書 2026-09-27 要望③）。
    //   現場の自己確認用のバッジに使う。人員構成・繁忙期に応じて現場で調整できるよう
    //   コードに固定せずここで編集する。空欄ならバッジを出さない。
    {
      name: 'paceYellowMin',
      label: 'ペース目標 🟡 下限（件/時）',
      type: 'number',
      min: 0,
      max: 9999,
      helpText:
        'この値以上で 🟡標準。未満は 🔴要注意。空欄にするとタブレット／ハンディにバッジを出しません。',
    },
    {
      name: 'paceGreenMin',
      label: 'ペース目標 🟢 下限（件/時）',
      type: 'number',
      min: 0,
      max: 9999,
      helpText: 'この値以上で 🟢好調。🟡 下限より大きい値を入れてください。',
    },
    { name: 'note', label: '備考', type: 'textarea' },
  ],
  initialValues: { needStaff: 1, sortOrder: 100 },
};
