'use client';

/**
 * クライアント用 権限フック（Sprint Y-11）
 *
 * NextAuth セッションからロールを取得し、機能別権限を判定する。
 * 使い方:
 *   const canEdit = usePermission('master_edit');
 *   {canEdit && <button>編集</button>}
 *
 * モバイル端末（タブレット/ハンディ）では NextAuth セッションが無いため、
 * 別途 useEmployeeRole フックを用意（後日追加予定）。
 */

import { useSession } from 'next-auth/react';
import {
  hasPermission,
  type PermissionKey,
  type Role,
} from './permissions-shared';

/** 現在ログイン中の管理 PC ユーザーが特定権限を持つか */
export function usePermission(perm: PermissionKey): boolean {
  const { data: session } = useSession();
  const role = session?.user?.role as Role | undefined;
  return hasPermission(role, perm);
}

/** 現在ログイン中のロールを返す（権限以外の細かい判定用） */
export function useRole(): Role | null {
  const { data: session } = useSession();
  return (session?.user?.role as Role | undefined) ?? null;
}
