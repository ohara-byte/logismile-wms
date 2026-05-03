/**
 * モック HTML 配信ルート（最新版）
 *
 * docs/mocks/<file>.html を text/html として返す。
 * パストラバーサル防止のため、'/' '\' '..' を含むファイル名は拒否。
 *
 * 例: GET /mocks/管理用PCモック_v0.22.html
 *  → wms/docs/mocks/管理用PCモック_v0.22.html を返却
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

  const filePath = path.join(process.cwd(), 'docs', 'mocks', raw);

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
