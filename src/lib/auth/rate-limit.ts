/**
 * シンプルな in-memory レート制限
 *
 * ★ 単一プロセス前提。本番がマルチインスタンス化した場合は Redis に移行。
 *
 * 仕様:
 *  - キー（emp_code or IP）ごとに、固定ウィンドウで失敗試行を計上
 *  - 上限を超えるとロックアウト時間中は早期に拒否
 *  - 成功時はキーをリセット
 *
 * 同時に「IP ベース」と「emp_code ベース」の両方で制限することで、
 *  - 1 台の端末から大量の社員番号試行（IP 制限）
 *  - 同じ社員番号への分散試行（emp_code 制限）
 * の両方を抑える。
 */

interface Bucket {
  count: number;
  /** ロック解除時刻（ms epoch） */
  unlockAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** ウィンドウ（秒）。失敗試行をカウントする期間。 */
  windowSec: number;
  /** 上限を超えたらロック（秒）。 */
  lockoutSec: number;
  /** 上限。 */
  maxAttempts: number;
}

const DEFAULT_OPTS: RateLimitOptions = {
  windowSec: 5 * 60,
  lockoutSec: 15 * 60,
  maxAttempts: 5,
};

/** 失敗を 1 つ計上し、ロックアウト中なら true を返す。 */
export function recordFailure(key: string, opts: Partial<RateLimitOptions> = {}): {
  locked: boolean;
  retryAfterSec?: number;
  attempts: number;
} {
  const o = { ...DEFAULT_OPTS, ...opts };
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.unlockAt + o.windowSec * 1000) {
    b = { count: 0, unlockAt: 0 };
  }
  b.count += 1;
  if (b.count >= o.maxAttempts) {
    b.unlockAt = now + o.lockoutSec * 1000;
  }
  buckets.set(key, b);
  return {
    locked: now < b.unlockAt,
    retryAfterSec: now < b.unlockAt ? Math.ceil((b.unlockAt - now) / 1000) : undefined,
    attempts: b.count,
  };
}

/** 既にロックされているか確認（試行を計上しない）。 */
export function isLocked(key: string): { locked: boolean; retryAfterSec?: number } {
  const b = buckets.get(key);
  if (!b) return { locked: false };
  const now = Date.now();
  if (now >= b.unlockAt) return { locked: false };
  return { locked: true, retryAfterSec: Math.ceil((b.unlockAt - now) / 1000) };
}

/** 成功時にキーをクリア。 */
export function clearFailures(key: string) {
  buckets.delete(key);
}
