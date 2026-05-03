/**
 * モック静的配信 — 一覧ページ
 *
 * docs/mocks/ 配下の HTML をブラウザから確認できるようにする。
 * ソースの真実は docs/mocks/ にあり、ここは閲覧用のシン・ビューア。
 *
 * URL 例:
 *   /mocks                                 … この一覧
 *   /mocks/管理用PCモック_v0.22.html       … モック本体
 *   /mocks/archive/管理用PCモック_v0.21.html … 過去版
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';
import { LogiSmileLogo } from '@/components/brand/logismile-logo';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function listMocks() {
  const root = path.join(process.cwd(), 'docs', 'mocks');
  const current: string[] = [];
  const archive: string[] = [];

  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.html')) current.push(e.name);
    }

    const archiveDir = path.join(root, 'archive');
    try {
      const archEntries = await readdir(archiveDir);
      for (const f of archEntries) {
        if (f.endsWith('.html')) archive.push(f);
      }
    } catch {
      /* archive が無くても無視 */
    }
  } catch {
    /* mocks ディレクトリ自体が無いケース */
  }

  current.sort().reverse();
  archive.sort().reverse();
  return { current, archive };
}

export default async function MocksIndexPage() {
  const { current, archive } = await listMocks();

  return (
    <main className="min-h-screen bg-surface-base text-ink p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <LogiSmileLogo height={32} />
          <div>
            <h1 className="text-lg font-bold text-ink-strong">モック ビューア</h1>
            <p className="text-2xs text-ink-subtle">
              docs/mocks/ 配下の HTML を直接表示します（要件確認用）
            </p>
          </div>
        </div>

        <section className="mb-6">
          <h2 className="text-xs font-bold text-accent-amber uppercase tracking-wider mb-2">
            最新版
          </h2>
          {current.length === 0 ? (
            <p className="text-sm text-ink-muted">モックファイルが見つかりません。</p>
          ) : (
            <ul className="space-y-1.5">
              {current.map((f) => (
                <MockLink key={f} href={`/mocks/${encodeURIComponent(f)}`} label={f} />
              ))}
            </ul>
          )}
        </section>

        {archive.length > 0 && (
          <section>
            <h2 className="text-xs font-bold text-ink-subtle uppercase tracking-wider mb-2">
              アーカイブ ({archive.length})
            </h2>
            <ul className="space-y-1">
              {archive.map((f) => (
                <MockLink
                  key={f}
                  href={`/mocks/archive/${encodeURIComponent(f)}`}
                  label={f}
                  small
                />
              ))}
            </ul>
          </section>
        )}

        <div className="mt-8 pt-4 border-t border-surface-border text-3xs text-ink-muted">
          <Link href="/" className="hover:text-accent-amber">← トップへ戻る</Link>
        </div>
      </div>
    </main>
  );
}

function MockLink({ href, label, small }: { href: string; label: string; small?: boolean }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={`block border border-surface-border bg-surface-panel rounded px-3 py-2 hover:border-brand-primary/60 hover:bg-surface-raised transition ${
          small ? 'text-2xs text-ink-subtle' : 'text-sm text-ink-strong'
        }`}
      >
        <span className="font-mono">{label}</span>
        <span className="ml-2 text-3xs text-ink-muted">↗ 新規タブで開く</span>
      </a>
    </li>
  );
}
