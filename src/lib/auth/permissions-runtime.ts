/**
 * 権限ランタイム（サーバ専用 / Sprint Y-10）
 *
 * permissions-shared.ts の DEFAULTS を、DB に保存された PermissionOverride で上書きする。
 * 設定画面（/settings → 権限マトリクス）から admin/manager が編集可能。
 *
 * キャッシュ戦略：
 *  - モジュールレベル Map に保持
 *  - 初回 ensureLoaded() で DB から読込
 *  - 保存 API がキャッシュを invalidate するため、次のリクエストで再読込
 *
 * 注意：複数プロセス構成の場合は pub/sub による無効化が必要。本 WMS は単一プロセス前提。
 */

import { prisma } from '@/lib/db';
import {
  PERMISSIONS as DEFAULTS,
  type PermissionKey,
  type Role,
} from './permissions-shared';

const defaultKeys = Object.keys(DEFAULTS) as PermissionKey[];

let cache: Map<PermissionKey, ReadonlyArray<Role>> | null = null;
let loadingPromise: Promise<void> | null = null;

async function loadFromDb(): Promise<void> {
  const overrides = await prisma.permissionOverride.findMany();
  const map = new Map<PermissionKey, ReadonlyArray<Role>>();
  for (const k of defaultKeys) {
    map.set(k, [...(DEFAULTS[k] as readonly Role[])]);
  }
  for (const row of overrides) {
    if (defaultKeys.includes(row.permissionKey as PermissionKey)) {
      map.set(
        row.permissionKey as PermissionKey,
        row.allowedRoles as Role[],
      );
    }
  }
  cache = map;
}

/** リクエストハンドラの先頭で await。初回ロード後はノーオペ。 */
export async function ensurePermissionsLoaded(): Promise<void> {
  if (cache) return;
  if (!loadingPromise) {
    loadingPromise = loadFromDb().finally(() => {
      loadingPromise = null;
    });
  }
  await loadingPromise;
}

/** 強制的にキャッシュを破棄（PUT 後に呼ぶ） */
export function invalidatePermissionsCache(): void {
  cache = null;
}

/** 1 ロールが特定権限を持つか（キャッシュ読込が前提） */
export function hasPermissionRuntime(
  role: Role | null | undefined,
  perm: PermissionKey,
): boolean {
  if (!role) return false;
  // キャッシュ未読込なら DEFAULTS にフォールバック（最初のリクエストでも安全）
  if (!cache) {
    return (DEFAULTS[perm] as readonly Role[]).includes(role);
  }
  const allowed = cache.get(perm);
  if (!allowed) return false;
  return allowed.includes(role);
}

/** 現在の実効権限マトリクスを取得（API レスポンス・編集 UI 用） */
export function getEffectiveMatrix(): Record<
  PermissionKey,
  ReadonlyArray<Role>
> {
  const out = {} as Record<PermissionKey, ReadonlyArray<Role>>;
  for (const k of defaultKeys) {
    out[k] = cache?.get(k) ?? (DEFAULTS[k] as readonly Role[]);
  }
  return out;
}

/** 既定値（コード定義） */
export function getDefaultMatrix(): Record<
  PermissionKey,
  ReadonlyArray<Role>
> {
  const out = {} as Record<PermissionKey, ReadonlyArray<Role>>;
  for (const k of defaultKeys) {
    out[k] = DEFAULTS[k] as readonly Role[];
  }
  return out;
}
