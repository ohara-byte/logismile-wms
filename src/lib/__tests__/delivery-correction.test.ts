import { describe, it, expect } from 'vitest';
import {
  CORRECTION_MOVEMENT_TYPE,
  CORRECTION_REASON_LABEL,
  CORRECTION_REF_TYPE,
  applicableDelta,
  correctionNote,
  parseCorrectionReason,
} from '../integration/delivery-correction';

/**
 * 工場納品の訂正（数量修正・取り戻し）— 小原様ご依頼 2026-09-28。
 *
 * 固定したいこと：
 *  ① 在庫を **0 未満にしない**（引ける分だけ引く）
 *  ② 引ききれなかった数を黙って捨てない（shortfall で返す）
 *  ③ 増減ログの文面に「元の納品・区分・要求と実績」が残る
 */

describe('applicableDelta', () => {
  it('加算はそのまま通す', () => {
    expect(applicableDelta(0, 5)).toEqual({ applied: 5, shortfall: 0 });
    expect(applicableDelta(100, 5)).toEqual({ applied: 5, shortfall: 0 });
  });

  it('在庫の範囲内の減算はそのまま引く', () => {
    expect(applicableDelta(10, -4)).toEqual({ applied: -4, shortfall: 0 });
    expect(applicableDelta(10, -10)).toEqual({ applied: -10, shortfall: 0 });
  });

  it('★ 在庫を 0 未満にしない。引ける分だけ引き、残りは shortfall で返す', () => {
    // 倉庫の実在庫がマイナスになることは有り得ない（小原様確定）
    expect(applicableDelta(3, -10)).toEqual({ applied: -3, shortfall: 7 });
    expect(applicableDelta(0, -10)).toEqual({ applied: 0, shortfall: 10 });
  });

  it('★ 在庫が既にマイナスでも 0 として扱う（さらに沈めない）', () => {
    expect(applicableDelta(-5, -10)).toEqual({ applied: 0, shortfall: 10 });
  });

  it('小数は切り捨てる（集計を壊さない）', () => {
    expect(applicableDelta(10, -4.9)).toEqual({ applied: -4, shortfall: 0 });
    expect(applicableDelta(10.9, -20)).toEqual({ applied: -10, shortfall: 10 });
  });
});

describe('parseCorrectionReason', () => {
  it('return 以外はすべて数量修正として扱う', () => {
    expect(parseCorrectionReason('return')).toBe('return');
    expect(parseCorrectionReason('qty_fix')).toBe('qty_fix');
    expect(parseCorrectionReason('なにか')).toBe('qty_fix');
  });

  it('画面に出す日本語', () => {
    expect(CORRECTION_REASON_LABEL.qty_fix).toBe('数量修正');
    expect(CORRECTION_REASON_LABEL.return).toBe('取り戻し');
  });
});

describe('correctionNote', () => {
  const base = {
    correctionNo: 'C-0001',
    originalDeliveryNo: 'D20260928-0001',
    reason: 'return' as const,
  };

  it('元の納品・区分・増減が1行で分かる', () => {
    const s = correctionNote({ ...base, requestedDelta: -5, appliedDelta: -5 });
    expect(s).toContain('C-0001');
    expect(s).toContain('D20260928-0001');
    expect(s).toContain('取り戻し');
    expect(s).toContain('-5');
  });

  it('加算は符号を付けて出す', () => {
    const s = correctionNote({
      ...base,
      reason: 'qty_fix',
      requestedDelta: 3,
      appliedDelta: 3,
    });
    expect(s).toContain('数量修正');
    expect(s).toContain('+3');
  });

  it('★ 引ききれなかったときは要求値も残す（黙って減らさない）', () => {
    const s = correctionNote({ ...base, requestedDelta: -10, appliedDelta: -3 });
    expect(s).toContain('-3');
    expect(s).toContain('要求 -10');
    expect(s).toContain('在庫不足');
  });

  it('備考があれば末尾に付く', () => {
    const s = correctionNote({
      ...base,
      requestedDelta: -1,
      appliedDelta: -1,
      note: '検品で1個破損',
    });
    expect(s).toContain('検品で1個破損');
  });

  it('空白だけの備考は付けない', () => {
    const s = correctionNote({ ...base, requestedDelta: -1, appliedDelta: -1, note: '   ' });
    expect(s.trimEnd()).toBe(s.trimEnd());
    expect(s).not.toContain('  検品');
  });
});

describe('在庫増減ログの種別', () => {
  it('★ 工場納品(inbound)と区別できる値を使う', () => {
    expect(CORRECTION_MOVEMENT_TYPE).toBe('factory_correction');
    expect(CORRECTION_MOVEMENT_TYPE).not.toBe('inbound');
    expect(CORRECTION_REF_TYPE).toBe('factory_delivery_correction');
  });
});
