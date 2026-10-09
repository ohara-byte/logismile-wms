/**
 * HUB 受け口の冪等記録（2026-10-08）。hub_inbound_requests に応答を保存し、
 * 同じ Idempotency-Key の再送にはそれを返す。成功（200）の応答だけを保存する
 * （失敗は保存しないので、HUB の再送で取込をやり直せる）。
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import type { HubImportKind } from './hub-handler';

export async function findSavedHubResponse(idempotencyKey: string): Promise<unknown | null> {
  const row = await prisma.hubInboundRequest.findUnique({ where: { idempotencyKey } });
  return row ? row.response : null;
}

export async function saveHubResponse(idempotencyKey: string, endpoint: HubImportKind | 'cancel', response: unknown): Promise<void> {
  try {
    await prisma.hubInboundRequest.create({
      data: { idempotencyKey, endpoint, response: response as Prisma.InputJsonValue },
    });
  } catch (e) {
    // 同じキーが既に保存済み（並走した再送）なら、先に保存された方を正とする
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return;
    throw e;
  }
}
