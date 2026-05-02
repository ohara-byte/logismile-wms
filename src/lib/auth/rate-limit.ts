/**
 * シンプルな in-memory レート制限
 *
 * ★ 単一プロセス前提。本番がマルチインスタンス化した場合は Redis に移行。
 *
 * 仕様:
 *  - キー（emp_code or IP）ごとに、windowSec 内の失敗試行を計上
 *  - maxAttempts に達したら lockoutSec の間ロックアウト
 *  - 成功時はキーをリセット
 *
 * 同時に「IP ベース」と「emp_code ベース」の両方で制限することで、
 *  - 1 台の端末から大量の社員番号試行（IP 制限）
 *  - 同じ社員番号への分散試行（emp_code 制限）
 * の両方を抑える。
 */

interface Bucket {
  count: number;
  /** ウィンドウ起算点（最初の失敗試行時刻、ms epoch） */
  firstAttemptAt: number;
  /** ロック解除時刻（ms epoch）。未ロックは 0。 */
  unlockAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** ウィンドウ（秒）。最初の失敗から何秒の間に maxAttempts 失敗するとロック。 */
  windowSec: number;
  /** ロックアウト時間（秒）。 */
  lockoutSec: number;
  /** 失敗回数の上限（達したらロック）。 */
  maxAttempts: number;
}

const DEFAULT_OPTS: RateLimitOptions = {
  windowSec: 5 * 60,
  lockoutSec: 15 * 60,
  maxAttempts: 5,
};

/** 失敗を 1 つ計上。返り値の `locked` がロックアウト判定。 */
export function recordFailure(
  key: string,
  opts: Partial<RateLimitOptions> = {},
): { locked: boolean; retryAfterSec?: number; attempts: number } {
  const o = { ...DEFAULT_OPTS, ...opts };
  const now = Date.now();
  let b = buckets.get(key);

  // バケット未作成 or ロック解除済 or ウィンドウ超過 → 新規ウィンドウ開始
  const lockExpired = b !== undefined && b.unlockAt > 0 && now >= b.unlockAt;
  const windowExpired = b !== undefined && b.unlockAt === 0 && now - b.firstAttemptAt > o.windowSec * 1000;
  if (!b || lockExpired || windowExpired) {
    b = { count: 0, firstAttemptAt: now, unlockAt: 0 };
  }

  b.count += 1;
  if (b.count >= o.maxAttempts) {
    b.unlockAt = now + o.lockoutSec * 1000;
  }
  buckets.set(key, b);

  const locked = now < b.unlockAt;
  return {
    locked,
    retryAfterSec: locked ? Math.ceil((b.unlockAt - now) / 1000) : undefined,
    attempts: b.count,
  };
}

/** 既にロックされているか確認（試行を計上しない）。 */
export function isLocked(key: string): { locked: boolean; retryAfterSec?: number } {
  const b = buckets.get(key);
  if (!b) return { locked: false };
  const now = Date.now();
  if (b.unlockAt === 0 || now >= b.unlockAt) return { locked: false };
  return { locked: true, retryAfterSec: Math.ceil((b.unlockAt - now) / 1000) };
}

/** 成功時にキーをクリア。 */
export function clearFailures(key: string) {
  buckets.delete(key);
}
