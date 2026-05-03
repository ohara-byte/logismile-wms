'use client';

import { useEffect, useState } from 'react';
import { useOrderDetailModal } from '@/components/admin/order-detail-context';
import { Panel, PanelHeader, PanelBody } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { TextInput, Select, FieldLabel } from '@/components/ui/form-controls';
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';

interface OrderRow {
  id: string;
  pkNo: string;
  shipDate: string;
  status: string;
  qrPrintFlag: boolean;
  invoiceNo: string | null;
  destName: string | null;
  carrier: { code: string; name: string; short: string | null; cool: boolean } | null;
  itemCount: number;
  scannedRatio: number;
  deletedAt: string | null;
}

const STATUS_OPTIONS = [
  { value: '', label: '全て' },
  { value: 'pending', label: '未着手' },
  { value: 'inspecting', label: '検品中' },
  { value: 'packed', label: '梱包完了' },
  { value: 'held', label: '保留' },
];

export function OrdersClient() {
  const [items, setItems] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);

  const [shipDate, setShipDate] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const { open: openDetail } = useOrderDetailModal();

  const [invoiceQuery, setInvoiceQuery] = useState('');
  const [invoiceMatch, setInvoiceMatch] = useState<OrderRow | null>(null);
  const [invoiceMsg, setInvoiceMsg] = useState<string | null>(null);

  async function reload() {
    setBusy(true);
    const params = new URLSearchParams();
    if (shipDate) params.set('shipDate', shipDate);
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    if (includeDeleted) params.set('includeDeleted', 'true');
    const res = await fetch(`/api/orders?${params}`);
    const j = await res.json();
    if (j.data) {
      setItems(j.data.items);
      setTotal(j.data.total);
    }
    setBusy(false);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onInvoiceSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!invoiceQuery.trim()) return;
    setInvoiceMsg(null);
    setInvoiceMatch(null);
    const params = new URLSearchParams({ q: invoiceQuery.trim(), limit: '5' });
    const res = await fetch(`/api/orders?${params}`);
    const j = await res.json();
    const matches: OrderRow[] = j.data?.items ?? [];
    const exact = matches.find((m) => m.invoiceNo === invoiceQuery.trim());
    if (exact) {
      setInvoiceMatch(exact);
      setInvoiceMsg(`✅ 納品書№ ${invoiceQuery} → ピッキング№ ${exact.pkNo}`);
    } else if (matches.length > 0) {
      setInvoiceMatch(matches[0]);
      setInvoiceMsg(`⚠ 完全一致なし。部分一致 ${matches.length} 件中先頭を表示`);
    } else {
      setInvoiceMsg('❌ 該当なし');
    }
  }

  return (
    <div className="space-y-3">
      {/* 納品書バーコード照合 */}
      <Panel>
        <PanelHeader title="📋 納品書バーコード照合" />
        <PanelBody>
          <form onSubmit={onInvoiceSearch} className="flex gap-2">
            <TextInput
              value={invoiceQuery}
              onChange={(e) => setInvoiceQuery(e.target.value)}
              placeholder="納品書№（バーコード or 手入力）"
              className="font-mono"
            />
            <Button type="submit">照合</Button>
          </form>
          {invoiceMsg && (
            <div className="mt-2 text-xs flex items-center gap-2">
              <span className="text-ink">{invoiceMsg}</span>
              {invoiceMatch && (
                <button
                  className="text-status-info hover:underline text-2xs"
                  onClick={() => openDetail(invoiceMatch.pkNo)}
                >
                  詳細を表示 →
                </button>
              )}
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* フィルタ */}
      <Panel>
        <PanelHeader title="🔍 検索フィルタ" />
        <PanelBody>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <FieldLabel>出荷日</FieldLabel>
              <TextInput
                type="date"
                value={shipDate}
                onChange={(e) => setShipDate(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel>ステータス</FieldLabel>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="md:col-span-2">
              <FieldLabel>検索（PkNo / 納品書 / 配送先）</FieldLabel>
              <TextInput
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="例: SA01 / 鳥取 / 山田"
              />
            </div>
          </div>
          <div className="flex justify-between items-center mt-3">
            <label className="text-xs flex items-center gap-2 text-ink-subtle">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(e) => setIncludeDeleted(e.target.checked)}
                className="accent-accent-amber"
              />
              🗑 削除済みも含める
            </label>
            <Button onClick={reload} disabled={busy} size="sm">
              {busy ? '…' : '検索'}
            </Button>
          </div>
        </PanelBody>
      </Panel>

      {/* 一覧 */}
      <Panel>
        <PanelHeader title="伝票一覧" meta={`${total} 件`} />
        <Table>
          <THead>
            <TH>出荷日</TH>
            <TH>PkNo</TH>
            <TH>運送</TH>
            <TH>配送先</TH>
            <TH>納品書</TH>
            <TH align="center">QR</TH>
            <TH>状態</TH>
            <TH align="right">進捗</TH>
          </THead>
          <TBody>
            {items.length === 0 && <EmptyRow colSpan={8} message="該当する伝票がありません" />}
            {items.map((o) => (
              <TR key={o.id} onClick={() => openDetail(o.pkNo)} muted={!!o.deletedAt}>
                <TD className="text-2xs whitespace-nowrap">
                  {new Date(o.shipDate).toLocaleDateString('ja-JP')}
                </TD>
                <TD mono className="text-accent-amber">
                  {o.pkNo}
                </TD>
                <TD className="text-2xs">
                  {o.carrier?.short ?? o.carrier?.name ?? '—'}
                  {o.carrier?.cool && (
                    <Badge variant="frozen" className="ml-1">
                      ❄
                    </Badge>
                  )}
                </TD>
                <TD className="truncate max-w-xs">{o.destName ?? '—'}</TD>
                <TD mono className="text-2xs">
                  {o.invoiceNo ?? '—'}
                </TD>
                <TD align="center">{o.qrPrintFlag ? '🖨' : <span className="text-ink-muted">—</span>}</TD>
                <TD>
                  <StatusBadge status={o.status} deleted={!!o.deletedAt} />
                </TD>
                <TD align="right" mono>
                  <span className={o.scannedRatio === 100 ? 'text-status-ok font-bold' : 'text-ink'}>
                    {o.scannedRatio}%
                  </span>
                  <span className="text-ink-muted text-2xs"> ({o.itemCount})</span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

    </div>
  );
}

function StatusBadge({ status, deleted }: { status: string; deleted: boolean }) {
  if (deleted) return <Badge variant="neutral">削除済</Badge>;
  const map: Record<string, { variant: Parameters<typeof Badge>[0]['variant']; label: string }> = {
    pending: { variant: 'wait', label: '未着手' },
    inspecting: { variant: 'working', label: '検品中' },
    packed: { variant: 'done', label: '梱包完了' },
    shipped: { variant: 'done', label: '出荷済' },
    held: { variant: 'warn', label: '保留' },
  };
  const m = map[status] ?? { variant: 'neutral' as const, label: status };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}
