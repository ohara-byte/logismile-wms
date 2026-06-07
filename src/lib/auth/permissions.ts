/**
 * 権限チェックヘルパー（サーバ専用 / Sprint Y-11 拡張）
 *
 * 管理PC: NextAuth セッション（src/lib/auth/auth-options.ts）から取得
 * モバイル（タブレット/ハンディ）: 社員番号 Cookie（src/lib/auth/employee-session.ts）から取得
 *
 * クライアントから利用する型・マトリクスは `permissions-shared.ts` を直接 import。
 */

import { getServerSession, type Session } from 'next-auth';
import { authOptions } from './auth-options';
import { getEmployeeSession } from './employee-session';
import {
  hasPermission,
  ROLE_LABELS,
  type PermissionKey,
  type Role,
} from './permissions-shared';
import {
  ensurePermissionsLoaded,
  hasPermissionRuntime,
} from './permissions-runtime';

// 共有モジュールの再エクスポート（既存の import 互換性維持）
export {
  hasPermission,
  ROLE_LABELS,
  PERMISSIONS,
  type Role,
  type PermissionKey,
} from './permissions-shared';

export interface AuthInfo {
  source: 'pc' | 'mobile';
  role: Role;
  staffCode: string | null;
  email?: string;
  deviceCode?: string;
}

/** 現在のリクエストの認証情報を取得（PC / モバイル両対応）。 */
export async function getAuth(): Promise<AuthInfo | null> {
  // 管理PC（NextAuth セッション）優先
  const session = (await getServerSession(authOptions)) as Session | null;
  if (session?.user?.role) {
    return {
      source: 'pc',
      role: session.user.role,
      staffCode: session.user.staffCode,
      email: session.user.email ?? undefined,
    };
  }

  // モバイル（社員番号 Cookie）
  //
  // CLAUDE.md §4「管理機能には社員番号ログインではアクセス不可」に従い、
  // どのロールでも staff 扱いに降格して管理機能（master_edit / csv_import 等）を封じる。
  //
  // Sprint Y-16: Y-15 で本人ロール保持に変更したが、既存 API の `requireRole('admin','manager','staff')`
  //   と整合せず（lead 扱いになり 403 連発）、連絡事項の既読化が失敗するなど副作用が大きかったため
  //   元の挙動に戻す。parttime の force_create 制限などは個別 API 側で別途対応する。
  const emp = await getEmployeeSession();
  if (emp) {
    return {
      source: 'mobile',
      role: 'staff',
      staffCode: emp.staffCode,
      deviceCode: emp.deviceCode,
    };
  }

  return null;
}

export function hasRole(auth: AuthInfo | null, ...roles: Role[]): boolean {
  return !!auth && roles.includes(auth.role);
}

/**
 * 検品セッションの所有者チェック。
 * staff ロールは自分のセッションしか操作できない。admin/manager は他人の操作も許可。
 */
export function ownsSession(
  auth: AuthInfo,
  session: { staffCode: string },
): boolean {
  if (auth.role === 'admin' || auth.role === 'manager') return true;
  return session.staffCode === auth.staffCode;
}

/**
 * 監査ログ（order_audit_logs.acted_by / insp_logs 等）の actedBy を解決する。
 *
 * order_audit_logs.acted_by は **staff.code への必須 FK（VarChar(10)）** のため、
 * email や 'unknown' を入れると FK 違反・桁あふれで 500 になる。
 * 必ず「有効な staff.code（= auth.staffCode）」のみを返し、無ければ null。
 * 呼び出し側は null のとき 403 を返すこと（PC ユーザーは staff にリンク必須）。
 *
 * 2026-06-01 バグレビュー A-2: delete / hold / reopen の actedBy 取り扱いを統一。
 */
export function resolveActor(auth: AuthInfo | null): string | null {
  const code = auth?.staffCode?.trim();
  if (!code) return null;
  // VarChar(10) 制約に収まらない値は採用しない（不正データ防止）
  if (code.length > 10) return null;
  return code;
}

/** AuthInfo 経由でも判定したい場合の便利ラッパ */
export function authHasPermission(
  auth: AuthInfo | null | undefined,
  perm: PermissionKey,
): boolean {
  return hasPermission(auth?.role, perm);
}

/** API Route で使うガード。失敗時は `Response` を返すので、route 側で早期 return できる。 */
export async function requireRole(...roles: Role[]): Promise<
  | { ok: true; auth: AuthInfo }
  | { ok: false; response: Response }
> {
  const auth = await getAuth();
  if (!auth) {
    return {
      ok: false,
      response: Response.json(
        { error: 'UNAUTHORIZED', message: 'ログインが必要です' },
        { status: 401 },
      ),
    };
  }
  if (!hasRole(auth, ...roles)) {
    return {
      ok: false,
      response: Response.json(
        { error: 'FORBIDDEN', message: `権限不足: ${roles.join(' / ')} が必要です` },
        { status: 403 },
      ),
    };
  }
  return { ok: true, auth };
}

/**
 * 機能別権限ガード（Sprint Y-11 / Y-10 DB 連携）。
 *   const guard = await requirePermission('csv_export');
 *   if (!guard.ok) return guard.response;
 *
 * Sprint Y-10: PermissionOverride テーブルの値を参照（キャッシュ済）
 */
export async function requirePermission(perm: PermissionKey): Promise<
  | { ok: true; auth: AuthInfo }
  | { ok: false; response: Response }
> {
  const auth = await getAuth();
  if (!auth) {
    return {
      ok: false,
      response: Response.json(
        { error: 'UNAUTHORIZED', message: 'ログインが必要です' },
        { status: 401 },
      ),
    };
  }
  // DB のオーバーライドを優先（初回は load → 以降はキャッシュ）
  await ensurePermissionsLoaded();
  if (!hasPermissionRuntime(auth.role, perm)) {
    return {
      ok: false,
      response: Response.json(
        {
          error: 'FORBIDDEN',
          message: `この操作には権限「${perm}」が必要です（現在のロール: ${ROLE_LABELS[auth.role] ?? auth.role}）`,
        },
        { status: 403 },
      ),
    };
  }
  return { ok: true, auth };
}
