/**
 * Phase 2 — 基幹API連携アダプタ（スタブ）
 *
 * 将来、Thomas 側が REST API 連携に対応した際にここを実装する。
 * 現時点では呼び出されないが、IF アダプタ層の差し替え可能性を担保するための骨組み。
 */

import type { IntegrationAdapter, ImportContext, ImportResult, ImportSource } from './types';

export class ApiAdapter implements IntegrationAdapter {
  async importProducts(_source: ImportSource, _ctx: ImportContext): Promise<ImportResult> {
    throw new Error('ApiAdapter.importProducts は未実装です（フェーズ2 で実装予定）');
  }

  async importShippingOrders(_source: ImportSource, _ctx: ImportContext): Promise<ImportResult> {
    throw new Error('ApiAdapter.importShippingOrders は未実装です（フェーズ2 で実装予定）');
  }
}
