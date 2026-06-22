/**
 * 注文ごとの予定梱包時間（2026-06-22）。
 * = セット標準時間（SetComp.stdSec を構成品コードの一致で逆引き）
 *   ＋ のし加算（熨斗名称が、エアパック語を除いて非空のとき）
 *   ＋ エアパック加算（熨斗名称(O列)にエアパック語を含むとき）
 * セット時間が引けない注文は呼び出し側のフォールバック秒（グループ平均）を使う。
 */

import { prisma } from '@/lib/db';

export interface PackTimeCtx {
  noshiAddSec: number;
  airpackAddSec: number;
  airpackKeyword: string;
  /** 構成品コード集合の署名 → セット標準時間(秒) */
  setSecBySignature: Map<string, number>;
}

function signature(codes: string[]): string {
  return [...new Set(codes.map((c) => c.trim()).filter(Boolean))].sort().join('|');
}

export async function loadPackTimeCtx(): Promise<PackTimeCtx> {
  const settings = await prisma.appSetting.findMany({
    where: { key: { in: ['pack.noshi_add_sec', 'pack.airpack_add_sec', 'pack.airpack_keyword'] } },
    select: { key: true, value: true },
  });
  const get = (k: string) => settings.find((s) => s.key === k)?.value;
  const noshiAddSec = parseInt(get('pack.noshi_add_sec') ?? '0', 10) || 0;
  const airpackAddSec = parseInt(get('pack.airpack_add_sec') ?? '0', 10) || 0;
  const airpackKeyword = (get('pack.airpack_keyword') ?? '').trim();

  const sets = await prisma.setComp.findMany({
    where: { stdSec: { not: null } },
    select: { stdSec: true, children: { select: { childCode: true } } },
  });
  const setSecBySignature = new Map<string, number>();
  for (const s of sets) {
    const sig = signature(s.children.map((c) => c.childCode));
    if (sig && s.stdSec != null) setSecBySignature.set(sig, s.stdSec);
  }
  return { noshiAddSec, airpackAddSec, airpackKeyword, setSecBySignature };
}

/** 1注文の予定梱包時間（秒）。fallbackSec はセット時間が引けないときに使う基準値。 */
export function orderExpectedSec(
  ctx: PackTimeCtx,
  itemCodes: string[],
  noshiName: string | null,
  fallbackSec: number,
): number {
  const setSec = ctx.setSecBySignature.get(signature(itemCodes));
  let sec = setSec ?? fallbackSec;
  const noshi = (noshiName ?? '').trim();
  if (ctx.airpackKeyword && noshi.includes(ctx.airpackKeyword)) {
    sec += ctx.airpackAddSec;
    // エアパック語を除いた残りが非空なら のし扱い（エアパックのみは のし加算しない）
    if (noshi.split(ctx.airpackKeyword).join('').trim() !== '') sec += ctx.noshiAddSec;
  } else if (noshi !== '') {
    sec += ctx.noshiAddSec;
  }
  return sec;
}
