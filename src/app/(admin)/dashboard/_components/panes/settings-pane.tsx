'use client';

/**
 * 🛠 設定タブ（Sprint Z-5）
 *
 * admin/manager のみ。以下のセクションを内蔵：
 *  1. ログイン強制解除（in-memory rate-limit バケット）
 *  2. 検品セッション 強制終了（フリーズ復旧）
 *  3. 在庫整合性チェック / 再計算
 *  4. システム情報（DRY-RUN, 在庫サマリ等）
 */

import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  PERMISSIONS,
  ROLE_LABELS,
  type Role,
  type PermissionKey,
} from '@/lib/auth/permissions-shared';

interface LockBucket {
  key: string;
  attempts: number;
  firstAttemptAt: number;
  unlockAt: number;
  locked: boolean;
  retryAfterSec: number;
}

interface ActiveSession {
  id: string;
  pkNo: string;
  destName: string | null;
  orderStatus: string;
  staffCode: string;
  staffName: string;
  deviceCode: string | null;
  deviceLocation: string | null;
  deviceType: string | null;
  startedAt: string;
  elapsedMin: number;
}

interface SystemInfo {
  env: {
    nodeEnv: string;
    factoryDryRun: boolean;
    printerDryRun: boolean;
    factoryBaseUrl: string;
    // Sprint Z-8
    factoryIntegrationMode: 'legacy' | 'factory_api';
    factoryWebhookSecretConfigured: boolean;
  };
  activeInspSessions: number;
  todayMfgCount: number;
  stocks: {
    skuCount: number;
    totalQty: number;
    totalAllocatedQty: number;
  };
  now: string;
}

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function SettingsPane() {
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [locks, setLocks] = useState<LockBucket[]>([]);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmKill, setConfirmKill] = useState<ActiveSession | null>(null);
  const [killReason, setKillReason] = useState('');
  const [carryoverDate, setCarryoverDate] = useState(todayStr());

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const [a, b, c] = await Promise.all([
        fetch('/api/settings/system-info').then((r) => r.json()),
        fetch('/api/settings/login-locks').then((r) => r.json()),
        fetch('/api/settings/active-sessions').then((r) => r.json()),
      ]);
      setInfo(a.data ?? null);
      setLocks(a.error ? [] : (b.data?.buckets ?? []));
      setSessions(c.data?.sessions ?? []);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const id = setInterval(reload, 20000);
    return () => clearInterval(id);
  }, [reload]);

  async function unlockKey(key: string) {
    if (!confirm(`${key} のロックを解除しますか？`)) return;
    setBusy(true);
    try {
      const r = await fetch('/api/settings/login-locks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const j = await r.json();
      if (!r.ok) {
        alert(j.message ?? `HTTP ${r.status}`);
        return;
      }
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function unlockAll() {
    if (!confirm('全てのログイン失敗カウントをリセットします。よろしいですか？')) return;
    setBusy(true);
    try {
      const r = await fetch('/api/settings/login-locks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      const j = await r.json();
      if (!r.ok) {
        alert(j.message ?? `HTTP ${r.status}`);
        return;
      }
      alert(j.message ?? 'OK');
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function killSession() {
    if (!confirmKill || !killReason.trim()) return;
    setBusy(true);
    try {
      const r = await fetch('/api/settings/active-sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: confirmKill.id,
          reason: killReason.trim(),
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        alert(j.message ?? `HTTP ${r.status}`);
        return;
      }
      reload();
    } finally {
      setBusy(false);
      setConfirmKill(null);
      setKillReason('');
    }
  }

  async function runCarryover() {
    if (
      !confirm(
        `${carryoverDate} の引当未完了伝票を翌日へ繰越します。この操作は元に戻せません。よろしいですか？`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetch(
        `/api/allocation/auto-carryover?date=${carryoverDate}`,
        { method: 'POST' },
      );
      const j = await r.json();
      if (!r.ok) {
        alert(j.message ?? `HTTP ${r.status}`);
        return;
      }
      const d = j.data ?? {};
      alert(
        `✓ 翌日繰越 完了\n対象 ${d.orderCount} 件 / 明細 ${d.itemCount} 行\n（${d.targetDate} → ${d.nextDate}）`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function recomputeStock() {
    if (
      !confirm(
        '全 SKU の在庫引当数を Allocation 集計から再計算します。差分があれば自動修正します。よろしいですか？',
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetch('/api/settings/stock-recompute', {
        method: 'POST',
      });
      const j = await r.json();
      if (!r.ok) {
        alert(j.message ?? `HTTP ${r.status}`);
        return;
      }
      const d = j.data ?? {};
      if ((d.updated ?? 0) === 0) {
        alert('✓ 差分なし。すべての SKU で整合しています。');
      } else {
        const lines = (d.drifts as Array<{
          productCode: string;
          before: number;
          after: number;
        }>)
          .slice(0, 20)
          .map((dr) => `${dr.productCode}: ${dr.before} → ${dr.after}`)
          .join('\n');
        alert(`✓ ${d.updated} 件の SKU を修正:\n\n${lines}`);
      }
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-3 space-y-3">
      {error && (
        <div className="p-2 text-xs bg-status-error-bg text-status-error border border-status-error rounded">
          {error}
        </div>
      )}

      {/* Sprint Z-8: 工場連携モード（最上段、目立つ位置） */}
      <Section
        title="🏭 工場連携モード"
        subtitle="製造システム稼働後に factory_api へ切替（要 .env 編集 + サーバ再起動）"
      >
        {info ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-2xs text-ink-subtle">現在のモード：</span>
              {info.env.factoryIntegrationMode === 'factory_api' ? (
                <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-900 text-emerald-100 border border-emerald-600">
                  ✓ factory_api（製造連携 有効）
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-900 text-amber-100 border border-amber-600">
                  legacy（現行仕様 / 製造連携 未有効）
                </span>
              )}
              <span className="text-3xs text-ink-muted">
                HMAC シークレット：
                {info.env.factoryWebhookSecretConfigured ? (
                  <b className="text-status-ok">設定済</b>
                ) : (
                  <b className="text-status-warn">未設定</b>
                )}
              </span>
            </div>
            <p className="text-3xs text-ink-muted leading-relaxed">
              切替手順：
              <code className="bg-surface-base px-1 rounded font-mono">
                .env
              </code>{' '}
              に{' '}
              <code className="bg-surface-base px-1 rounded font-mono">
                FACTORY_INTEGRATION_MODE=factory_api
              </code>{' '}
              を設定し、WMS サーバを再起動してください。受入 IF 仕様書はデスクトップ
              <code className="bg-surface-base px-1 rounded font-mono">
                WMS_工場連携IF仕様書_v0.1.md
              </code>{' '}
              を参照。
            </p>
          </div>
        ) : (
          <div className="text-xs text-ink-muted">読み込み中…</div>
        )}
      </Section>

      {/* Sprint Z-8: 業務終了 — 出荷残の手動翌日繰越 */}
      <Section
        title="🌙 業務終了 / 出荷残 翌日繰越"
        subtitle="引当未完了伝票（pending / inspecting / held）を翌日へ繰越（factory_api モードでは納品完了通知で自動実行）"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-2xs text-ink-subtle">対象日：</label>
          <input
            type="date"
            value={carryoverDate}
            onChange={(e) => setCarryoverDate(e.target.value)}
            className="bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono"
          />
          <button
            type="button"
            onClick={runCarryover}
            disabled={busy}
            className="px-3 py-1.5 rounded text-xs font-bold border border-orange-500 bg-orange-900 text-orange-100 hover:bg-orange-800 disabled:opacity-50"
          >
            ↪ 翌日へ繰越実行
          </button>
          <span className="text-3xs text-ink-muted">
            ※ shipDate が翌日に進みます。元に戻すには手動編集が必要です。
          </span>
        </div>
      </Section>

      {/* Sprint Y-8: 権限マトリクス（参照のみ） */}
      <PermissionMatrixSection />

      {/* システム情報 */}
      <Section title="ℹ️ システム情報" subtitle="DRY-RUN / DB ステータス / 在庫サマリ">
        {info ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-2xs">
            <Info
              label="工場連携"
              value={info.env.factoryDryRun ? 'DRY-RUN' : '実機送信'}
              tone={info.env.factoryDryRun ? 'amber' : 'emerald'}
            />
            <Info
              label="プリンタ"
              value={info.env.printerDryRun ? 'DRY-RUN' : '実機印刷'}
              tone={info.env.printerDryRun ? 'amber' : 'emerald'}
            />
            <Info
              label="ENV"
              value={info.env.nodeEnv}
              tone={info.env.nodeEnv === 'production' ? 'emerald' : 'blue'}
            />
            <Info
              label="工場 BaseURL"
              value={info.env.factoryBaseUrl}
              tone="muted"
            />
            <Info
              label="アクティブ検品セッション"
              value={`${info.activeInspSessions} 件`}
              tone={info.activeInspSessions > 0 ? 'blue' : 'muted'}
            />
            <Info
              label="本日 製造指示"
              value={`${info.todayMfgCount} 件`}
              tone="violet"
            />
            <Info
              label="在庫 SKU"
              value={`${info.stocks.skuCount} 件`}
              tone="muted"
            />
            <Info
              label="在庫合計"
              value={`${info.stocks.totalQty} / 引当 ${info.stocks.totalAllocatedQty}`}
              tone="emerald"
            />
          </div>
        ) : (
          <div className="text-xs text-ink-muted">読み込み中…</div>
        )}
      </Section>

      {/* ログイン強制解除 */}
      <Section
        title="🔓 ログイン強制解除"
        subtitle="連続失敗で一時ロックされたアカウント / IP の解除"
        right={
          <button
            onClick={unlockAll}
            disabled={busy || locks.length === 0}
            className="px-2.5 py-1 rounded text-2xs border border-status-error bg-red-950 text-red-200 hover:bg-red-900 disabled:opacity-50"
          >
            ⚠ 全解除
          </button>
        }
      >
        {locks.length === 0 ? (
          <div className="text-xs text-ink-muted">
            現在ロック中のアカウントはありません。
          </div>
        ) : (
          <div className="border border-surface-border rounded overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-surface-base border-b border-surface-border">
                <tr>
                  <th className="px-2 py-1.5 text-left text-2xs uppercase text-ink-subtle">
                    キー
                  </th>
                  <th className="px-2 py-1.5 text-right text-2xs uppercase text-ink-subtle">
                    試行
                  </th>
                  <th className="px-2 py-1.5 text-center text-2xs uppercase text-ink-subtle">
                    状態
                  </th>
                  <th className="px-2 py-1.5 text-right text-2xs uppercase text-ink-subtle">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {locks.map((b) => (
                  <tr
                    key={b.key}
                    className="border-t border-surface-border hover:bg-surface-base"
                  >
                    <td className="px-2 py-1.5 font-mono text-2xs text-accent-amber">
                      {b.key}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {b.attempts} 回
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {b.locked ? (
                        <span className="inline-block px-2 py-0.5 rounded text-2xs font-bold bg-red-900 text-red-100 border border-red-600">
                          🔒 ロック中（残 {b.retryAfterSec}s）
                        </span>
                      ) : (
                        <span className="text-ink-muted text-2xs">経過監視中</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        onClick={() => unlockKey(b.key)}
                        disabled={busy}
                        className="text-2xs px-2 py-1 rounded border border-blue-500 bg-blue-900 text-blue-100 hover:bg-blue-800 disabled:opacity-50"
                      >
                        🔓 解除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* アクティブセッション 強制終了 */}
      <Section
        title="🟦 アクティブ検品セッション"
        subtitle="フリーズ・端末切替時に強制終了でロックを解除"
      >
        {sessions.length === 0 ? (
          <div className="text-xs text-ink-muted">
            現在進行中の検品セッションはありません。
          </div>
        ) : (
          <div className="border border-surface-border rounded overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-surface-base border-b border-surface-border">
                <tr>
                  <th className="px-2 py-1.5 text-left text-2xs uppercase text-ink-subtle">
                    伝票
                  </th>
                  <th className="px-2 py-1.5 text-left text-2xs uppercase text-ink-subtle">
                    担当
                  </th>
                  <th className="px-2 py-1.5 text-left text-2xs uppercase text-ink-subtle">
                    端末
                  </th>
                  <th className="px-2 py-1.5 text-right text-2xs uppercase text-ink-subtle">
                    経過
                  </th>
                  <th className="px-2 py-1.5 text-right text-2xs uppercase text-ink-subtle">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.id}
                    className={`border-t border-surface-border hover:bg-surface-base ${
                      s.elapsedMin >= 30 ? 'bg-red-950/20' : ''
                    }`}
                  >
                    <td className="px-2 py-1.5">
                      <div className="font-mono text-2xs text-accent-amber">
                        {s.pkNo}
                      </div>
                      <div className="text-3xs text-ink-muted truncate max-w-[180px]">
                        {s.destName ?? '—'}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-2xs">
                      <div className="font-bold">{s.staffName}</div>
                      <div className="text-3xs font-mono text-ink-muted">
                        {s.staffCode}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-2xs">
                      {s.deviceCode ?? '—'}
                      {s.deviceLocation && (
                        <div className="text-3xs text-ink-muted">
                          {s.deviceLocation}
                        </div>
                      )}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right tabular-nums ${
                        s.elapsedMin >= 30
                          ? 'text-status-error font-bold'
                          : 'text-ink-subtle'
                      }`}
                    >
                      {s.elapsedMin} 分
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        onClick={() => {
                          setConfirmKill(s);
                          setKillReason('');
                        }}
                        disabled={busy}
                        className="text-2xs px-2 py-1 rounded border border-status-error bg-red-950 text-red-200 hover:bg-red-900 disabled:opacity-50"
                      >
                        ✗ 強制終了
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 在庫整合性チェック */}
      <Section
        title="📊 在庫整合性"
        subtitle="Stock.allocatedQty を Allocation 集計から再計算（差分があれば自動修正）"
      >
        <div className="flex items-center gap-2">
          <button
            onClick={recomputeStock}
            disabled={busy}
            className="px-3 py-1.5 rounded text-xs font-bold border border-purple-500 bg-purple-900 text-purple-100 hover:bg-purple-800 disabled:opacity-50"
          >
            🔄 再計算実行
          </button>
          <span className="text-3xs text-ink-muted">
            ※ status=&apos;released&apos; は除外（reserved + fulfilled の合算で再計算）
          </span>
        </div>
      </Section>

      <ConfirmDialog
        open={!!confirmKill}
        title={`${confirmKill?.pkNo} の検品セッションを強制終了しますか？`}
        body={
          confirmKill ? (
            <div className="space-y-2 text-sm">
              <div className="text-2xs">
                担当: <b>{confirmKill.staffName}</b> ({confirmKill.staffCode}) /
                端末: {confirmKill.deviceCode ?? '—'} / 経過{' '}
                <b>{confirmKill.elapsedMin}</b> 分
              </div>
              <div>
                <label className="text-2xs text-ink-subtle block mb-0.5">
                  理由（必須）
                </label>
                <input
                  type="text"
                  value={killReason}
                  onChange={(e) => setKillReason(e.target.value)}
                  placeholder="例: 端末フリーズ／担当者交代"
                  className="w-full bg-surface-base border border-surface-border rounded px-2 py-1.5 text-xs"
                  autoFocus
                />
              </div>
              <div className="text-2xs text-status-warn">
                ⚠ ShippingOrder の status は変えません。検品再開する場合は再度ピッキング№からセッション開始してください。
              </div>
            </div>
          ) : null
        }
        confirmLabel="✗ 強制終了"
        variant="danger"
        onConfirm={() => {
          if (killReason.trim()) void killSession();
        }}
        onCancel={() => {
          setConfirmKill(null);
          setKillReason('');
        }}
      />
    </div>
  );
}

function Section({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-surface-border rounded-lg bg-surface-panel p-3">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-sm font-bold text-ink-strong">{title}</div>
          {subtitle && (
            <div className="text-3xs text-ink-muted mt-0.5">{subtitle}</div>
          )}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Info({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'amber' | 'blue' | 'violet' | 'muted';
}) {
  const map: Record<typeof tone, string> = {
    emerald: 'text-emerald-200 bg-emerald-950/30 border-emerald-700',
    amber: 'text-amber-200 bg-amber-950/30 border-amber-700',
    blue: 'text-blue-200 bg-blue-950/30 border-blue-700',
    violet: 'text-violet-200 bg-violet-950/30 border-violet-700',
    muted: 'text-ink-muted bg-surface-base border-surface-border',
  };
  return (
    <div
      className={`rounded border px-2.5 py-1.5 ${map[tone]}`}
    >
      <div className="text-3xs uppercase opacity-70">{label}</div>
      <div className="font-bold tabular-nums truncate">{value}</div>
    </div>
  );
}

// Sprint Y-8: 権限マトリクス（コード定義 = permissions-shared.ts を参照）
const PERMISSION_LABELS: Record<PermissionKey, { label: string; desc: string }> = {
  master_view: { label: 'マスタ閲覧', desc: 'マスタ画面（商品・担当者・運送等）を表示' },
  master_edit: { label: 'マスタ編集', desc: 'マスタの登録・更新・削除' },
  csv_import: { label: 'CSV取込', desc: '基幹からの出荷指示 CSV 取込' },
  csv_export: { label: 'CSV出力', desc: '一覧・レポート・マスタの CSV ダウンロード' },
  dashboard_view: { label: 'ダッシュボード閲覧', desc: '進捗カード・KPI・ガントの閲覧' },
  reports_view: { label: 'レポート閲覧', desc: 'サマリー・MH・ABC 分析等の閲覧' },
  force_approve: { label: '強制OK 承認', desc: '強制OK / 出荷照合 / 翌日繰越の承認' },
  force_create: { label: '強制OK 起票', desc: 'モバイル端末で強制OK を発生させる' },
  order_delete: { label: '伝票削除', desc: '出荷伝票の論理削除' },
  order_restore: { label: '伝票復活', desc: '削除済伝票の復活' },
  assignment_edit: { label: 'メンバー割当編集', desc: 'ガント上の割当の編集・保存' },
  assignment_view: { label: 'メンバー割当閲覧', desc: 'ガントの閲覧のみ' },
  inspect: { label: '検品作業', desc: 'タブレット・ハンディでの検品実施' },
  user_admin: { label: 'PC ユーザー管理', desc: 'PC ログインユーザーの追加・編集・削除' },
  pii_view: { label: '個人情報閲覧', desc: '電話番号・入社日 等の閲覧' },
  notice_send: { label: '連絡事項発信', desc: '管理 PC から端末への連絡事項配信' },
  print_test: { label: 'プリンタ試刷', desc: 'QR ラベルの試し刷り実行' },
  print_reprint: { label: 'QR 再印刷', desc: '伝票単位での QR ラベル再印刷' },
};

function PermissionMatrixSection() {
  const roles: Role[] = ['admin', 'manager', 'lead', 'staff', 'parttime'];
  const permKeys = Object.keys(PERMISSIONS) as PermissionKey[];

  // 既定値（マウント時のフォールバック）でセット → API で実効値を取得
  const [matrix, setMatrix] = useState<Record<PermissionKey, Role[]>>(() => {
    const m = {} as Record<PermissionKey, Role[]>;
    for (const k of permKeys) m[k] = [...(PERMISSIONS[k] as readonly Role[])];
    return m;
  });
  const [overridden, setOverridden] = useState<Set<PermissionKey>>(new Set());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<PermissionKey, Role[]> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEffective = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/permissions');
      const j = await r.json();
      if (!r.ok) {
        setError(j?.message ?? `HTTP ${r.status}`);
        return;
      }
      setMatrix(j.data.permissions as Record<PermissionKey, Role[]>);
      setOverridden(new Set(j.data.overridden as PermissionKey[]));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void fetchEffective();
  }, [fetchEffective]);

  function startEdit() {
    setDraft(JSON.parse(JSON.stringify(matrix)));
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(null);
    setEditing(false);
    setError(null);
  }

  function toggleCell(perm: PermissionKey, role: Role) {
    if (!draft) return;
    const list = draft[perm] ?? [];
    const next = list.includes(role)
      ? list.filter((r) => r !== role)
      : [...list, role];
    setDraft({ ...draft, [perm]: next });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await fetch('/api/settings/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: draft }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.message ?? `HTTP ${r.status}`);
        return;
      }
      setEditing(false);
      setDraft(null);
      setError(null);
      await fetchEffective();
      alert(
        `✓ 権限を更新しました\n変更: ${j.data?.changed ?? 0} 件 / 既定に戻し: ${j.data?.restored ?? 0} 件`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function restoreAllDefaults() {
    if (!confirm('すべての権限を既定値に戻します。よろしいですか？')) return;
    const defaults: Record<PermissionKey, Role[]> = {} as Record<
      PermissionKey,
      Role[]
    >;
    for (const k of permKeys) {
      defaults[k] = [...(PERMISSIONS[k] as readonly Role[])];
    }
    setBusy(true);
    try {
      const r = await fetch('/api/settings/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: defaults }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j?.message ?? `HTTP ${r.status}`);
        return;
      }
      setEditing(false);
      setDraft(null);
      await fetchEffective();
      alert('✓ すべての権限を既定値に戻しました');
    } finally {
      setBusy(false);
    }
  }

  const view = editing && draft ? draft : matrix;

  return (
    <Section
      title="🔐 権限マトリクス"
      subtitle="ロール × 機能 の権限。DB に保存され、再ログイン不要で即時反映されます（admin が編集可能）。"
      right={
        editing ? (
          <div className="flex gap-2">
            <button
              onClick={cancelEdit}
              disabled={busy}
              className="px-3 py-1 rounded border border-surface-border bg-surface-base text-xs disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="px-3 py-1 rounded bg-brand-primary text-white text-xs font-bold disabled:opacity-50"
            >
              {busy ? '保存中…' : '✓ 保存'}
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={restoreAllDefaults}
              disabled={busy}
              className="px-2.5 py-1 rounded text-2xs border border-surface-border bg-surface-base hover:border-status-warn disabled:opacity-50"
              title="permissions-shared.ts のコード定義値に全て戻す"
            >
              ↺ 全て既定に
            </button>
            <button
              onClick={startEdit}
              className="px-3 py-1 rounded bg-brand-primary text-white text-xs font-bold hover:bg-blue-600"
            >
              ✏ 編集
            </button>
          </div>
        )
      }
    >
      {error && (
        <div className="mb-2 p-2 text-2xs bg-status-error-bg text-status-error border border-status-error rounded">
          {error}
        </div>
      )}
      {editing && (
        <div className="mb-2 p-2 text-2xs bg-amber-950/40 text-amber-200 border border-amber-700 rounded">
          ⚠ 編集中：チェックボックスで ON/OFF を切替。「保存」で DB に反映され、全 API に即時反映されます。
          <br />
          ※ <b>user_admin / master_edit / master_view</b> は安全のため admin を外せません。
        </div>
      )}
      <div className="overflow-x-auto border border-surface-border rounded">
        <table className="w-full text-2xs">
          <thead className="bg-surface-base">
            <tr>
              <th className="px-2 py-1.5 text-left text-3xs uppercase text-ink-subtle font-bold sticky left-0 bg-surface-base">
                権限 / 機能
              </th>
              {roles.map((r) => (
                <th
                  key={r}
                  className="px-2 py-1.5 text-center text-3xs uppercase text-ink-subtle font-bold"
                  style={{ minWidth: 80 }}
                >
                  <div>{ROLE_LABELS[r]}</div>
                  <div className="text-3xs font-mono text-ink-muted normal-case">
                    ({r})
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {permKeys.map((p) => {
              const allowed = view[p] ?? [];
              const meta = PERMISSION_LABELS[p];
              const isOverridden = overridden.has(p);
              return (
                <tr
                  key={p}
                  className="border-t border-surface-border hover:bg-surface-base"
                >
                  <td className="px-2 py-1.5 sticky left-0 bg-surface-panel border-r border-surface-border">
                    <div className="font-bold text-ink-strong flex items-center gap-1">
                      {meta?.label ?? p}
                      {isOverridden && (
                        <span
                          className="text-3xs px-1 py-0.5 rounded bg-amber-900 text-amber-100 font-bold"
                          title="既定値からカスタマイズ済"
                        >
                          C
                        </span>
                      )}
                    </div>
                    <div className="text-3xs text-ink-muted">
                      {meta?.desc ?? '—'}
                    </div>
                    <div className="text-3xs font-mono text-ink-muted opacity-60">
                      {p}
                    </div>
                  </td>
                  {roles.map((r) => {
                    const ok = allowed.includes(r);
                    return (
                      <td
                        key={r}
                        className={`px-2 py-1.5 text-center ${
                          ok ? 'bg-emerald-950/40' : ''
                        }`}
                      >
                        {editing ? (
                          <input
                            type="checkbox"
                            checked={ok}
                            onChange={() => toggleCell(p, r)}
                            className="cursor-pointer w-4 h-4"
                          />
                        ) : ok ? (
                          <span className="text-status-ok font-bold text-base">
                            ✓
                          </span>
                        ) : (
                          <span className="text-ink-muted opacity-40">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-3xs text-ink-muted mt-2 leading-relaxed">
        ※ 認証方式は端末ごとに分離：管理 PC = メール + パスワード（User テーブル）、
        タブレット / ハンディ = 社員番号のみ（Staff テーブル）。
        「C」マークはコード定義からカスタマイズされた行です。
      </p>
    </Section>
  );
}
