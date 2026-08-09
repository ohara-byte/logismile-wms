/**
 * 連絡事項（Notice）の宛先判定
 *
 * 2026-08-09 新規:
 *   従来は `api/notices/route.ts` の GET 内にインラインで書かれていた判定を純関数に切り出した。
 *   理由は 2 つ:
 *     1. `table`（作業テーブル宛）を新設するにあたり、誤配信が業務事故に直結するため
 *        ユニットテストで固定したかった
 *     2. 旧実装は `group` を `staff.groupId` の単発比較で判定していたが、
 *        当日の割当（member_assignments）で複数グループに入る運用があるため複数化が必要だった
 *
 * 宛先種別:
 *   all    … 全端末
 *   tablet … タブレットのみ
 *   handy  … ハンディのみ
 *   group  … 検品グループ（当日割当ベース。無ければ担当者マスタの所属で補完）
 *   table  … 作業テーブル記号（A〜Z）。グループが持つ tables に含まれるかで判定
 *   staff  … 担当者個人（社員コード一致）
 */

export interface NoticeTarget {
  targetType: string;
  targetId: string | null;
}

/** 受信者（端末＋ログイン中の担当者）の文脈。 */
export interface RecipientCtx {
  /** 端末種別。devices.type（'tablet' | 'handy'）。不明なら null */
  deviceType: string | null;
  /** ログイン中の社員コード */
  staffCode: string | null;
  /** この担当者が属する検品グループ ID（当日割当優先・複数可） */
  groupIds: string[];
  /** 上記グループが受け持つ作業テーブル記号（大文字・重複排除済み） */
  tableLetters: string[];
}

/** テーブル記号の正規化（大文字・前後空白除去）。空文字は null 扱い。 */
export function normalizeTableLetter(
  input: string | null | undefined,
): string | null {
  const v = (input ?? '').trim().toUpperCase();
  return v === '' ? null : v;
}

/**
 * この連絡が受信者に配信されるべきか。
 *
 * ★ 未知の targetType は従来どおり配信する（true）。
 *   レガシー値での取りこぼしを防ぐための既定であり、意図的に残している。
 *   一方 `table` / `group` / `staff` は targetId が無ければ配信しない ―
 *   「宛先未確定の連絡が全員に飛ぶ」ほうが事故になるため。
 */
export function matchesNoticeTarget(
  notice: NoticeTarget,
  ctx: RecipientCtx,
): boolean {
  switch (notice.targetType) {
    case 'all':
      return true;

    case 'tablet':
      return ctx.deviceType === 'tablet';

    case 'handy':
      return ctx.deviceType === 'handy';

    case 'group':
      return !!notice.targetId && ctx.groupIds.includes(notice.targetId);

    case 'table': {
      const t = normalizeTableLetter(notice.targetId);
      return !!t && ctx.tableLetters.includes(t);
    }

    case 'staff':
      return !!notice.targetId && notice.targetId === ctx.staffCode;

    default:
      // 未知・レガシーの targetType は取りこぼし防止で配信する
      return true;
  }
}
