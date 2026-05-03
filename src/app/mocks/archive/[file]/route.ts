/**
 * モック HTML 配信ルート（アーカイブ）— 開発時のみ有効（B-1 / C-1）
 *
 * docs/mocks/archive/<file>.html を text/html として返す。
 *
 * セキュリティ:
 *   - 本番環境では 404
 *   - admin / manager のみ閲覧可
 *   - パストラバーサル防止
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { file: string } }
) {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.MOCK_VIEWER_ENABLED !== 'true'
  ) {
    return new Response('Not found', { status: 404 });
  }

  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;

  const raw = decodeURIComponent(params.file);

  if (!raw.endsWith('.html')) {
    return new Response('Not found', { status: 404 });
  }
  if (raw.includes('..') || raw.includes('/') || raw.includes('\\')) {
    return new Response('Bad request', { status: 400 });
  }

  const filePath = path.join(process.cwd(), 'docs', 'mocks', 'archive', raw);

  try {
    const content = await readFile(filePath);
    return new Response(content, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
