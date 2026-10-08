import { describe, it, expect } from 'vitest';
import {
  lunchGap,
  revisitGroups,
  paceByGroup,
  MIN_COUNT,
  MIN_WORKED_MIN,
  type ScanRecord,
} from '../dashboard/scan-pace';
import { paceBadge } from '../dashboard/work-pace';

/**
 * 変更要望（3件）久保様 2026-10-04 — No.1（分母）／No.2（行き来）／No.3（テーブル別）。
 * 要望書に書かれた実例と受け入れ条件をそのまま試験にしている。
 */

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

const of = (rows: ReturnType<typeof paceByGroup>, gid: string) => rows.find((r) => r.groupId === gid);

describe('No.1 分母はスキャン実績（割当の合計時間ではない）', () => {
  it('★ 受け入れ条件：矢部さん 2026-10-02 午前 195件 09:31〜11:59 → 約79件/時（🟢）', () => {
    // 割当は午前3.5h＋午後3.5h＝7時間（午後は前裁きでスキャンが残らない）。
    // 旧実装は 195 ÷ 420分 × 60 ＝ 27.9 件/時（🔴）になっていた。
    const rows = paceByGroup(run('ABCSML', '09:31', '11:59', 195));
    const r = of(rows, 'ABCSML')!;
    expect(r.count).toBe(195);
    expect(r.workedMin).toBe(148);
    expect(r.perHour).toBeCloseTo(79.1, 1);
    // ABCSML の 🟢 は 70 以上
    expect(paceBadge(r.perHour, { yellowMin: 45, greenMin: 70 })).toBe('green');
  });

  it('★ 受け入れ条件：山本さん 2026-10-04 12:07 時点 75件 09:04〜12:07 → 24.6件/時（🟢）', () => {
    // 割当は DOKON-K 09:00-14:00（5時間）。旧実装は 75 ÷ 5.0h ＝ 15.0 件/時（🔴）。
    const rows = paceByGroup(run('DOKON-K', '09:04', '12:07', 75));
    const r = of(rows, 'DOKON-K')!;
    expect(r.workedMin).toBe(183); // 昼休憩なしで働き続けた人は控除されない
    expect(r.perHour).toBe(24.6);
    // 同梱の 🟢 は 24 以上
    expect(paceBadge(r.perHour, { yellowMin: 20, greenMin: 24 })).toBe('green');
  });

  it('★ 受け入れ条件：メンバー割当は入力に無い（割当を変えても値が変わらない）', () => {
    // paceByGroup の引数はスキャン実績だけ。割当を渡す口が無いことを型で固定する。
    const rows = paceByGroup(run('ABCSML', '09:00', '11:00', 100));
    expect(of(rows, 'ABCSML')!.workedMin).toBe(120);
  });

  it('昼休憩を取った人は 12:00〜13:00 の空きが引かれる', () => {
    const records = [...run('I', '09:00', '12:00', 90), ...run('I', '13:00', '16:00', 90)];
    const r = of(paceByGroup(records), 'I')!;
    expect(r.count).toBe(180);
    expect(r.workedMin).toBe(360); // 09:00〜16:00（420分）− 昼60分
  });

  it('★ 受け入れ条件：休憩を取らない人は昼の1時間を引かれない', () => {
    // 2分に1枚のペースで 09:00〜16:00（420分）を通して処理した人。
    // 引かれるのはスキャンの間隔ぶん（2分）だけで、実質ゼロ。
    const r = of(paceByGroup(run('I', '09:00', '16:00', 210)), 'I')!;
    expect(r.workedMin).toBe(418);
  });

  it('実働30分未満は数字を出さない（1件目の直後に値が跳ねるのを防ぐ）', () => {
    const r = of(paceByGroup(run('ABCSML', '09:00', '09:20', 20)), 'ABCSML')!;
    expect(r.workedMin).toBeLessThan(MIN_WORKED_MIN);
    expect(r.perHour).toBeNull();
    expect(r.reason).toBe('too_short');
  });

  it('件数が15件未満も数字を出さない（手伝いで少し触っただけのテーブル）', () => {
    const r = of(paceByGroup(run('ABCSML', '09:00', '10:00', 10)), 'ABCSML')!;
    expect(r.count).toBeLessThan(MIN_COUNT);
    expect(r.perHour).toBeNull();
    expect(r.reason).toBe('too_few');
  });

  it('完了していない伝票（保留中）は分子にも分母にも入れない', () => {
    const records: ScanRecord[] = [
      ...run('I', '09:00', '11:00', 60),
      { groupId: 'I', startMin: min('11:30'), endMin: null },
    ];
    const r = of(paceByGroup(records), 'I')!;
    expect(r.count).toBe(60);
    expect(r.workedMin).toBe(120);
  });
});

describe('No.1 昼休憩の自動控除（設定を増やさない）', () => {
  it('12:00〜13:00 にスキャンが1件も無ければ 60分まるごと', () => {
    expect(lunchGap(run('I', '09:00', '12:00', 10))).toEqual({ from: 720, to: 780 });
  });

  it('途中まで働いて休んだ人は、その空きだけ', () => {
    const records = [...run('I', '09:00', '12:30', 50), ...run('I', '13:00', '16:00', 50)];
    expect(lunchGap(records)).toEqual({ from: min('12:30'), to: min('13:00') });
  });

  it('働き続けた人はほぼ 0 分（最長の空きがスキャンの間隔ぶんしかない）', () => {
    const gap = lunchGap(run('I', '09:00', '16:00', 210)); // 2分に1件
    expect(gap!.to - gap!.from).toBeLessThanOrEqual(2);
  });

  it('★ 保留した伝票が昼をまたいでも、休憩の控除は消えない', () => {
    // 11:50 に着手して 15:00 に完了した1枚。区間で塞がっていると見ると控除が消える。
    const records: ScanRecord[] = [
      ...run('I', '09:00', '11:50', 80),
      { groupId: 'I', startMin: min('11:50'), endMin: min('15:00') },
      ...run('I', '13:00', '15:00', 60),
    ];
    expect(lunchGap(records)).toEqual({ from: 720, to: 780 });
  });
});

describe('No.2 行き来の判定はスキャン実績で行う', () => {
  // 2026-10-04 12:07 時点の4人（要望書の実例）。
  const yabe = run('ABCSML', '09:20', '12:00', 207); // 昼休憩で割当は2本に分かれている人
  const kakehi = run('I', '10:05', '12:00', 50);
  const hiraki = run('DOKON-K', '09:03', '12:00', 60);
  const yamamoto = run('DOKON-K', '09:04', '12:07', 75); // 昼休憩なし（割当1本）

  it('★ 受け入れ条件：12:07 時点では4人とも「行き来」にならない', () => {
    for (const records of [yabe, kakehi, hiraki, yamamoto]) {
      expect(revisitGroups(records).size).toBe(0);
      expect(paceByGroup(records).every((r) => r.perHour != null)).toBe(true);
    }
  });

  it('★ 受け入れ条件：実際に往復した平木さんだけが集計対象外になる', () => {
    // 14:20 以降、同梱 と ABCSML を実際に往復している
    const records = [
      ...run('DOKON-K', '09:03', '14:20', 100),
      ...run('ABCSML', '14:25', '15:00', 20),
      ...run('DOKON-K', '15:05', '16:00', 20),
    ];
    expect(revisitGroups(records)).toEqual(new Set(['DOKON-K']));
    expect(of(paceByGroup(records), 'DOKON-K')!.reason).toBe('revisit');
    expect(of(paceByGroup(records), 'ABCSML')!.revisit).toBe(false);
  });

  it('★ 午前A・午後B のような通常の2テーブル勤務は、両方とも集計する', () => {
    const records = [
      ...run('ABCSML', '09:00', '12:00', 100),
      ...run('I', '13:00', '16:00', 100),
    ];
    expect(revisitGroups(records).size).toBe(0);
    expect(paceByGroup(records).every((r) => r.perHour != null)).toBe(true);
  });

  it('★ 昼休憩で作業が分かれても、同じテーブルなら1まとまり', () => {
    const records = [...run('I', '09:00', '12:00', 90), ...run('I', '13:00', '16:00', 90)];
    expect(revisitGroups(records).size).toBe(0);
  });

  it('並べ替えは着手時刻で行う（保留の完了が遅れても順番が崩れない）', () => {
    const records: ScanRecord[] = [
      { groupId: 'DOKON-K', startMin: min('09:00'), endMin: min('15:30') }, // 保留で完了が夕方
      { groupId: 'DOKON-K', startMin: min('09:05'), endMin: min('09:10') },
      { groupId: 'ABCSML', startMin: min('14:00'), endMin: min('14:10') },
    ];
    // 完了時刻で並べると 同梱 → ABCSML → 同梱 となり誤って「行き来」になる
    expect(revisitGroups(records).size).toBe(0);
  });
});

describe('No.3 テーブルごとの作業ペース', () => {
  it('★ 受け入れ条件：有本さん 2026-10-02 夕方は 同梱（数字あり・🟢）と ABCSML（—）の2行', () => {
    // 同梱を 09:12〜15:28（昼休憩あり）、15:36 から ABCSML を手伝った日。
    // 件/時の正確な値は実際のスキャン時刻によるため、ここでは 🟢 に入ることを見る。
    const records = [
      ...run('DOKON-K', '09:12', '12:00', 70),
      ...run('DOKON-K', '13:00', '15:28', 75),
      ...run('ABCSML', '15:36', '15:50', 10), // 手伝いで少数
    ];
    const rows = paceByGroup(records);
    expect(rows.map((r) => r.groupId)).toEqual(['DOKON-K', 'ABCSML']); // 件数の多い順

    const dokon = rows[0]!;
    expect(dokon.count).toBe(145);
    expect(dokon.perHour).not.toBeNull();
    expect(paceBadge(dokon.perHour, { yellowMin: 20, greenMin: 24 })).toBe('green');

    // ★ 手伝いで少数しか触っていないテーブルに 🔴 を出さない
    const abcsml = rows[1]!;
    expect(abcsml.perHour).toBeNull();
    expect(paceBadge(abcsml.perHour, { yellowMin: 45, greenMin: 70 })).toBeNull();
  });

  it('件数の多い順に並ぶ', () => {
    const records = [
      ...run('I', '09:00', '10:00', 20),
      ...run('ABCSML', '10:10', '12:00', 60),
      ...run('O', '13:00', '14:00', 40),
    ];
    expect(paceByGroup(records).map((r) => r.groupId)).toEqual(['ABCSML', 'O', 'I']);
  });

  it('スキャンが無ければ行は出ない', () => {
    expect(paceByGroup([])).toEqual([]);
  });
});
