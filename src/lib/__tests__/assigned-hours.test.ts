import { describe, it, expect } from 'vitest';
import {
  assignedMinutesByGroup,
  assignedMinutesByStaff,
  barMinutes,
  groupAt,
  hhmmToMinutes,
  indexBars,
  jstDayAndMinute,
  mergedMinutes,
  minutesToHours,
  perHour,
  type AssignmentBar,
} from '../assigned-hours';

/**
 * MHT（テーブル配置時間ベースの人時）— 小原様 2026-09-17。
 * 「②テーブル配置時間当たりの梱包件数で計算 … MHT」
 */

const bar = (
  dateKey: string,
  staffCode: string,
  groupId: string,
  startTime: string,
  endTime: string,
): AssignmentBar => ({ dateKey, staffCode, groupId, startTime, endTime });

describe('hhmmToMinutes / barMinutes', () => {
  it('"HH:MM" を分に直す（表記ゆれも吸収）', () => {
    expect(hhmmToMinutes('09:00')).toBe(540);
    expect(hhmmToMinutes('9:0')).toBe(540);
    expect(hhmmToMinutes('1730')).toBe(1050);
  });

  it('不正な値は null', () => {
    expect(hhmmToMinutes('')).toBeNull();
    expect(hhmmToMinutes(null)).toBeNull();
    expect(hhmmToMinutes('25:00')).toBeNull();
  });

  it('★ 終了が開始以下（未入力・逆転）は 0 分。集計を壊さない', () => {
    expect(barMinutes('09:00', '12:00')).toBe(180);
    expect(barMinutes('12:00', '09:00')).toBe(0);
    expect(barMinutes('09:00', '09:00')).toBe(0);
    expect(barMinutes('09:00', '')).toBe(0);
  });
});

describe('mergedMinutes', () => {
  it('重ならない区間はそのまま足す', () => {
    expect(
      mergedMinutes([
        { start: 540, end: 720 },
        { start: 780, end: 1020 },
      ]),
    ).toBe(180 + 240);
  });

  it('★ 重なりは1回だけ数える（在席時間は1人ぶんしかない）', () => {
    expect(
      mergedMinutes([
        { start: 540, end: 720 },
        { start: 660, end: 780 },
      ]),
    ).toBe(240); // 9:00-13:00
  });

  it('入れ子の区間も1回だけ', () => {
    expect(
      mergedMinutes([
        { start: 540, end: 1020 },
        { start: 600, end: 660 },
      ]),
    ).toBe(480);
  });

  it('隣接（12:00終わり→12:00始まり）はつながる', () => {
    expect(
      mergedMinutes([
        { start: 540, end: 720 },
        { start: 720, end: 780 },
      ]),
    ).toBe(240);
  });

  it('空・不正区間は 0', () => {
    expect(mergedMinutes([])).toBe(0);
    expect(mergedMinutes([{ start: 720, end: 540 }])).toBe(0);
  });
});

describe('assignedMinutesByStaff', () => {
  it('担当者ごとに合計する', () => {
    const min = assignedMinutesByStaff([
      bar('2026-09-01', 'S0136', 'G1', '09:00', '12:00'),
      bar('2026-09-01', 'S0200', 'G1', '09:00', '18:00'),
    ]);
    expect(min.get('S0136')).toBe(180);
    expect(min.get('S0200')).toBe(540);
  });

  it('★ 日が違えば同じ時間帯でも別々に足す（重なりではない）', () => {
    const min = assignedMinutesByStaff([
      bar('2026-09-01', 'S0136', 'G1', '09:00', '12:00'),
      bar('2026-09-02', 'S0136', 'G1', '09:00', '12:00'),
    ]);
    expect(min.get('S0136')).toBe(360);
  });

  it('★ 同じ日に別グループへ二重配置されていても人時は二重に数えない', () => {
    const min = assignedMinutesByStaff([
      bar('2026-09-01', 'S0136', 'G1', '09:00', '13:00'),
      bar('2026-09-01', 'S0136', 'G2', '11:00', '15:00'),
    ]);
    expect(min.get('S0136')).toBe(360); // 9:00-15:00
  });
});

describe('assignedMinutesByGroup', () => {
  it('人数ぶん足す（2人が同時刻なら2人時）', () => {
    const min = assignedMinutesByGroup([
      bar('2026-09-01', 'S0136', 'G1', '09:00', '12:00'),
      bar('2026-09-01', 'S0200', 'G1', '09:00', '12:00'),
    ]);
    expect(min.get('G1')).toBe(360);
  });

  it('同じ人・同じグループの重なりは1回だけ', () => {
    const min = assignedMinutesByGroup([
      bar('2026-09-01', 'S0136', 'G1', '09:00', '13:00'),
      bar('2026-09-01', 'S0136', 'G1', '11:00', '15:00'),
    ]);
    expect(min.get('G1')).toBe(360);
  });

  it('グループが違えばそれぞれ数える', () => {
    const min = assignedMinutesByGroup([
      bar('2026-09-01', 'S0136', 'G1', '09:00', '12:00'),
      bar('2026-09-01', 'S0136', 'G2', '13:00', '17:00'),
    ]);
    expect(min.get('G1')).toBe(180);
    expect(min.get('G2')).toBe(240);
  });
});

describe('minutesToHours / perHour', () => {
  it('分を人時（小数2桁）にする', () => {
    expect(minutesToHours(90)).toBe(1.5);
    expect(minutesToHours(100)).toBe(1.67);
  });

  it('1人時あたりの件数', () => {
    expect(perHour(120, 8)).toBe(15);
    expect(perHour(100, 3)).toBe(33.3);
  });

  it('★ 人時 0（配置が未登録）は null。0 と区別する', () => {
    expect(perHour(120, 0)).toBeNull();
    expect(perHour(0, 0)).toBeNull();
    expect(perHour(0, 8)).toBe(0);
  });
});

describe('jstDayAndMinute', () => {
  it('JST の暦日と分に直す', () => {
    // 2026-09-01 10:30 JST = 2026-09-01T01:30Z
    const d = new Date('2026-09-01T01:30:00.000Z');
    expect(jstDayAndMinute(d)).toEqual({ dateKey: '2026-09-01', minute: 630 });
  });

  it('★ JST 0:00〜8:59 が前日に落ちない（UTC 暦日と違う）', () => {
    // 2026-09-02 00:30 JST = 2026-09-01T15:30Z
    const d = new Date('2026-09-01T15:30:00.000Z');
    expect(jstDayAndMinute(d)).toEqual({ dateKey: '2026-09-02', minute: 30 });
  });
});

describe('groupAt', () => {
  const idx = indexBars([
    bar('2026-09-01', 'S0136', 'G1', '09:00', '12:00'),
    bar('2026-09-01', 'S0136', 'G2', '13:00', '17:00'),
  ]);

  it('その時刻に配置されていたグループを返す', () => {
    expect(groupAt(idx, 'S0136', '2026-09-01', 600)).toBe('G1'); // 10:00
    expect(groupAt(idx, 'S0136', '2026-09-01', 840)).toBe('G2'); // 14:00
  });

  it('終了時刻ちょうどは含まない（次のバーと二重計上しない）', () => {
    expect(groupAt(idx, 'S0136', '2026-09-01', 720)).toBeNull(); // 12:00
    expect(groupAt(idx, 'S0136', '2026-09-01', 780)).toBe('G2'); // 13:00 は含む
  });

  it('配置の時間外・別の日・別の人は null', () => {
    expect(groupAt(idx, 'S0136', '2026-09-01', 1080)).toBeNull(); // 18:00
    expect(groupAt(idx, 'S0136', '2026-09-02', 600)).toBeNull();
    expect(groupAt(idx, 'S9999', '2026-09-01', 600)).toBeNull();
  });
});
