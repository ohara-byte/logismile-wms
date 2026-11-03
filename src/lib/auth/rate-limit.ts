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

/*
 * ★ タブレット／ハンディのログイン（社員番号のみ）の制限値（小原様承認 2026-11-03）。
 *
 * 発端（2026-11-03 11:30 頃・現場報告）：未ログインの端末すべてで、どの社員番号でも
 * 「試行回数を超過しました」になり、待つと直った。以前にも繰り返していた。
 *
 * 原因：IP ごとの制限が「5分に5回で15分ロック」だった。倉庫の端末は VPS から見ると
 * **全台が同じ1つの IP**（拠点のグローバル IP）に見えるため、現場の誰かの入力ミスが
 * 全員ぶん合算され、5回で**全端末がまとめて**15分止まっていた。
 *
 * このログインは社内ネットワークからしか開けない（INTRANET_CIDR_LIST）ので、
 * IP ごとの制限が守っているのは「社内からの大量の総当たり」だけ。入力ミス数回で
 * 現場全体を止めないよう大きく緩め、総当たりだけを止める値にする。
 */

/** 社員番号ごと：同じ番号で5分に5回失敗したら5分止める。 */
export const EMPLOYEE_LOGIN_LIMIT: RateLimitOptions = {
  windowSec: 5 * 60,
  lockoutSec: 5 * 60,
  maxAttempts: 5,
};

/** 拠点（IP）ごと：拠点全体で5分に30回失敗したら5分止める（入力ミス数回では止めない）。 */
export const SITE_LOGIN_LIMIT: RateLimitOptions = {
  windowSec: 5 * 60,
  lockoutSec: 5 * 60,
  maxAttempts: 30,
};

/**
 * ロック中の案内文。
 * 拠点全体のロックを「自分の社員番号が悪い」と誤解させない（2026-11-03 現場報告）。
 */
export function loginLockMessage(scope: 'site' | 'employee', retryAfterSec: number): string {
  const min = Math.max(1, Math.ceil(retryAfterSec / 60));
  const unlock = '管理者は管理PCの「設定 → ログイン強制解除」ですぐに解除できます。';
  return scope === 'site'
    ? `この拠点からのログイン失敗が続いたため、ログインを一時停止しています（社員番号の誤りではありません）。${min} 分後に再試行してください。${unlock}`
    : `この社員番号でログイン失敗が続いたため、一時停止しています。${min} 分後に再試行してください。${unlock}`;
}

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

/**
 * Sprint Z-5: 設定タブから現在の失敗バケットを参照するためのインスペクタ。
 * key は `<scope>:<value>` 形式（例：`emp:E001` / `ip:192.168.1.10`）。
 * 既に解除されたバケットは除外。
 */
export interface BucketSnapshot {
  key: string;
  attempts: number;
  firstAttemptAt: number;
  unlockAt: number;
  locked: boolean;
  retryAfterSec: number;
}

export function listBuckets(): BucketSnapshot[] {
  const now = Date.now();
  const out: BucketSnapshot[] = [];
  for (const [key, b] of buckets) {
    const locked = b.unlockAt > 0 && now < b.unlockAt;
    out.push({
      key,
      attempts: b.count,
      firstAttemptAt: b.firstAttemptAt,
      unlockAt: b.unlockAt,
      locked,
      retryAfterSec: locked ? Math.ceil((b.unlockAt - now) / 1000) : 0,
    });
  }
  return out;
}

/** 全バケット消去（緊急時用） */
export function clearAllBuckets(): number {
  const n = buckets.size;
  buckets.clear();
  return n;
}
