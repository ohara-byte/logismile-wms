import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CORRECTION_MOVEMENT_TYPE,
  CORRECTION_REF_TYPE,
} from '../integration/delivery-correction';

/**
 * `stock_movements` に書く文字列が、列の長さに収まることのロックテスト。
 *
 * 背景（2026-10-23）：工場納品の訂正 API が ref_type に
 * 'factory_delivery_correction'（27文字）を書こうとし、列が VARCHAR(20) だったため
 *   ERROR: value too long for type character varying(20)
 * で**毎回 500** になっていた。2026-10-01〜10-16 の取り戻し 21 件がすべて失敗し、
 * 一度も成功していない。純関数の試験は DB に書かないため、誰も気づけなかった。
 *
 * ここでは schema.prisma の宣言と、コードに書かれた値を突き合わせる。
 */

const ROOT = join(__dirname, '..', '..', '..');

/** schema.prisma から `model StockMovement` の列 → VarChar の長さ。 */
function varcharLengths(model: string): Map<string, number> {
  const schema = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
  const m = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`model ${model} が見つかりません`);
  const out = new Map<string, number>();
  for (const line of m[1]!.split('\n')) {
    const f = line.match(/^\s*(\w+)\s+String\??.*@db\.VarChar\((\d+)\)/);
    if (f) out.set(f[1]!, Number(f[2]));
  }
  return out;
}

/** src 配下で `refType: '...'` と書かれている値を全部拾う。 */
function refTypeLiterals(): Array<{ value: string; file: string }> {
  const found: Array<{ value: string; file: string }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === '__tests__' || name === 'node_modules') continue;
        walk(p);
      } else if (/\.tsx?$/.test(name)) {
        const text = readFileSync(p, 'utf8');
        for (const m of text.matchAll(/refType:\s*'([^']+)'/g)) {
          found.push({ value: m[1]!, file: p.slice(ROOT.length + 1) });
        }
      }
    }
  };
  walk(join(ROOT, 'src'));
  return found;
}

describe('stock_movements の列の長さ', () => {
  const len = varcharLengths('StockMovement');

  it('★ 工場納品の訂正が書く ref_type / type が列に収まる', () => {
    expect(CORRECTION_REF_TYPE.length).toBeLessThanOrEqual(len.get('refType')!);
    expect(CORRECTION_MOVEMENT_TYPE.length).toBeLessThanOrEqual(len.get('type')!);
  });

  it('★ コードに書かれた ref_type の値がすべて列に収まる', () => {
    const literals = refTypeLiterals();
    expect(literals.length).toBeGreaterThan(0); // 拾えていなければ試験の意味が無い
    const tooLong = literals.filter((l) => l.value.length > len.get('refType')!);
    expect(tooLong).toEqual([]);
  });

  it('設定画面の在庫再計算（allocated_qty_recompute・23文字）も収まる', () => {
    expect('allocated_qty_recompute'.length).toBeLessThanOrEqual(len.get('refType')!);
  });
});
