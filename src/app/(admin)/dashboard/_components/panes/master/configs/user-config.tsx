/**
 * 👥 ユーザー管理マスタ（Sprint Y-12 / admin 専有）
 *
 * 管理 PC ログイン用の User レコード（NextAuth credentials）を CRUD。
 *  - 担当者マスタ（Staff）と staffCode で紐付け（任意）
 *  - 新規時はパスワード必須。更新時は空欄で変更スキップ
 *  - 自分自身の無効化・降格・削除は API 側で防止
 */

import type { MasterConfig } from '../master-types';
import type { ReactNode } from 'react';

interface User extends Record<string, unknown> {
  id: string;
  email: string;
  role: string;
  staffCode: string | null;
  staffName: string | null;
  staffKana: string | null;
  active: boolean;
  lastLogin: string | null;
  createdAt: string;
}

/** メール（太字）+ 担当者氏名（小・ミュート）の 2 段表示 */
function renderEmailNameCell(r: Record<string, unknown>): ReactNode {
  const email = String(r.email ?? '');
  const name = r.staffName ? String(r.staffName) : '';
  const code = r.staffCode ? String(r.staffCode) : '';
  return (
    <div className="leading-tight">
      <div className="font-bold text-ink-strong text-sm truncate">{email}</div>
      <div className="font-mono text-3xs text-ink-muted truncate">
        {name ? `${name} (${code})` : '— 担当者紐付なし —'}
      </div>
    </div>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export const userConfig: MasterConfig<User> = {
  name: 'user',
  title: '👥 PC ユーザー管理',
  icon: '👥',
  endpoint: '/api/master/users',
  primaryKey: 'id',
  searchPlaceholder: '🔍 メールアドレス／氏名／コードで検索',
  hint: '管理 PC ログイン用ユーザー（メール+パスワード）。タブレット/ハンディは社員番号のみで担当者マスタを使う',
  filterField: 'role',
  filterPlaceholder: '─ ロール ─',
  filterOptions: [
    { value: 'admin', label: '管理者' },
    { value: 'manager', label: '責任者' },
    { value: 'lead', label: 'リーダー' },
    { value: 'staff', label: 'スタッフ' },
    { value: 'parttime', label: 'アルバイト' },
  ],
  columns: [
    {
      key: 'active',
      label: '状態',
      align: 'center',
      width: 56,
      render: (r) => (r.active ? '✓' : '✗'),
    },
    {
      key: 'email',
      label: 'メール / 担当者',
      width: 280,
      truncate: true,
      render: (r) => renderEmailNameCell(r as Record<string, unknown>),
    },
    {
      key: 'role',
      label: 'ロール',
      width: 90,
      render: (r) =>
        r.role === 'admin'
          ? '管理者'
          : r.role === 'manager'
            ? '責任者'
            : r.role === 'lead'
              ? 'リーダー'
              : r.role === 'parttime'
                ? 'アルバイト'
                : 'スタッフ',
    },
    {
      key: 'lastLogin',
      label: '最終ログイン',
      width: 120,
      mono: true,
      render: (r) => formatDateTime(r.lastLogin as string | null),
    },
    {
      key: 'createdAt',
      label: '作成',
      width: 100,
      mono: true,
      render: (r) => formatDateTime(r.createdAt as string | null),
    },
  ],
  formFields: [
    {
      name: 'email',
      label: 'メールアドレス',
      type: 'text',
      required: true,
      placeholder: 'user@oenosato.local',
      helpText: 'PC ログイン ID として使用（重複不可）',
    },
    {
      name: 'password',
      label: 'パスワード',
      type: 'text',
      placeholder: '8 文字以上',
      helpText: '新規=必須／編集時=空欄で変更スキップ',
    },
    {
      name: 'role',
      label: 'ロール',
      type: 'select',
      required: true,
      options: [
        { value: 'admin', label: '管理者 (admin)' },
        { value: 'manager', label: '責任者 (manager)' },
        { value: 'lead', label: 'リーダー (lead)' },
        { value: 'staff', label: 'スタッフ (staff)' },
        { value: 'parttime', label: 'アルバイト (parttime)' },
      ],
      helpText:
        '機能別権限はロールに紐付き（CSV出力・マスタ編集 etc.）',
    },
    {
      name: 'staffCode',
      label: '担当者コード（任意）',
      type: 'text',
      placeholder: '例: ADMIN01',
      helpText: '担当者マスタと紐付けるとセッションに氏名が表示されます',
    },
    {
      name: 'active',
      label: '有効',
      type: 'boolean',
      helpText: 'OFF にすると PC ログイン不可',
    },
  ],
  initialValues: { role: 'staff', active: true },
};
