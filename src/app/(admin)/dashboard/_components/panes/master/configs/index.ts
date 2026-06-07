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
import { carrierAliasConfig } from './carrier-alias-config';
import { noshiExclusionConfig } from './noshi-exclusion-config';
import { qrForceKeywordConfig } from './qr-force-keyword-config';
import { boxConfig } from './box-config';
import { deviceConfig } from './device-config';
import { productConfig } from './product-config';
import { groupConfig } from './group-config';
import { stdTimeConfig } from './stdtime-config';
import { skillConfig } from './skill-config';
import { shiftConfig } from './shift-config';
import { patternConfig } from './pattern-config';
import { printerConfig } from './printer-config';
import { departmentConfig } from './department-config';
import { userConfig } from './user-config';
import { stockConfig } from './stock-config';

const REGISTRY: Partial<Record<MasterSubTabId, MasterConfig<Record<string, unknown>>>> = {
  staff: staffConfig as unknown as MasterConfig<Record<string, unknown>>,
  device: deviceConfig as unknown as MasterConfig<Record<string, unknown>>,
  product: productConfig as unknown as MasterConfig<Record<string, unknown>>,
  carrier: carrierConfig as unknown as MasterConfig<Record<string, unknown>>,
  carrierAlias: carrierAliasConfig as unknown as MasterConfig<Record<string, unknown>>,
  noshiExclusion: noshiExclusionConfig as unknown as MasterConfig<Record<string, unknown>>,
  qrForceKeyword: qrForceKeywordConfig as unknown as MasterConfig<Record<string, unknown>>,
  group: groupConfig as unknown as MasterConfig<Record<string, unknown>>,
  stdtime: stdTimeConfig as unknown as MasterConfig<Record<string, unknown>>,
  skill: skillConfig as unknown as MasterConfig<Record<string, unknown>>,
  shift: shiftConfig as unknown as MasterConfig<Record<string, unknown>>,
  pattern: patternConfig as unknown as MasterConfig<Record<string, unknown>>,
  box: boxConfig as unknown as MasterConfig<Record<string, unknown>>,
  printer: printerConfig as unknown as MasterConfig<Record<string, unknown>>,
  department: departmentConfig as unknown as MasterConfig<Record<string, unknown>>,
  user: userConfig as unknown as MasterConfig<Record<string, unknown>>,
  stock: stockConfig as unknown as MasterConfig<Record<string, unknown>>,
};

export function getMasterConfig(
  id: MasterSubTabId,
): MasterConfig<Record<string, unknown>> | null {
  return REGISTRY[id] ?? null;
}
