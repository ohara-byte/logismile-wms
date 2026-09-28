import { describe, it, expect } from 'vitest';
import {
  PACE_BADGE_EMOJI,
  isRevisitPattern,
  paceBadge,
  paceBadgeText,
  perHourRate,
  visitBlockCount,
} from '../dashboard/work-pace';
import {
  UNCLASSIFIED,
  buildLetterToGroup,
  groupOfPkNo,
  tableLetterOf,
} from '../dashboard/group-map';

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

describe('visitBlockCount / isRevisitPattern', () => {
  it('★ 午前A・午後B のような一般的な2テーブル勤務は対象（各グループ1ブロック）', () => {
    // グループAに 9:00-12:00 だけ居た → 1ブロック
    expect(visitBlockCount([{ start: 540, end: 720 }])).toBe(1);
    expect(isRevisitPattern([{ start: 540, end: 720 }])).toBe(false);
  });

  it('★ 同じグループに1日で2回以上戻る「行き来」は集計対象外', () => {
    // 9:00-12:00 に居て、他へ行き、15:00-17:00 にまた戻った
    const spans = [
      { start: 540, end: 720 },
      { start: 900, end: 1020 },
    ];
    expect(visitBlockCount(spans)).toBe(2);
    expect(isRevisitPattern(spans)).toBe(true);
  });

  it('隣接・重なりは1つのまとまりとして数える（バーを分けて置いただけ）', () => {
    expect(
      visitBlockCount([
        { start: 540, end: 720 },
        { start: 720, end: 780 },
      ]),
    ).toBe(1);
    expect(
      visitBlockCount([
        { start: 540, end: 720 },
        { start: 660, end: 780 },
      ]),
    ).toBe(1);
  });

  it('順不同で渡しても結果は同じ', () => {
    const spans = [
      { start: 900, end: 1020 },
      { start: 540, end: 720 },
    ];
    expect(visitBlockCount(spans)).toBe(2);
  });

  it('空・不正な区間は数えない', () => {
    expect(visitBlockCount([])).toBe(0);
    expect(visitBlockCount([{ start: 720, end: 540 }])).toBe(0);
    expect(isRevisitPattern([])).toBe(false);
  });
});

/**
 * グループ判定（group-map.ts）— 管理PC と現場端末で同じ規則を使うことを固定する。
 * 片方だけ直すと、同じ伝票が画面ごとに別のグループに見える。
 */
describe('group-map（伝票 → テーブルグループ）', () => {
  const groups = [
    { id: 'ABCSML', tables: ['A', 'B', 'S', 'C', 'M', 'L'] },
    { id: 'I', tables: ['I'] },
    { id: 'O', tables: ['O'] },
    { id: 'RQ', tables: ['R', 'Q'] },
    { id: 'DOKON-K', tables: ['D', 'E', 'T', 'F', 'V', 'N', 'G', 'P', 'J', 'H', 'U', 'K'] },
  ];

  it('★ ピッキング№の2文字目でテーブルを判定する（要望書の対応表）', () => {
    const map = buildLetterToGroup(groups);
    expect(groupOfPkNo(map, 'SA01208680006')).toBe('ABCSML'); // 2文字目 A
    expect(groupOfPkNo(map, 'SI01208680006')).toBe('I');
    expect(groupOfPkNo(map, 'SO01208680006')).toBe('O');
    expect(groupOfPkNo(map, 'SR01208680006')).toBe('RQ');
    expect(groupOfPkNo(map, 'SD01208680006')).toBe('DOKON-K');
  });

  it('小文字でも拾う', () => {
    const map = buildLetterToGroup(groups);
    expect(groupOfPkNo(map, 'sa01208680006')).toBe('ABCSML');
  });

  it('★ 同じ文字が複数グループにあれば先勝ち（マスタの並び順が効く）', () => {
    const map = buildLetterToGroup([
      { id: 'K', tables: ['K'] },
      { id: 'SAS', tables: ['K', 'A'] },
    ]);
    expect(map.get('K')).toBe('K');
  });

  it('該当が無ければ未分類（伝票を取りこぼさない）', () => {
    const map = buildLetterToGroup(groups);
    expect(groupOfPkNo(map, 'SZ01208680006')).toBe(UNCLASSIFIED);
    expect(groupOfPkNo(map, 'S')).toBe(UNCLASSIFIED);
    expect(groupOfPkNo(map, '')).toBe(UNCLASSIFIED);
  });

  it('テーブル文字を取り出す', () => {
    expect(tableLetterOf('SA01208680006')).toBe('A');
    expect(tableLetterOf('S')).toBe('');
  });
});
