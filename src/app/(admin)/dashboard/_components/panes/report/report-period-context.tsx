'use client';

/**
 * レポート期間ツールバー Context（A-Rep1）
 *
 * 全サブタブで共通の期間粒度・範囲・比較設定を保持する。
 * URL パラメータ（?rfrom, ?rto, ?rgran, ?rcompare）で永続化し
 * リロードや共有時にも状態を維持。
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { addDaysUTC, formatDateYmd, jstYmd, parseDateAsUTC } from '@/lib/date-utils';

export type Granularity = 'day' | 'week' | 'month' | 'custom';
export type Comparison = 'prev_period' | 'prev_year' | 'none';

interface PeriodValue {
  granularity: Granularity;
  setGranularity: (g: Granularity) => void;
  from: string;
  to: string;
  setFrom: (s: string) => void;
  setTo: (s: string) => void;
  comparison: Comparison;
  setComparison: (c: Comparison) => void;
  /** YYYY-MM-DD 計算用 */
  fromDate: Date;
  toDate: Date;
  daysCount: number;
}

const Ctx = createContext<PeriodValue | null>(null);

function defaultRange(g: Granularity): { from: string; to: string } {
  // JST の暦日を基準にする。従来は setHours + toISOString で UTC 日になり、
  //   JST 00:00〜08:59 に開くと既定期間が丸ごと1日前倒しになっていた（2026-08-07 是正）。
  const today = parseDateAsUTC(jstYmd(new Date()))!;
  const to = formatDateYmd(today);
  const from =
    g === 'month'
      ? new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, today.getUTCDate()),
        )
      : addDaysUTC(today, g === 'day' ? -6 : g === 'week' ? -27 : -13);
  return { from: formatDateYmd(from), to };
}

export function ReportPeriodProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();

  const initial = useMemo(() => {
    const g = (params.get('rgran') as Granularity) || 'day';
    const def = defaultRange(g);
    return {
      granularity: g,
      from: params.get('rfrom') || def.from,
      to: params.get('rto') || def.to,
      comparison: (params.get('rcompare') as Comparison) || 'prev_period',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [granularity, setGranularity] = useState<Granularity>(initial.granularity);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [comparison, setComparison] = useState<Comparison>(initial.comparison);

  // URL を反映
  useEffect(() => {
    const sp = new URLSearchParams(params.toString());
    sp.set('rgran', granularity);
    sp.set('rfrom', from);
    sp.set('rto', to);
    sp.set('rcompare', comparison);
    router.replace(`/dashboard?${sp.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, from, to, comparison]);

  const fromDate = new Date(from);
  const toDate = new Date(to);
  const daysCount =
    Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;

  return (
    <Ctx.Provider
      value={{
        granularity,
        setGranularity: (g) => {
          setGranularity(g);
          if (g !== 'custom') {
            const def = defaultRange(g);
            setFrom(def.from);
            setTo(def.to);
          }
        },
        from,
        to,
        setFrom,
        setTo,
        comparison,
        setComparison,
        fromDate,
        toDate,
        daysCount,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useReportPeriod(): PeriodValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useReportPeriod must be used within ReportPeriodProvider');
  return v;
}
