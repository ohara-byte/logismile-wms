/**
 * マスタ設定の登録ハブ（A-09 共通基盤）
 *
 * 各マスタの MasterConfig を 1 ファイルずつ追加してここに登録する。
 * A-10 でマスタを段階的に増やしていく。
 */

import type { MasterConfig } from '../master-types';
import type { MasterSubTabId } from '../master-tabs-config';

const REGISTRY: Partial<Record<MasterSubTabId, MasterConfig<Record<string, unknown>>>> =
  {};

export function registerMasterConfig<T extends Record<string, unknown>>(
  id: MasterSubTabId,
  config: MasterConfig<T>,
) {
  REGISTRY[id] = config as unknown as MasterConfig<Record<string, unknown>>;
}

export function getMasterConfig(
  id: MasterSubTabId,
): MasterConfig<Record<string, unknown>> | null {
  return REGISTRY[id] ?? null;
}
