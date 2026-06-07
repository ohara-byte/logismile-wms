/**
 * GET  /api/master/staff   一覧
 * POST /api/master/staff   作成
 *
 * Sprint Y-7+:
 *  - 内部コード(code) は新規登録時 サーバ側自動採番（既定: "S" + empCode を 10 文字内に切詰）
 *  - 空文字 "" が来た FK 系（groupId 等）は null に正規化
 *  - FK 違反 / 重複は具体的なメッセージで返す
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import {
  requireRole,
  requirePermission,
  authHasPermission,
} from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

// 空文字を null に変換する optional 文字列
const nullableStr = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' || v == null ? null : v));

const Body = z.object({
  // Sprint Y-7+: 新規登録時は省略可。省略時は empCode から自動採番。
  //   "" や null も「未指定」とみなして自動採番に回す（モーダルからの送信形態を緩く受ける）
  code: z
    .string()
    .max(10)
    .nullable()
    .optional()
    .transform((v) => (v == null || v === '' ? undefined : v)),
  empCode: z.string().min(1).max(20),
  name: z.string().min(1).max(30),
  kana: nullableStr(40),
  role: z.enum(['admin', 'manager', 'lead', 'staff', 'parttime']).default('staff'),
  department: nullableStr(30),
  employmentTypeCode: nullableStr(20),
  groupId: nullableStr(10),
  defaultShiftPattern: nullableStr(10),
  tel: nullableStr(20),
  joined: nullableStr(10), // YYYY-MM-DD or empty
  assignable: z.boolean().default(true),
  active: z.boolean().default(true),
  skillCoefficient: z.number().min(0).max(9.999).default(1.0),
  note: nullableStr(500),
  // Sprint Y-8: PC ログイン設定
  pcLoginEnabled: z.boolean().optional().default(false),
  loginEmail: nullableStr(100),
  loginPassword: nullableStr(100),
});

export async function GET() {
  // Sprint Y-15: lead もマスタ閲覧可。ただし PII（tel/joined）は admin/manager のみ。
  const guard = await requirePermission('master_view');
  if (!guard.ok) return guard.response;
  const canSeePii = authHasPermission(guard.auth, 'pii_view');

  const items = await prisma.staff.findMany({
    orderBy: [{ active: 'desc' }, { code: 'asc' }],
    include: {
      // Sprint Y-8: PC ログイン情報を結合（passwordHash は返却しない）
      user: { select: { email: true, active: true } },
    },
  });
  const out = items.map((s) => {
    const base = {
      ...s,
      skillCoefficient: Number(s.skillCoefficient),
      joined: s.joined ? s.joined.toISOString().slice(0, 10) : null,
      skillUpdatedAt: s.skillUpdatedAt?.toISOString() ?? null,
      // PC ログイン設定
      loginEmail: s.user?.email ?? null,
      pcLoginEnabled: !!s.user && s.user.active,
    };
    // user リレーション本体は不要（loginEmail/pcLoginEnabled に展開済）
    delete (base as Record<string, unknown>).user;
    if (!canSeePii) {
      base.tel = null;
      base.joined = null;
    }
    return base;
  });
  return NextResponse.json({ data: { items: out }, message: 'OK' });
}

/**
 * 内部コード自動採番ロジック（Sprint Y-7+）：
 *   1. "S" + empCode（半角英数のみに浄化）を作る
 *   2. 10 文字を超える場合は先頭 10 文字に切詰
 *   3. 既に存在する場合は末尾を _2, _3 ... に拡張（理論上 empCode が unique なので衝突しないはず）
 */
async function generateStaffCode(empCode: string): Promise<string> {
  const sanitized = empCode.replace(/[^A-Za-z0-9]/g, '');
  let base = `S${sanitized}`.slice(0, 10);
  if (base.length < 2) base = `S${Date.now().toString(36).slice(-6).toUpperCase()}`.slice(0, 10);

  // 衝突確認
  const exists = await prisma.staff.findUnique({ where: { code: base } });
  if (!exists) return base;

  // 衝突時は _2, _3... を試行（empCode unique 制約があるためここに来るのは稀）
  for (let n = 2; n <= 99; n++) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, 10 - suffix.length)}${suffix}`;
    const dup = await prisma.staff.findUnique({ where: { code: candidate } });
    if (!dup) return candidate;
  }
  throw new Error('内部コードの自動採番に失敗しました');
}

export async function POST(req: Request) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    // Sprint Y-7+: Zod 4 のメッセージは情報量が少ない場合があるので path 付で具体化
    const detailed = parsed.error.issues
      .map((i) => {
        const path = (i.path ?? []).join('.') || '(body)';
        return `[${path}] ${i.message}`;
      })
      .join(' / ');
    return NextResponse.json(
      { error: 'VALIDATION', message: detailed || 'バリデーションエラー' },
      { status: 422 },
    );
  }
  // 権限昇格防止（B-2 / C-2）: manager は admin ロールを作成できない
  if (parsed.data.role === 'admin' && guard.auth.role !== 'admin') {
    return NextResponse.json(
      {
        error: 'FORBIDDEN',
        message: 'admin ロールの作成・付与は admin 権限のみ可能です',
      },
      { status: 403 },
    );
  }

  // 社員番号の重複は事前チェック（明確なメッセージのため）
  const empCodeDup = await prisma.staff.findUnique({
    where: { empCode: parsed.data.empCode },
    select: { code: true, name: true },
  });
  if (empCodeDup) {
    return NextResponse.json(
      {
        error: 'CONFLICT',
        message: `社員番号「${parsed.data.empCode}」は既に「${empCodeDup.name}」(code=${empCodeDup.code}) で使用されています`,
      },
      { status: 409 },
    );
  }

  // 内部コード決定（明示指定があればそれ、無ければ自動採番）
  let code = parsed.data.code;
  if (!code) {
    try {
      code = await generateStaffCode(parsed.data.empCode);
    } catch (e) {
      return NextResponse.json(
        { error: 'CONFLICT', message: (e as Error).message },
        { status: 409 },
      );
    }
  } else {
    const codeDup = await prisma.staff.findUnique({
      where: { code },
      select: { code: true },
    });
    if (codeDup) {
      return NextResponse.json(
        {
          error: 'CONFLICT',
          message: `内部コード「${code}」は既に使用されています`,
        },
        { status: 409 },
      );
    }
  }

  // FK 系の事前存在チェック（具体的なエラーを返すため）
  const fkErrors: string[] = [];
  if (parsed.data.groupId) {
    const g = await prisma.inspectionGroup.findUnique({
      where: { id: parsed.data.groupId },
      select: { id: true },
    });
    if (!g)
      fkErrors.push(
        `グループ ID「${parsed.data.groupId}」はグループマスタに存在しません`,
      );
  }
  if (parsed.data.employmentTypeCode) {
    const et = await prisma.employmentType.findUnique({
      where: { code: parsed.data.employmentTypeCode },
      select: { code: true },
    });
    if (!et)
      fkErrors.push(
        `雇用区分コード「${parsed.data.employmentTypeCode}」は雇用区分マスタに存在しません`,
      );
  }
  if (parsed.data.defaultShiftPattern) {
    const sp = await prisma.shiftPattern.findUnique({
      where: { code: parsed.data.defaultShiftPattern },
      select: { code: true },
    });
    if (!sp)
      fkErrors.push(
        `既定シフト「${parsed.data.defaultShiftPattern}」はシフトパターンマスタに存在しません`,
      );
  }
  if (fkErrors.length > 0) {
    return NextResponse.json(
      { error: 'VALIDATION', message: fkErrors.join(' / ') },
      { status: 422 },
    );
  }

  // Sprint Y-8: PC ログイン情報の事前バリデーション
  const wantsLogin = parsed.data.pcLoginEnabled === true;
  if (wantsLogin) {
    if (!parsed.data.loginEmail) {
      return NextResponse.json(
        {
          error: 'VALIDATION',
          message: 'PC ログインを有効にするにはメールアドレスが必要です',
        },
        { status: 422 },
      );
    }
    if (!parsed.data.loginPassword || parsed.data.loginPassword.length < 4) {
      return NextResponse.json(
        {
          error: 'VALIDATION',
          message:
            'PC ログインを有効にするにはパスワード（4 文字以上）が必要です',
        },
        { status: 422 },
      );
    }
    // 既に同じメールが他人に使われていないかチェック
    const emailDup = await prisma.user.findUnique({
      where: { email: parsed.data.loginEmail },
      select: { staffCode: true },
    });
    if (emailDup && emailDup.staffCode !== code) {
      return NextResponse.json(
        {
          error: 'CONFLICT',
          message: `PC ログインメール「${parsed.data.loginEmail}」は既に別のユーザーで使用されています`,
        },
        { status: 409 },
      );
    }
  }

  // Staff フィールドのみ抽出（loginEmail/loginPassword/pcLoginEnabled は別テーブル）
  const {
    loginEmail: _le,
    loginPassword: _lp,
    pcLoginEnabled: _ple,
    ...staffData
  } = parsed.data;
  void _le;
  void _lp;
  void _ple;

  try {
    const data = {
      ...staffData,
      code,
      joined: staffData.joined ? new Date(staffData.joined) : null,
    };
    // トランザクション: Staff 作成 + User upsert（必要時）
    const created = await prisma.$transaction(async (tx) => {
      const s = await tx.staff.create({ data });
      if (wantsLogin && parsed.data.loginEmail && parsed.data.loginPassword) {
        const passwordHash = await bcrypt.hash(parsed.data.loginPassword, 10);
        await tx.user.create({
          data: {
            email: parsed.data.loginEmail,
            passwordHash,
            role: s.role,
            staffCode: s.code,
            active: true,
          },
        });
      }
      return s;
    });
    return NextResponse.json({ data: created, message: 'OK' });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') {
        const target = e.meta?.target;
        const fieldName = Array.isArray(target)
          ? target.join(', ')
          : String(target ?? 'unknown');
        return NextResponse.json(
          {
            error: 'CONFLICT',
            message: fieldName.includes('emp_code')
              ? `社員番号が他のスタッフと重複しています`
              : fieldName.includes('code')
                ? `内部コードが既に登録されています`
                : `「${fieldName}」が重複しています`,
          },
          { status: 409 },
        );
      }
      if (e.code === 'P2003') {
        const target = e.meta?.field_name ?? e.meta?.constraint;
        return NextResponse.json(
          {
            error: 'VALIDATION',
            message: `参照先マスタに存在しないコードを指定しています: ${String(target ?? '?')}`,
          },
          { status: 422 },
        );
      }
    }
    return maskError(
      '[POST /api/master/staff]',
      e,
      'INTERNAL',
      500,
      '登録に失敗しました（サーバエラー）',
    );
  }
}
