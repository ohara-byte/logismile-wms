import { describe, it, expect } from 'vitest';
import {
  lunchGap,
  blocksOf,
  paceByGroup,
  MIN_COUNT,
  MIN_WORKED_MIN,
  type ScanRecord,
} from '../dashboard/scan-pace';
import { paceBadge } from '../dashboard/work-pace';

/**
 * 変更要望「個人進捗の作業ペースを『テーブル別』の表示に一本化する」（久保様 2026-10-10）。
 * 受け入れ条件（実データ）をそのまま試験にしている。
 *
 * 目標値はマスタの設定値（要望書の参考値）：
 *   ABCSML 45/70 ／ 同梱 20/24 ／ I 25/32 ／ O 30/34 ／ RQ 18/21
 */

const TARGET = {
  ABCSML: { yellowMin: 45, greenMin: 70 },
  'DOKON-K': { yellowMin: 20, greenMin: 24 },
  I: { yellowMin: 25, greenMin: 32 },
  O: { yellowMin: 30, greenMin: 34 },
  RQ: { yellowMin: 18, greenMin: 21 },
} as const;

const min = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** 伝票 n 枚を from〜to に等間隔で並べる（着手〜完了が隙間なく続く形）。 */
function run(groupId: string, from: string, to: string, n: number): ScanRecord[] {
  const a = min(from);
  const b = min(to);
  const step = (b - a) / n;
  return Array.from({ length: n }, (_, i) => ({
    groupId,
    startMin: Math.round(a + step * i),
    endMin: Math.round(a + step * (i + 1)),
  }));
}

const of = (rows: ReturnType<typeof paceByGroup>, gid: string) => rows.find((r) => r.groupId === gid)!;

/** 表示した行の件数と「その他」の合計が ①本日の処理件数 と一致すること。 */
function assertTotals(rows: ReturnType<typeof paceByGroup>, totalCount: number) {
  const shown = rows.filter((r) => r.shown).reduce((n, r) => n + r.count, 0);
  const other = rows.filter((r) => !r.shown).reduce((n, r) => n + r.count, 0);
  expect(shown + other).toBe(totalCount);
}

describe('受け入れ条件：有本 道子さん 2026-10-10（出戻りがあっても主なテーブルの数字が出る）', () => {
  // 同梱を 09:21〜14:43 に 128件（昼休憩あり）→ ABCSML を 14件手伝う → 同梱へ戻って 5件。
  // 旧実装はこれを「同じテーブルを行き来した日」として**集計対象外**にしていた。
  const records = [
    ...run('DOKON-K', '09:21', '12:00', 80),
    ...run('DOKON-K', '13:00', '14:43', 48),
    ...run('ABCSML', '14:45', '15:05', 14),
    ...run('DOKON-K', '15:07', '15:15', 5),
  ];
  const rows = paceByGroup(records);

  it('★ 同梱 133件・270分・29.6件/時・好調（集計対象外にならない）', () => {
    const dokon = of(rows, 'DOKON-K');
    expect(dokon.count).toBe(133);
    expect(dokon.workedMin).toBe(270); // (09:21〜14:43 − 昼60分) ＋ (15:07〜15:15)
    expect(dokon.perHour).toBe(29.6);
    expect(paceBadge(dokon.perHour, TARGET['DOKON-K'])).toBe('green');
    expect(dokon.shown).toBe(true);
  });

  it('★ 間に挟んだ ABCSML の時間（20分）は同梱の作業時間に入らない', () => {
    // 最初の着手〜最後の完了（09:21〜15:15 − 昼60分 ＝ 294分）ではない
    expect(of(rows, 'DOKON-K').workedMin).toBe(270);
  });

  it('★ ABCSML 14件は数字を出さず「その他のテーブル」に回る', () => {
    const abcsml = of(rows, 'ABCSML');
    expect(abcsml.count).toBe(14);
    expect(abcsml.shown).toBe(false);
    expect(abcsml.perHour).toBeNull();
  });

  it('★ 表示した行＋その他 ＝ 147件', () => assertTotals(rows, 147));
});

describe('受け入れ条件：小原 玖美子さん 2026-10-10（2テーブルに数字が出る）', () => {
  const records = [
    ...run('O', '09:00', '11:15', 60),
    ...run('I', '11:20', '11:58', 23),
    ...run('DOKON-K', '13:00', '13:20', 14),
    ...run('ABCSML', '13:25', '13:30', 4),
  ];
  const rows = paceByGroup(records);

  it('★ O 60件・135分・26.7件/時・要注意（〜30）', () => {
    const o = of(rows, 'O');
    expect([o.count, o.workedMin, o.perHour]).toEqual([60, 135, 26.7]);
    expect(paceBadge(o.perHour, TARGET.O)).toBe('red');
  });

  it('★ I 23件・38分・36.3件/時・好調（32〜）', () => {
    const i = of(rows, 'I');
    expect([i.count, i.workedMin, i.perHour]).toEqual([23, 38, 36.3]);
    expect(paceBadge(i.perHour, TARGET.I)).toBe('green');
  });

  it('★ 並び順は作業時間の長い順', () => {
    expect(rows.filter((r) => r.shown).map((r) => r.groupId)).toEqual(['O', 'I']);
  });

  it('★ その他のテーブル 18件（同梱14・ABCSML4）／合計 101件', () => {
    expect(rows.filter((r) => !r.shown).reduce((n, r) => n + r.count, 0)).toBe(18);
    assertTotals(rows, 101);
  });
});

describe('受け入れ条件：柿田 朋子さん 2026-10-10（割当が無くても数字が出る）', () => {
  // 計算に使うのはスキャン実績だけ。メンバー割当は引数にも無い。
  const records = [
    ...run('O', '09:00', '09:44', 27),
    ...run('RQ', '09:50', '10:10', 8),
    ...run('ABCSML', '10:15', '10:25', 5),
    ...run('I', '10:30', '10:40', 4),
  ];
  const rows = paceByGroup(records);

  it('★ O 27件・44分・36.8件/時・好調（34〜）', () => {
    const o = of(rows, 'O');
    expect([o.count, o.workedMin, o.perHour]).toEqual([27, 44, 36.8]);
    expect(paceBadge(o.perHour, TARGET.O)).toBe('green');
  });

  it('★ その他 17件（RQ8・ABCSML5・I4）／合計 44件', () => {
    expect(rows.filter((r) => r.shown).map((r) => r.groupId)).toEqual(['O']);
    assertTotals(rows, 44);
  });
});

describe('REQ-2 塊（ブロック）ごとの時間を足す', () => {
  it('同じテーブルが2つの塊に分かれたら、両方の時間を足す', () => {
    const records = [
      ...run('RQ', '09:00', '10:00', 30), // 60分
      ...run('ABCSML', '10:05', '11:00', 20), // 混ざらない
      ...run('RQ', '11:05', '12:05', 31), // 60分
    ];
    const rq = of(paceByGroup(records), 'RQ');
    expect(rq.count).toBe(61);
    expect(rq.workedMin).toBe(120);
  });

  it('塊に切るのは着手時刻の順（保留の完了が遅れても順番が崩れない）', () => {
    const records: ScanRecord[] = [
      { groupId: 'DOKON-K', startMin: min('09:00'), endMin: min('15:30') }, // 保留で完了が夕方
      { groupId: 'DOKON-K', startMin: min('09:05'), endMin: min('09:10') },
      { groupId: 'ABCSML', startMin: min('14:00'), endMin: min('14:10') },
    ];
    expect(blocksOf(records).map((b) => b.groupId)).toEqual(['DOKON-K', 'ABCSML']);
  });

  it('完了していない伝票（保留中）は件数にも時間にも入れない', () => {
    const records: ScanRecord[] = [
      ...run('I', '09:00', '11:00', 60),
      { groupId: 'I', startMin: min('11:30'), endMin: null },
    ];
    const i = of(paceByGroup(records), 'I');
    expect([i.count, i.workedMin]).toEqual([60, 120]);
  });

  it('着手〜完了が数時間に及ぶ伝票があると塊の時間は伸びる（現状どおりの扱い）', () => {
    const records: ScanRecord[] = [
      { groupId: 'I', startMin: min('09:00'), endMin: min('09:05') },
      { groupId: 'I', startMin: min('09:06'), endMin: min('14:00') }, // 保留
    ];
    // 09:00〜14:00（300分）− 昼60分。実際に手を動かしたのは数分でも、
    // 塊の時間は保留の完了まで伸びる（要望書 REQ-2「今回は変更を求めない」）。
    expect(of(paceByGroup(records), 'I').workedMin).toBe(240);
  });
});

describe('REQ-2 表示条件（15件以上 かつ 30分以上）', () => {
  it('件数が足りなければ出さない', () => {
    const r = of(paceByGroup(run('ABCSML', '09:00', '10:00', 10)), 'ABCSML');
    expect(r.count).toBeLessThan(MIN_COUNT);
    expect([r.shown, r.perHour]).toEqual([false, null]);
  });

  it('時間が足りなければ出さない', () => {
    const r = of(paceByGroup(run('ABCSML', '09:00', '09:20', 20)), 'ABCSML');
    expect(r.workedMin).toBeLessThan(MIN_WORKED_MIN);
    expect([r.shown, r.perHour]).toEqual([false, null]);
  });

  it('ちょうど 15件・30分 なら出す', () => {
    const r = of(paceByGroup(run('ABCSML', '09:00', '09:30', 15)), 'ABCSML');
    expect([r.count, r.workedMin, r.shown]).toEqual([15, 30, true]);
  });

  it('★ 数字を出せるテーブルが1つも無い日（案内だけを出す）', () => {
    const rows = paceByGroup(run('ABCSML', '09:00', '09:10', 5));
    expect(rows.some((r) => r.shown)).toBe(false);
  });

  it('スキャンが無ければ行は出ない', () => {
    expect(paceByGroup([])).toEqual([]);
  });
});

describe('昼休憩の自動控除（塊ごとに適用する）', () => {
  it('12:00〜13:00 にスキャンが1件も無ければ 60分まるごと', () => {
    expect(lunchGap(run('I', '09:00', '12:00', 10))).toEqual({ from: 720, to: 780 });
  });

  it('途中まで働いて休んだ人は、その空きだけ', () => {
    const records = [...run('I', '09:00', '12:30', 50), ...run('I', '13:00', '16:00', 50)];
    expect(lunchGap(records)).toEqual({ from: min('12:30'), to: min('13:00') });
  });

  it('★ 休憩を取らない人は控除されない（引かれてもスキャンの間隔ぶん）', () => {
    const r = of(paceByGroup(run('I', '09:00', '16:00', 210)), 'I'); // 2分に1件
    expect(r.workedMin).toBe(418); // 420分 − 2分
  });

  it('★ 保留した伝票が昼をまたいでも、休憩の控除は消えない', () => {
    const records: ScanRecord[] = [
      ...run('I', '09:00', '11:50', 80),
      { groupId: 'I', startMin: min('11:50'), endMin: min('15:00') },
      ...run('I', '13:00', '15:00', 60),
    ];
    expect(lunchGap(records)).toEqual({ from: 720, to: 780 });
  });

  it('同じテーブルが続いていれば間が空いても1つの塊（昼休憩だけが引かれる）', () => {
    const records = [...run('O', '09:00', '11:00', 40), ...run('O', '13:10', '15:00', 40)];
    expect(of(paceByGroup(records), 'O').workedMin).toBe(300); // 09:00〜15:00 − 昼60分
  });

  it('昼休憩をまたがない塊は引かれない', () => {
    const records = [
      ...run('O', '09:00', '11:00', 40),
      ...run('I', '11:05', '11:50', 20),
      ...run('O', '13:10', '15:00', 40),
    ];
    const rows = paceByGroup(records);
    expect(of(rows, 'O').workedMin).toBe(120 + 110); // どちらの塊も昼にかからない
    expect(of(rows, 'I').workedMin).toBe(45);
  });
});
