'use client';

/**
 * 管理 PC のロール Context（Sprint Y-11）
 *
 * SessionProvider 未導入のため、サーバ layout で取得したロールを
 * ツリー全体に配信するためのシンプルな Context。
 *
 * 使い方:
 *   <RoleProvider role={session.user.role}>...</RoleProvider>
 *   const role = useRole();
 *   const canEdit = useHasPermission('master_edit');
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  hasPermission,
  type PermissionKey,
  type Role,
} from '@/lib/auth/permissions-shared';

interface RoleContextValue {
  role: Role;
}

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({
  role,
  children,
}: {
  role: Role;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ role }), [role]);
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

/** 現在のロールを取得。Provider 外では admin 扱い（最小権限ガード方針ではないため要注意） */
export function useRole(): Role {
  const ctx = useContext(RoleContext);
  return ctx?.role ?? 'admin';
}

/** 機能権限を持つかチェック */
export function useHasPermission(perm: PermissionKey): boolean {
  const role = useRole();
  return hasPermission(role, perm);
}
