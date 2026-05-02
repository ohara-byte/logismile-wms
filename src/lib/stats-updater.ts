/**
 * 標準時間 / スキル係数 の自動更新ロジック（Phase 6-8 / 6-9）
 *
 * 用途:
 *  - 検品セッションの実績（duration_sec）から、グループごとの標準時間を再計算
 *  - 担当者ごとに「自分の平均時間 / 全体平均時間」でスキル係数を計算
 *
 * 呼出経路:
 *  - 管理PC からの手動トリガー（POST /api/cron/...）
 *  - 将来的に外部 cron（毎日深夜）から
 */

import { prisma } from './db';

const DEFAULT_DAYS = 30;

export interface StdTimeUpdateResult {
  windowDays: number;
  groupsUpdated: number;
  itemsUpdated: number;
  perGroup: Array<{
    groupId: string;
    sampleCount: number;
    avgDurationSec: number;
    stdMinNew: number;
  }>;
}

/**
 * グループ単位で std_min を再計算し std_times.stdMin を upsert（source='auto'）。
 *
 * - 直近 windowDays（既定 30 日）の完了セッション
 * - sample が 5 件未満のグループはスキップ（精度不足）
 */
export async function updateStdTimes(
  windowDays: number = DEFAULT_DAYS,
): Promise<StdTimeUpdateResult> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // 完了セッションを担当者経由でグループに紐付ける
  const sessions = await prisma.inspSession.findMany({
    where: {
      completedAt: { gte: since },
      durationSec: { not: null },
    },
    select: {
      durationSec: true,
      staff: { select: { groupId: true } },
    },
  });

  const map = new Map<string, { count: number; sumSec: number }>();
  for (const s of sessions) {
    const g = s.staff.groupId;
    if (!g) continue;
    const cur = map.get(g) ?? { count: 0, sumSec: 0 };
    cur.count += 1;
    cur.sumSec += s.durationSec ?? 0;
    map.set(g, cur);
  }

  const perGroup: StdTimeUpdateResult['perGroup'] = [];
  let groupsUpdated = 0;
  let itemsUpdated = 0;

  for (const [groupId, agg] of Array.from(map.entries())) {
    if (agg.count < 5) continue; // サンプル不足
    const avgSec = agg.sumSec / agg.count;
    const stdMinNew = Math.round((avgSec / 60) * 100) / 100;
    perGroup.push({ groupId, sampleCount: agg.count, avgDurationSec: Math.round(avgSec), stdMinNew });

    // グループ配下の全 std_times を一括更新
    const updated = await prisma.stdTime.updateMany({
      where: { groupId },
      data: { stdMin: stdMinNew, source: 'auto', updatedAt: new Date() },
    });
    if (updated.count > 0) {
      groupsUpdated += 1;
      itemsUpdated += updated.count;
    }
  }

  return { windowDays, groupsUpdated, itemsUpdated, perGroup };
}

export interface SkillUpdateResult {
  windowDays: number;
  staffUpdated: number;
  perStaff: Array<{
    staffCode: string;
    staffName: string;
    groupId: string | null;
    sampleCount: number;
    avgDurationSec: number;
    coefficient: number;
  }>;
}

/**
 * 担当者ごとの skill_coefficient を再計算。
 * 1.0 が標準。値が 1.0 より大きいほど「速い」（少ない秒で終わる）。
 *
 * 計算方法:
 *   - グループ平均秒 / 個人平均秒 = coefficient
 *     （個人がグループ平均より速ければ > 1.0）
 *   - 個人サンプルが 5 件未満なら更新しない（係数据え置き）
 *   - 上限・下限: [0.5, 2.0]
 */
export async function updateSkillCoefficients(
  windowDays: number = DEFAULT_DAYS,
): Promise<SkillUpdateResult> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const sessions = await prisma.inspSession.findMany({
    where: {
      completedAt: { gte: since },
      durationSec: { not: null },
    },
    select: {
      staffCode: true,
      durationSec: true,
      staff: { select: { groupId: true, name: true } },
    },
  });

  // staff 単位 + group 単位で集計
  const byStaff = new Map<
    string,
    { name: string; groupId: string | null; count: number; sumSec: number }
  >();
  const byGroup = new Map<string, { count: number; sumSec: number }>();
  for (const s of sessions) {
    const cur = byStaff.get(s.staffCode) ?? {
      name: s.staff.name,
      groupId: s.staff.groupId,
      count: 0,
      sumSec: 0,
    };
    cur.count += 1;
    cur.sumSec += s.durationSec ?? 0;
    byStaff.set(s.staffCode, cur);

    if (s.staff.groupId) {
      const g = byGroup.get(s.staff.groupId) ?? { count: 0, sumSec: 0 };
      g.count += 1;
      g.sumSec += s.durationSec ?? 0;
      byGroup.set(s.staff.groupId, g);
    }
  }

  const perStaff: SkillUpdateResult['perStaff'] = [];
  let staffUpdated = 0;
  const now = new Date();

  for (const [code, agg] of Array.from(byStaff.entries())) {
    if (agg.count < 5) continue; // サンプル不足は据え置き
    const personalAvg = agg.sumSec / agg.count;
    if (personalAvg <= 0) continue;

    let coefficient: number;
    const groupAgg = agg.groupId ? byGroup.get(agg.groupId) : null;
    if (groupAgg && groupAgg.count >= 5) {
      const groupAvg = groupAgg.sumSec / groupAgg.count;
      coefficient = groupAvg / personalAvg;
    } else {
      // グループ平均が取れないなら 1.0（中立）
      coefficient = 1.0;
    }
    coefficient = Math.max(0.5, Math.min(2.0, coefficient));
    const rounded = Math.round(coefficient * 1000) / 1000;

    await prisma.staff.update({
      where: { code },
      data: { skillCoefficient: rounded, skillUpdatedAt: now },
    });
    staffUpdated += 1;
    perStaff.push({
      staffCode: code,
      staffName: agg.name,
      groupId: agg.groupId,
      sampleCount: agg.count,
      avgDurationSec: Math.round(personalAvg),
      coefficient: rounded,
    });
  }

  return { windowDays, staffUpdated, perStaff };
}
