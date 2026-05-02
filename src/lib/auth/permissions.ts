/**
 * 権限チェックヘルパー
 *
 * 管理PC: NextAuth セッション（src/lib/auth/auth-options.ts）から取得
 * モバイル（タブレット/ハンディ）: 社員番号 Cookie（src/lib/auth/employee-session.ts）から取得
 */

import { getServerSession, type Session } from 'next-auth';
import { authOptions } from './auth-options';
import { getEmployeeSession } from './employee-session';

export type Role = 'admin' | 'manager' | 'staff';

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
  const emp = await getEmployeeSession();
  if (emp) {
    return {
      source: 'mobile',
      role: emp.role,
      staffCode: emp.staffCode,
      deviceCode: emp.deviceCode,
    };
  }

  return null;
}

export function hasRole(auth: AuthInfo | null, ...roles: Role[]): boolean {
  return !!auth && roles.includes(auth.role);
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
