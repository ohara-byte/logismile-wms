/**
 * GET  /api/settings/permissions   現在の実効権限マトリクスを返却
 * PUT  /api/settings/permissions   権限マトリクスを更新（admin/manager）
 *
 * Sprint Y-10: permissions-shared.ts の DEFAULTS を DB で上書き
 *  - GET: 既定値 + DB オーバーライド を merge した結果を返す
 *  - PUT: { permissions: { [key]: ['admin','manager',...] } } で一括更新
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import {
  ensurePermissionsLoaded,
  getEffectiveMatrix,
  getDefaultMatrix,
  invalidatePermissionsCache,
} from '@/lib/auth/permissions-runtime';
import {
  PERMISSIONS as DEFAULTS,
  type PermissionKey,
  type Role,
} from '@/lib/auth/permissions-shared';

const VALID_KEYS = Object.keys(DEFAULTS) as PermissionKey[];

export async function GET() {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;

  await ensurePermissionsLoaded();
  const effective = getEffectiveMatrix();
  const defaults = getDefaultMatrix();

  // 差分（カスタマイズされたキー）を併せて表示
  const overridden: PermissionKey[] = [];
  for (const k of VALID_KEYS) {
    const a = [...effective[k]].sort().join(',');
    const b = [...defaults[k]].sort().join(',');
    if (a !== b) overridden.push(k);
  }

  return NextResponse.json({
    data: {
      permissions: effective,
      defaults,
      overridden,
    },
    message: 'OK',
  });
}

const Body = z.object({
  permissions: z.record(z.string(), z.array(z.enum(['admin', 'manager', 'lead', 'staff', 'parttime']))),
});

export async function PUT(req: Request) {
  // 編集は admin のみに限定（manager 含む権限変更を防ぐ）
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'VALIDATION',
        message: parsed.error.issues.map((i) => `[${i.path.join('.')}] ${i.message}`).join(' / '),
      },
      { status: 422 },
    );
  }

  // 未知のキーは拒否
  const unknownKeys = Object.keys(parsed.data.permissions).filter(
    (k) => !VALID_KEYS.includes(k as PermissionKey),
  );
  if (unknownKeys.length > 0) {
    return NextResponse.json(
      {
        error: 'VALIDATION',
        message: `未知の権限キー: ${unknownKeys.join(', ')}`,
      },
      { status: 422 },
    );
  }

  // admin 権限のロックを防ぐ：admin が外せない権限を強制
  // user_admin / master_edit / master_view は最低でも admin が含まれている必要がある
  const safetyGuards: PermissionKey[] = ['user_admin', 'master_edit', 'master_view'];
  for (const k of safetyGuards) {
    const list = parsed.data.permissions[k];
    if (list && !list.includes('admin')) {
      return NextResponse.json(
        {
          error: 'VALIDATION',
          message: `「${k}」から admin を外すことはできません（操作不能になります）`,
        },
        { status: 422 },
      );
    }
  }

  const defaults = getDefaultMatrix();
  const toUpsert: Array<{ key: string; roles: Role[] }> = [];
  const toDelete: string[] = [];

  for (const [key, roles] of Object.entries(parsed.data.permissions)) {
    const def = [...(defaults[key as PermissionKey] ?? [])].sort().join(',');
    const cur = [...roles].sort().join(',');

    if (def === cur) {
      toDelete.push(key);
    } else {
      toUpsert.push({ key, roles: roles as Role[] });
    }
  }

  // Prisma.$transaction でまとめて実行（型を統一するため callback 形式を使用）
  await prisma.$transaction(async (tx) => {
    for (const { key, roles } of toUpsert) {
      await tx.permissionOverride.upsert({
        where: { permissionKey: key },
        create: {
          permissionKey: key,
          allowedRoles: roles,
          updatedBy: guard.auth.staffCode ?? null,
        },
        update: {
          allowedRoles: roles,
          updatedBy: guard.auth.staffCode ?? null,
        },
      });
    }
    if (toDelete.length > 0) {
      await tx.permissionOverride.deleteMany({
        where: { permissionKey: { in: toDelete } },
      });
    }
  });
  const upserts = toUpsert;
  const deletes = toDelete;

  // キャッシュ破棄 → 次のリクエストで再読込
  invalidatePermissionsCache();
  await ensurePermissionsLoaded();

  return NextResponse.json({
    data: {
      permissions: getEffectiveMatrix(),
      changed: upserts.length,
      restored: deletes.length,
    },
    message: 'OK',
  });
}
