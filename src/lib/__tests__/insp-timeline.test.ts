import { describe, it, expect } from 'vitest';
import {
  TIMELINE_HEADERS,
  airPackUsed,
  csvCell,
  csvLine,
  jstDateTime,
  noshiUsed,
  parseBasis,
  statusLabel,
  timelineFilename,
  timelineRow,
  ymd,
  type TimelineSource,
} from '../insp-timeline';

/**
 * 検品タイムライン CSV（現場からの依頼・2026-09-17）。
 * 「全ステータスを出力対象とする（保留・キャンセルも含める）」
 */

const nameOf = (code: string) => (code === 'S0136' ? '山田 太郎' : '');

function src(over: Partial<TimelineSource> = {}): TimelineSource {
  return {
    shipDate: new Date('2026-06-01T00:00:00.000Z'),
    pkNo: 'PK-0001',
    status: 'packed',
    deletedAt: null,
    noshiName: null,
    noshiPerson: null,
    itemCount: 3,
    session: {
      staffCode: 'S0136',
      startedAt: new Date('2026-06-01T01:00:00.000Z'), // 10:00 JST
      completedAt: new Date('2026-06-01T01:02:30.000Z'), // 10:02:30 JST
    },
    ...over,
  };
}

describe('parseBasis', () => {
  it('start 以外はすべて出荷日基準（既定）', () => {
    expect(parseBasis('start')).toBe('start');
    expect(parseBasis('ship')).toBe('ship');
    expect(parseBasis(null)).toBe('ship');
    expect(parseBasis('なにか')).toBe('ship');
  });
});

describe('statusLabel', () => {
  it('伝票ステータスを日本語にする', () => {
    expect(statusLabel('pending', null)).toBe('未着手');
    expect(statusLabel('inspecting', null)).toBe('検品中');
    expect(statusLabel('packed', null)).toBe('梱包完了');
    expect(statusLabel('shipped', null)).toBe('出荷済');
    expect(statusLabel('held', null)).toBe('保留');
  });

  it('★ 削除済み（現場の言う「キャンセル」）は status より優先して表示する', () => {
    expect(statusLabel('packed', new Date())).toBe('削除済（キャンセル）');
    expect(statusLabel('held', new Date())).toBe('削除済（キャンセル）');
  });

  it('知らない値はそのまま出す（握りつぶさない）', () => {
    expect(statusLabel('unknown_x', null)).toBe('unknown_x');
  });
});

describe('jstDateTime / ymd', () => {
  it('★ JST で出す（サーバのタイムゾーンに依存しない）', () => {
    expect(jstDateTime(new Date('2026-06-01T01:02:30.000Z'))).toBe('2026-06-01 10:02:30');
    // JST 0:30 は前日の UTC。日付が前日に落ちないこと
    expect(jstDateTime(new Date('2026-06-01T15:30:00.000Z'))).toBe('2026-06-02 00:30:00');
  });

  it('未検品（null）は空欄', () => {
    expect(jstDateTime(null)).toBe('');
    expect(ymd(null)).toBe('');
  });

  it('出荷日（@db.Date）は UTC 暦日のまま', () => {
    expect(ymd(new Date('2026-06-01T00:00:00.000Z'))).toBe('2026-06-01');
  });
});

describe('airPackUsed / noshiUsed', () => {
  it('熨斗名称に判定語が含まれればエアパック', () => {
    expect(airPackUsed('エアパック', 'エアパック')).toBe(true);
    expect(airPackUsed('御中元 エアパック', 'エアパック')).toBe(true);
    expect(airPackUsed('御中元', 'エアパック')).toBe(false);
    expect(airPackUsed(null, 'エアパック')).toBe(false);
  });

  it('★ 判定語が未設定なら「判定できない」= null（「無」ではない）', () => {
    expect(airPackUsed('エアパック', '')).toBeNull();
    expect(airPackUsed(null, '  ')).toBeNull();
  });

  it('エアパック語だけの熨斗名称は のし扱いにしない（梱包時間の加算規則と同じ）', () => {
    expect(noshiUsed('エアパック', 'エアパック')).toBe(false);
    expect(noshiUsed('御中元 エアパック', 'エアパック')).toBe(true);
    expect(noshiUsed('御中元', 'エアパック')).toBe(true);
    expect(noshiUsed('', 'エアパック')).toBe(false);
    expect(noshiUsed(null, 'エアパック')).toBe(false);
  });
});

describe('timelineRow', () => {
  it('依頼の【出力項目】の順に並ぶ', () => {
    const row = timelineRow(src(), nameOf, 'エアパック');
    expect(row).toEqual([
      '2026-06-01',
      'PK-0001',
      'S0136',
      '山田 太郎',
      '2026-06-01 10:00:00',
      '2026-06-01 10:02:30',
      '3',
      '梱包完了',
      '',
      '',
      '',
      '',
    ]);
    expect(row).toHaveLength(TIMELINE_HEADERS.length);
  });

  it('★ 未検品の伝票も行として出す（着手・完了・担当者は空欄）', () => {
    const row = timelineRow(src({ session: null, status: 'pending' }), nameOf, 'エアパック');
    expect(row[2]).toBe('');
    expect(row[3]).toBe('');
    expect(row[4]).toBe('');
    expect(row[5]).toBe('');
    expect(row[7]).toBe('未着手');
  });

  it('検品中（完了していない）は完了時刻だけ空欄', () => {
    const row = timelineRow(
      src({
        status: 'inspecting',
        session: {
          staffCode: 'S0136',
          startedAt: new Date('2026-06-01T01:00:00.000Z'),
          completedAt: null,
        },
      }),
      nameOf,
      'エアパック',
    );
    expect(row[4]).toBe('2026-06-01 10:00:00');
    expect(row[5]).toBe('');
    expect(row[7]).toBe('検品中');
  });

  it('のし・エアパックを書き分ける', () => {
    const row = timelineRow(
      src({ noshiName: '御中元 エアパック', noshiPerson: '大江 一郎' }),
      nameOf,
      'エアパック',
    );
    expect(row[8]).toBe('有'); // のし有無
    expect(row[9]).toBe('御中元 エアパック'); // のし名称
    expect(row[10]).toBe('大江 一郎'); // のし氏名
    expect(row[11]).toBe('有'); // エアパック
  });

  it('★ 判定語が未設定ならエアパック欄は空（「無」と断定しない）', () => {
    const row = timelineRow(src({ noshiName: 'エアパック' }), nameOf, '');
    expect(row[11]).toBe('');
  });
});

describe('CSV 整形', () => {
  it('カンマ・引用符・改行を含むセルを囲む', () => {
    expect(csvCell('通常')).toBe('通常');
    expect(csvCell('あ,い')).toBe('"あ,い"');
    expect(csvCell('"引用"')).toBe('"""引用"""');
    expect(csvCell('改行\nあり')).toBe('"改行\nあり"');
  });

  it('見出し行を組み立てる', () => {
    expect(csvLine(TIMELINE_HEADERS).split(',')[0]).toBe('出荷日');
    expect(csvLine(['a', 'b,c'])).toBe('a,"b,c"');
  });

  it('ファイル名に期間と基準が入る', () => {
    expect(timelineFilename('2026-06-01', '2026-09-17', 'ship')).toBe(
      'insp-timeline-ship-2026-06-01-2026-09-17.csv',
    );
  });
});
