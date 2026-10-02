import { describe, it, expect } from 'vitest';
import { splitByLunchBreak, LUNCH_START, LUNCH_END } from '../lunch-break';
import {
  overlaps,
  findOverlaps,
  freeSpans,
  subtractSpan,
  minutesToHHMM,
} from '../assignment-overlap';

/**
 * 不具合要望 No.1（休憩）／No.4（重なり）— 久保様 2026-10-01。
 * 要望書に書かれた実例をそのまま試験にしている。
 */

describe('No.1 昼休憩を抜く（マスタの休憩時間で判定）', () => {
  it('★ H7(8:00-17:00・休憩60分) が2本に分かれる（固定リストに無く抜けていた）', () => {
    expect(splitByLunchBreak('08:00', '17:00', 60)).toEqual([
      { startTime: '08:00', endTime: '12:00' },
      { startTime: '13:00', endTime: '17:00' },
    ]);
  });

  it('従来2本になっていた A7 等も同じ結果（挙動を変えない）', () => {
    expect(splitByLunchBreak('09:00', '18:00', 60)).toEqual([
      { startTime: '09:00', endTime: '12:00' },
      { startTime: '13:00', endTime: '18:00' },
    ]);
  });

  it('★ 休憩時間が0のパターンは分けない', () => {
    expect(splitByLunchBreak('08:00', '17:00', 0)).toEqual([
      { startTime: '08:00', endTime: '17:00' },
    ]);
    expect(splitByLunchBreak('08:00', '17:00', null)).toEqual([
      { startTime: '08:00', endTime: '17:00' },
    ]);
    expect(splitByLunchBreak('08:00', '17:00', undefined)).toEqual([
      { startTime: '08:00', endTime: '17:00' },
    ]);
  });

  it('午後開始（D6/D7 等）は休憩帯を勤務しないのでそのまま', () => {
    expect(splitByLunchBreak('13:00', '18:00', 60)).toEqual([
      { startTime: '13:00', endTime: '18:00' },
    ]);
    expect(splitByLunchBreak('14:00', '18:00', 60)).toEqual([
      { startTime: '14:00', endTime: '18:00' },
    ]);
  });

  it('午前で終業もそのまま', () => {
    expect(splitByLunchBreak('08:00', '12:00', 60)).toEqual([
      { startTime: '08:00', endTime: '12:00' },
    ]);
  });

  it('休憩帯をまたぐが片側しかない場合', () => {
    expect(splitByLunchBreak('11:00', '12:30', 60)).toEqual([
      { startTime: '11:00', endTime: '12:00' },
    ]);
    expect(splitByLunchBreak('12:30', '17:00', 60)).toEqual([
      { startTime: '13:00', endTime: '17:00' },
    ]);
  });

  it('時刻の表記ゆれは正規化される', () => {
    expect(splitByLunchBreak('8:00', '1700', 60)).toEqual([
      { startTime: '08:00', endTime: '12:00' },
      { startTime: '13:00', endTime: '17:00' },
    ]);
  });

  it('休憩帯は 12:00〜13:00', () => {
    expect(LUNCH_START).toBe('12:00');
    expect(LUNCH_END).toBe('13:00');
  });
});

describe('No.4 重なりの判定', () => {
  it('★ 12:00 で終わる割当と 12:00 から始まる割当は重ならない（休憩の前後）', () => {
    expect(
      overlaps({ startTime: '09:00', endTime: '12:00' }, { startTime: '12:00', endTime: '16:00' }),
    ).toBe(false);
  });

  it('同じ時間はもちろん重なり', () => {
    expect(
      overlaps({ startTime: '09:00', endTime: '12:00' }, { startTime: '09:00', endTime: '12:00' }),
    ).toBe(true);
  });

  it('一部でも重なれば重なり', () => {
    expect(
      overlaps({ startTime: '09:00', endTime: '16:00' }, { startTime: '13:00', endTime: '16:00' }),
    ).toBe(true);
    expect(
      overlaps({ startTime: '09:00', endTime: '13:00' }, { startTime: '12:00', endTime: '16:00' }),
    ).toBe(true);
  });

  it('逆転・不正な時刻は重なり扱いしない（保存ガードで別途弾く）', () => {
    expect(
      overlaps({ startTime: '16:00', endTime: '09:00' }, { startTime: '09:00', endTime: '16:00' }),
    ).toBe(false);
    expect(
      overlaps({ startTime: 'あ', endTime: 'い' }, { startTime: '09:00', endTime: '16:00' }),
    ).toBe(false);
  });
});

describe('No.4 findOverlaps（保存前の検査）', () => {
  it('★ 要望書の実例：平木さんの ABCSML と DOKON-K が同じ時間に重なる', () => {
    const found = findOverlaps([
      { staffCode: 'hiraki', startTime: '09:00', endTime: '12:00' },
      { staffCode: 'hiraki', startTime: '13:00', endTime: '16:00' },
      { staffCode: 'hiraki', startTime: '09:00', endTime: '12:00' }, // DOKON-K（同一時間）
    ]);
    expect(found).toHaveLength(1);
  });

  it('★ 要望書の実例：同一内容が2件（橋本さん O 09:00-13:00）', () => {
    expect(
      findOverlaps([
        { staffCode: 'hashimoto', startTime: '09:00', endTime: '13:00' },
        { staffCode: 'hashimoto', startTime: '09:00', endTime: '13:00' },
      ]),
    ).toHaveLength(1);
  });

  it('担当者が違えば重ならない', () => {
    expect(
      findOverlaps([
        { staffCode: 'a', startTime: '09:00', endTime: '16:00' },
        { staffCode: 'b', startTime: '09:00', endTime: '16:00' },
      ]),
    ).toHaveLength(0);
  });

  it('★ 午前・午後に分けた通常の2本勤務は重ならない', () => {
    expect(
      findOverlaps([
        { staffCode: 'a', startTime: '09:00', endTime: '12:00' },
        { staffCode: 'a', startTime: '13:00', endTime: '16:00' },
      ]),
    ).toHaveLength(0);
  });

  it('空でも落ちない', () => {
    expect(findOverlaps([])).toHaveLength(0);
  });
});

describe('No.4 freeSpans（ピッカーの初期値＝未割当の時間）', () => {
  it('★ 9:00〜16:00 を登録済みなら空きなし', () => {
    expect(
      freeSpans([{ startTime: '09:00', endTime: '16:00' }], '09:00', '16:00'),
    ).toEqual([]);
  });

  it('★ 午前だけ埋まっていれば午後が初期値になる', () => {
    expect(freeSpans([{ startTime: '09:00', endTime: '12:00' }], '09:00', '16:00')).toEqual([
      { startTime: '12:00', endTime: '16:00' },
    ]);
  });

  it('前後が空いていれば両方返す（開始順）', () => {
    expect(freeSpans([{ startTime: '11:00', endTime: '13:00' }], '09:00', '16:00')).toEqual([
      { startTime: '09:00', endTime: '11:00' },
      { startTime: '13:00', endTime: '16:00' },
    ]);
  });

  it('割当が無ければ勤務時間まるごと', () => {
    expect(freeSpans([], '08:00', '17:00')).toEqual([
      { startTime: '08:00', endTime: '17:00' },
    ]);
  });

  it('重なった割当があっても正しく空きを出す', () => {
    expect(
      freeSpans(
        [
          { startTime: '09:00', endTime: '14:00' },
          { startTime: '13:00', endTime: '15:00' },
        ],
        '09:00',
        '18:00',
      ),
    ).toEqual([{ startTime: '15:00', endTime: '18:00' }]);
  });

  it('順不同でも結果は同じ', () => {
    expect(
      freeSpans(
        [
          { startTime: '13:00', endTime: '16:00' },
          { startTime: '09:00', endTime: '12:00' },
        ],
        '09:00',
        '18:00',
      ),
    ).toEqual([
      { startTime: '12:00', endTime: '13:00' },
      { startTime: '16:00', endTime: '18:00' },
    ]);
  });

  it('勤務時間が不正なら空', () => {
    expect(freeSpans([], '17:00', '09:00')).toEqual([]);
  });
});

describe('No.4 subtractSpan（置き換えてベースの残りを残す）', () => {
  it('★ 要望書の例：9:00〜16:00 の ABCSML に 13:00〜16:00 を入れると 9:00〜13:00 が残る', () => {
    expect(
      subtractSpan({ startTime: '09:00', endTime: '16:00' }, { startTime: '13:00', endTime: '16:00' }),
    ).toEqual([{ startTime: '09:00', endTime: '13:00' }]);
  });

  it('前半を置き換えると後半が残る', () => {
    expect(
      subtractSpan({ startTime: '09:00', endTime: '16:00' }, { startTime: '09:00', endTime: '12:00' }),
    ).toEqual([{ startTime: '12:00', endTime: '16:00' }]);
  });

  it('★ 真ん中を置き換えると前後2本が残る（中抜き）', () => {
    expect(
      subtractSpan({ startTime: '09:00', endTime: '16:00' }, { startTime: '12:00', endTime: '13:00' }),
    ).toEqual([
      { startTime: '09:00', endTime: '12:00' },
      { startTime: '13:00', endTime: '16:00' },
    ]);
  });

  it('まるごと覆うと何も残らない', () => {
    expect(
      subtractSpan({ startTime: '13:00', endTime: '16:00' }, { startTime: '09:00', endTime: '18:00' }),
    ).toEqual([]);
  });

  it('重ならなければそのまま残る', () => {
    const base = { startTime: '09:00', endTime: '12:00' };
    expect(subtractSpan(base, { startTime: '13:00', endTime: '16:00' })).toEqual([base]);
    // 端が接するだけも「重ならない」
    expect(subtractSpan(base, { startTime: '12:00', endTime: '16:00' })).toEqual([base]);
  });
});

describe('minutesToHHMM', () => {
  it('ゼロ付き2桁で返す', () => {
    expect(minutesToHHMM(0)).toBe('00:00');
    expect(minutesToHHMM(9 * 60)).toBe('09:00');
    expect(minutesToHHMM(13 * 60 + 30)).toBe('13:30');
  });
});
