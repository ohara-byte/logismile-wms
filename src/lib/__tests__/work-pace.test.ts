import { describe, it, expect } from 'vitest';
import {
  PACE_BADGE_EMOJI,
  paceBadge,
  paceBadgeText,
  perHourRate,
} from '../dashboard/work-pace';

/**
 * 作業ペース（要望書「LogiSmile現場向け進捗表示機能の追加」要望③）。
 *
 * 固定したいこと：
 *  ① 件/時 ＝ 伝票枚数 ÷ 実働時間（休憩を除く）
 *  ② 境界はその値を含めて上の段（「45〜70」＝ 45 以上 70 未満が 🟡）
 *  ③ 目標値が未設定のグループはバッジを出さない（コードに固定値を埋めない）
 *  ④ 同じグループに1日で2回以上戻る「行き来」だけ集計対象外
 */

describe('perHourRate', () => {
  it('★ 要望書の例：32件 ÷ 実働85分 × 60 = 22.6 件/時', () => {
    expect(perHourRate(32, 85)).toBe(22.6);
  });

  it('60分ちょうどなら件数がそのまま', () => {
    expect(perHourRate(20, 60)).toBe(20);
  });

  it('★ 実働 0 は null（「0 件/時」と区別する）', () => {
    // 配置が未登録の日にペースを出すと、休んでいた人が要注意に見えてしまう
    expect(perHourRate(10, 0)).toBeNull();
    expect(perHourRate(10, -5)).toBeNull();
  });

  it('件数 0 は 0（実働があるならペース 0 は事実）', () => {
    expect(perHourRate(0, 60)).toBe(0);
  });
});

describe('paceBadge', () => {
  // 要望書の DOKON-K：🔴〜20 ／ 🟡20〜24 ／ 🟢24〜
  const dokon = { yellowMin: 20, greenMin: 24 };

  it('★ 境界はその値を含めて上の段', () => {
    expect(paceBadge(19.9, dokon)).toBe('red');
    expect(paceBadge(20, dokon)).toBe('yellow');
    expect(paceBadge(23.9, dokon)).toBe('yellow');
    expect(paceBadge(24, dokon)).toBe('green');
  });

  it('要望書の例：22.6 件/時 は 🟡 標準', () => {
    expect(paceBadge(22.6, dokon)).toBe('yellow');
  });

  it('★ 目標値が未設定のグループはバッジを出さない', () => {
    expect(paceBadge(30, { yellowMin: null, greenMin: null })).toBeNull();
    expect(paceBadge(30, { yellowMin: 20, greenMin: null })).toBeNull();
    expect(paceBadge(30, { yellowMin: null, greenMin: 24 })).toBeNull();
  });

  it('ペースが出せない（配置未登録）ならバッジも出さない', () => {
    expect(paceBadge(null, dokon)).toBeNull();
  });

  it('要望書の他グループも同じ規則で判定できる', () => {
    expect(paceBadge(70, { yellowMin: 45, greenMin: 70 })).toBe('green'); // ABCSML
    expect(paceBadge(26, { yellowMin: 25, greenMin: 32 })).toBe('yellow'); // I
    expect(paceBadge(29, { yellowMin: 30, greenMin: 34 })).toBe('red'); // O
    expect(paceBadge(21, { yellowMin: 18, greenMin: 21 })).toBe('green'); // RQ
  });
});

describe('paceBadgeText', () => {
  const dokon = { yellowMin: 20, greenMin: 24 };

  it('★ 範囲を添える（あと何件で上の段かが分かる）', () => {
    expect(paceBadgeText('yellow', dokon)).toBe('🟡 標準ペース（20〜24）');
    expect(paceBadgeText('red', dokon)).toBe('🔴 要注意（〜20）');
    expect(paceBadgeText('green', dokon)).toBe('🟢 好調（24〜）');
  });

  it('目標値が無ければ範囲を書かない', () => {
    expect(paceBadgeText('yellow', { yellowMin: null, greenMin: null })).toBe('🟡 標準ペース');
  });

  it('絵文字は要望書のとおり', () => {
    expect(PACE_BADGE_EMOJI.red).toBe('🔴');
    expect(PACE_BADGE_EMOJI.yellow).toBe('🟡');
    expect(PACE_BADGE_EMOJI.green).toBe('🟢');
  });
});

// 行き来（同じグループへ1日で2回以上戻る）の判定は scan-pace.test.ts に移した
// （変更要望 No.2・久保様 2026-10-04。配置バーではなくスキャン実績で見る）。
