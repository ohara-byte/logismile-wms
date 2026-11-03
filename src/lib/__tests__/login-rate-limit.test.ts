import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordFailure,
  isLocked,
  clearAllBuckets,
  loginLockMessage,
  EMPLOYEE_LOGIN_LIMIT,
  SITE_LOGIN_LIMIT,
} from '../auth/rate-limit';

/**
 * タブレット／ハンディのログイン制限（小原様承認 2026-11-03）。
 *
 * 発端：2026-11-03 11:30 頃、未ログインの端末すべてで、どの社員番号でも
 * 「試行回数を超過しました」になった。倉庫の端末は VPS から見ると全台が同じ IP のため、
 * 現場の誰かの入力ミスが合算され、5回で全端末が15分止まっていた。
 */

const SITE = 'ip:203.0.113.10'; // 拠点のグローバル IP（全端末共通）

/** 社員番号の入力ミス1回（route.ts と同じく、社員番号と拠点の両方に数える）。 */
function typo(empCode: string) {
  recordFailure(`emp:${empCode}`, EMPLOYEE_LOGIN_LIMIT);
  recordFailure(SITE, SITE_LOGIN_LIMIT);
}

beforeEach(() => {
  clearAllBuckets();
});

describe('拠点（IP）ごとの制限', () => {
  it('★ 現場の別々の人が5回入力ミスしても、全端末は止まらない（11/3 の再現）', () => {
    for (const code of ['34', '0340', '3400', '12', '999']) typo(code);
    expect(isLocked(SITE).locked).toBe(false);
    // 正しい社員番号 340 の人は入れる
    expect(isLocked('emp:340').locked).toBe(false);
  });

  it('大量の総当たり（5分に30回）だけは止める', () => {
    for (let i = 0; i < 29; i++) typo(String(1000 + i));
    expect(isLocked(SITE).locked).toBe(false);
    typo('9999');
    const lock = isLocked(SITE);
    expect(lock.locked).toBe(true);
    expect(lock.retryAfterSec).toBeLessThanOrEqual(5 * 60); // 15分 → 5分
  });
});

describe('社員番号ごとの制限', () => {
  it('同じ社員番号で5回失敗したら、その番号だけ5分止める', () => {
    for (let i = 0; i < 5; i++) typo('340');
    const lock = isLocked('emp:340');
    expect(lock.locked).toBe(true);
    expect(lock.retryAfterSec).toBeLessThanOrEqual(5 * 60);
    // 他の人と拠点全体は止まらない
    expect(isLocked('emp:341').locked).toBe(false);
    expect(isLocked(SITE).locked).toBe(false);
  });
});

describe('案内文', () => {
  it('★ 拠点全体のロックは「社員番号の誤りではない」と伝え、すぐ解除する方法を出す', () => {
    const msg = loginLockMessage('site', 240);
    expect(msg).toContain('この拠点から');
    expect(msg).toContain('社員番号の誤りではありません');
    expect(msg).toContain('4 分後');
    expect(msg).toContain('ログイン強制解除');
  });

  it('社員番号のロックはその番号のことだと伝える', () => {
    const msg = loginLockMessage('employee', 61);
    expect(msg).toContain('この社員番号で');
    expect(msg).toContain('2 分後');
  });

  it('残り1分未満でも「0 分後」と出さない', () => {
    expect(loginLockMessage('site', 5)).toContain('1 分後');
  });
});
