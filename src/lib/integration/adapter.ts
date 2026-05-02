/**
 * IF アダプタ ファクトリー
 *
 * フェーズ1: CsvAdapter（既定）
 * フェーズ2: ApiAdapter（将来、環境変数で切替）
 */

import type { IntegrationAdapter } from './types';
import { CsvAdapter } from './csv-adapter';
import { ApiAdapter } from './api-adapter';

export type AdapterKind = 'csv' | 'api';

export function createIntegrationAdapter(kind: AdapterKind = 'csv'): IntegrationAdapter {
  switch (kind) {
    case 'csv':
      return new CsvAdapter();
    case 'api':
      return new ApiAdapter();
  }
}

/** 環境変数 INTEGRATION_ADAPTER（'csv' | 'api'）から既定アダプタを取得。 */
export function getDefaultAdapter(): IntegrationAdapter {
  const kind = (process.env.INTEGRATION_ADAPTER as AdapterKind) ?? 'csv';
  return createIntegrationAdapter(kind);
}

export type { IntegrationAdapter };
