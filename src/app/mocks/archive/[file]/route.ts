/**
 * モック HTML 配信ルート（アーカイブ）
 *
 * docs/mocks/archive/<file>.html を text/html として返す。
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { file: string } }
) {
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
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
