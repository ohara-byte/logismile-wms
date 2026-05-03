/**
 * マスタ設定の登録ハブ（A-09 共通基盤）
 *
 * 各マスタの MasterConfig を 1 ファイルずつ追加してここに登録する。
 * A-10 でマスタを段階的に増やしていく。
 */

import type { MasterConfig } from '../master-types';
import type { MasterSubTabId } from '../master-tabs-config';
import { staffConfig } from './staff-config';
import { carrierConfig } from './carrier-config';
import { boxConfig } from './box-config';
import { deviceConfig } from './device-config';
import { productConfig } from './product-config';
import { groupConfig } from './group-config';
import { stdTimeConfig } from './stdtime-config';
import { skillConfig } from './skill-config';

const REGISTRY: Partial<Record<MasterSubTabId, MasterConfig<Record<string, unknown>>>> = {
  staff: staffConfig as unknown as MasterConfig<Record<string, unknown>>,
  device: deviceConfig as unknown as MasterConfig<Record<string, unknown>>,
  product: productConfig as unknown as MasterConfig<Record<string, unknown>>,
  carrier: carrierConfig as unknown as MasterConfig<Record<string, unknown>>,
  group: groupConfig as unknown as MasterConfig<Record<string, unknown>>,
  stdtime: stdTimeConfig as unknown as MasterConfig<Record<string, unknown>>,
  skill: skillConfig as unknown as MasterConfig<Record<string, unknown>>,
  box: boxConfig as unknown as MasterConfig<Record<string, unknown>>,
};

export function getMasterConfig(
  id: MasterSubTabId,
): MasterConfig<Record<string, unknown>> | null {
  return REGISTRY[id] ?? null;
}
