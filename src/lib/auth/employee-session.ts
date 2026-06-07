/**
 * モバイル端末（タブレット / ハンディ）用の社員番号セッション
 *
 * 設計:
 * - NextAuth とは別系統（NextAuth は管理PC のメール+PW 専用）
 * - HMAC-SHA256 で署名した JSON ペイロードを Cookie に格納
 * - 有効期限はペイロードに `exp` として埋め込む（既定 8 時間）
 * - 退職者は `staff.active = false` でログイン無効化
 *
 * Cookie 名: `wms_emp_session`
 */

import { cookies } from 'next/headers';
import crypto from 'node:crypto';

const COOKIE_NAME = 'wms_emp_session';
const COOKIE_MAX_AGE_SEC = 60 * 60 * 8; // 8 時間

// Sprint Y-11: lead / parttime を追加
export type EmployeeRole = 'admin' | 'manager' | 'lead' | 'staff' | 'parttime';

export interface EmployeeSession {
  staffCode: string;
  empCode: string;
  name: string;
  role: EmployeeRole;
  deviceCode: string;
  /** UNIX 秒。これを過ぎたら無効。 */
  exp: number;
}

function getSecret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET が未設定です');
  return s;
}

/** ペイロードを HMAC-SHA256 で署名し `payload.signature` の形式で返す。 */
function signPayload(payload: Omit<EmployeeSession, never>): string {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifyAndParse(token: string): EmployeeSession | null {
  // 攻撃者制御の Cookie 値が入る経路。長さ違いの sig や壊れた base64 で
  // RangeError / TypeError が出ても 500 にせず、すべて null を返して認証失敗扱いにする。
  try {
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) return null;

    const expected = crypto.createHmac('sha256', getSecret()).update(b64).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return null; // timingSafeEqual の RangeError 防止
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    const obj = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as EmployeeSession;
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj.exp !== 'number' || obj.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof obj.staffCode !== 'string' || typeof obj.empCode !== 'string') return null;
    // Sprint Y-11: 5 ロール対応（lead/parttime 追加後の Cookie を弾かないよう拡張）
    if (
      typeof obj.role !== 'string' ||
      !['admin', 'manager', 'lead', 'staff', 'parttime'].includes(obj.role)
    ) {
      return null;
    }
    return obj;
  } catch {
    return null;
  }
}

/** 現リクエストの社員番号セッションを取得。Cookie がない / 期限切れ / 改ざん時は null。 */
export async function getEmployeeSession(): Promise<EmployeeSession | null> {
  const c = cookies().get(COOKIE_NAME);
  if (!c?.value) return null;
  return verifyAndParse(c.value);
}

/** 新規セッションを発行して Cookie をセット。 */
export async function setEmployeeSession(
  data: Omit<EmployeeSession, 'exp'>,
): Promise<EmployeeSession> {
  const exp = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_SEC;
  const session: EmployeeSession = { ...data, exp };
  const token = signPayload(session);

  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    // ★ HTTPS でない URL（社内 LAN の HTTP テスト運用 等）では Secure を付けない。
    // NEXTAUTH_URL が https:// で始まる場合のみ Secure を付与する（NextAuth と同様の挙動）。
    secure: (process.env.NEXTAUTH_URL ?? '').startsWith('https://'),
    path: '/',
    maxAge: COOKIE_MAX_AGE_SEC,
  });
  return session;
}

/** ログアウト用に Cookie を削除。 */
export async function clearEmployeeSession(): Promise<void> {
  cookies().set(COOKIE_NAME, '', { path: '/', maxAge: 0 });
}
