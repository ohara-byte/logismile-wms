/**
 * PUT    /api/master/staff/[code]   更新
 * DELETE /api/master/staff/[code]   削除
 *
 * Sprint Y-7+:
 *  - 空文字 → null 正規化（FK 系）
 *  - FK 違反 / 重複は具体的メッセージ
 *  - 削除は FK 参照（出荷指示・検品セッション等）で失敗しやすいので
 *    実運用では active=false の論理削除を推奨
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/permissions';
import { maskError } from '@/lib/api-errors';

const nullableStr = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' || v == null ? null : v));

const Body = z.object({
  empCode: z.string().min(1).max(20),
  name: z.string().min(1).max(30),
  kana: nullableStr(40),
  role: z.enum(['admin', 'manager', 'lead', 'staff', 'parttime']).default('staff'),
  department: nullableStr(30),
  employmentTypeCode: nullableStr(20),
  groupId: nullableStr(10),
  defaultShiftPattern: nullableStr(10),
  tel: nullableStr(20),
  joined: nullableStr(10),
  assignable: z.boolean().default(true),
  active: z.boolean().default(true),
  skillCoefficient: z.number().min(0).max(9.999).default(1.0),
  note: nullableStr(500),
  // Sprint Y-8: PC ログイン設定
  pcLoginEnabled: z.boolean().optional().default(false),
  loginEmail: nullableStr(100),
  loginPassword: nullableStr(100),
});

export async function PUT(
  req: Request,
  { params }: { params: { code: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const json = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
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
  const code = decodeURIComponent(params.code);

  // 権限昇格防止
  if (parsed.data.role === 'admin' && guard.auth.role !== 'admin') {
    const existing = await prisma.staff.findUnique({
      where: { code },
      select: { role: true },
    });
    if (!existing || existing.role !== 'admin') {
      return NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: 'admin ロールへの変更は admin 権限のみ可能です',
        },
        { status: 403 },
      );
    }
  }

  // 社員番号変更時に他人と衝突しないか事前チェック
  const empDup = await prisma.staff.findFirst({
    where: { empCode: parsed.data.empCode, NOT: { code } },
    select: { code: true, name: true },
  });
  if (empDup) {
    return NextResponse.json(
      {
        error: 'CONFLICT',
        message: `社員番号「${parsed.data.empCode}」は既に「${empDup.name}」(code=${empDup.code}) で使用されています`,
      },
      { status: 409 },
    );
  }

  // FK 存在チェック
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

  // PCログインメールは全角混入（IME ON の全角ｍ等）を防ぐため NFKC で半角化＋前後空白除去して保存。
  if (parsed.data.loginEmail) {
    parsed.data.loginEmail = parsed.data.loginEmail.normalize('NFKC').trim();
  }

  // Sprint Y-8: PC ログイン情報の事前バリデーション
  const wantsLogin = parsed.data.pcLoginEnabled === true;
  if (wantsLogin && !parsed.data.loginEmail) {
    return NextResponse.json(
      {
        error: 'VALIDATION',
        message: 'PC ログインを有効にするにはメールアドレスが必要です',
      },
      { status: 422 },
    );
  }
  if (wantsLogin && parsed.data.loginEmail) {
    const emailDup = await prisma.user.findFirst({
      where: {
        email: parsed.data.loginEmail,
        NOT: { staffCode: code },
      },
      select: { staffCode: true },
    });
    if (emailDup) {
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
      joined: staffData.joined ? new Date(staffData.joined) : null,
    };
    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.staff.update({ where: { code }, data });

      // 既存 User を取得
      const existingUser = await tx.user.findUnique({
        where: { staffCode: code },
      });

      if (wantsLogin && parsed.data.loginEmail) {
        // PC ログイン有効化 — User を upsert
        const updateData: {
          email: string;
          role: string;
          active: boolean;
          passwordHash?: string;
        } = {
          email: parsed.data.loginEmail,
          role: s.role,
          active: true,
        };
        // パスワードは空欄なら変更しない（編集時の利便性）
        if (parsed.data.loginPassword && parsed.data.loginPassword.length > 0) {
          if (parsed.data.loginPassword.length < 4) {
            throw new Error('パスワードは 4 文字以上で入力してください');
          }
          updateData.passwordHash = await bcrypt.hash(
            parsed.data.loginPassword,
            10,
          );
        }
        if (existingUser) {
          await tx.user.update({ where: { id: existingUser.id }, data: updateData });
        } else {
          // 新規作成時はパスワード必須
          if (!parsed.data.loginPassword || parsed.data.loginPassword.length < 4) {
            throw new Error(
              'PC ログイン初回登録にはパスワード（4 文字以上）が必要です',
            );
          }
          await tx.user.create({
            data: {
              email: parsed.data.loginEmail,
              passwordHash: await bcrypt.hash(parsed.data.loginPassword, 10),
              role: s.role,
              staffCode: s.code,
              active: true,
            },
          });
        }
      } else if (!wantsLogin && existingUser) {
        // PC ログイン無効化 — User.active=false（履歴のため削除はしない）
        await tx.user.update({
          where: { id: existingUser.id },
          data: { active: false },
        });
      }
      return s;
    });
    return NextResponse.json({ data: updated, message: 'OK' });
  } catch (e) {
    // Sprint Y-8: トランザクション内で投げた自前のバリデーション
    if (
      e instanceof Error &&
      !(e instanceof Prisma.PrismaClientKnownRequestError) &&
      (e.message.includes('パスワード') || e.message.includes('PC ログイン'))
    ) {
      return NextResponse.json(
        { error: 'VALIDATION', message: e.message },
        { status: 422 },
      );
    }
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
              : fieldName.includes('email')
                ? `PC ログインメールが他のユーザーと重複しています`
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
      if (e.code === 'P2025') {
        return NextResponse.json(
          { error: 'NOT_FOUND', message: 'コードが見つかりません' },
          { status: 404 },
        );
      }
    }
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'コードが見つかりません' },
      { status: 404 },
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { code: string } },
) {
  const guard = await requireRole('admin', 'manager');
  if (!guard.ok) return guard.response;
  const code = decodeURIComponent(params.code);

  // Sprint Y-10: ?force=true で関連レコードも巻き取って削除
  const { searchParams } = new URL(req.url);
  const force = searchParams.get('force') === 'true';

  // 参照件数の事前カウント
  const [
    inspSessionCount,
    shiftCount,
    memberAssignmentCount,
    noticeAckCount,
    printLogCount,
    stockAllocSessionCount,
    userCount,
  ] = await Promise.all([
    prisma.inspSession.count({ where: { staffCode: code } }),
    prisma.shift.count({ where: { staffCode: code } }),
    prisma.memberAssignment.count({ where: { staffCode: code } }),
    prisma.noticeAck.count({ where: { staffCode: code } }),
    prisma.printLog.count({ where: { staffCode: code } }),
    prisma.stockAllocSession.count({ where: { staffCode: code } }),
    prisma.user.count({ where: { staffCode: code } }),
  ]);
  const total =
    inspSessionCount +
    shiftCount +
    memberAssignmentCount +
    noticeAckCount +
    printLogCount +
    stockAllocSessionCount +
    userCount;

  if (total > 0 && !force) {
    const parts: string[] = [];
    if (inspSessionCount) parts.push(`検品セッション ${inspSessionCount} 件`);
    if (shiftCount) parts.push(`シフト ${shiftCount} 件`);
    if (memberAssignmentCount)
      parts.push(`メンバー割当 ${memberAssignmentCount} 件`);
    if (noticeAckCount) parts.push(`連絡既読 ${noticeAckCount} 件`);
    if (printLogCount) parts.push(`印刷ログ ${printLogCount} 件`);
    if (stockAllocSessionCount)
      parts.push(`在庫検品セッション ${stockAllocSessionCount} 件`);
    if (userCount) parts.push(`PC ユーザー ${userCount} 件`);
    return NextResponse.json(
      {
        error: 'CONFLICT',
        message: `この担当者は以下のレコードから参照されているため削除できません: ${parts.join(' / ')}\n（参照ごと削除するには ?force=true）\n※ 通常は active=false での論理削除を推奨します。`,
        meta: {
          inspSessionCount,
          shiftCount,
          memberAssignmentCount,
          noticeAckCount,
          printLogCount,
          stockAllocSessionCount,
          userCount,
        },
      },
      { status: 409 },
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (force) {
        // 1. 印刷ログ → InspLog のような子から先に削除（FK 制約のため）
        //    InspLog は InspSession に onDelete: Cascade で紐付くため不要
        await tx.printLog.deleteMany({ where: { staffCode: code } });
        await tx.memberAssignment.deleteMany({ where: { staffCode: code } });
        await tx.shift.deleteMany({ where: { staffCode: code } });
        await tx.noticeAck.deleteMany({ where: { staffCode: code } });
        await tx.stockAllocSession.deleteMany({ where: { staffCode: code } });
        // 2. InspSession を削除（InspLog は cascade）
        await tx.inspSession.deleteMany({ where: { staffCode: code } });
        // 3. User をクリア（cascade で sessions も消える）
        await tx.user.deleteMany({ where: { staffCode: code } });
        // 4. Device.activeStaffCode（任意 FK）を null に
        await tx.device.updateMany({
          where: { activeStaffCode: code },
          data: { activeStaffCode: null, activeSince: null },
        });
      }
      await tx.staff.delete({ where: { code } });
    });

    return NextResponse.json({
      data: {
        code,
        forced: force,
        cascadeCounts: force
          ? {
              inspSession: inspSessionCount,
              shift: shiftCount,
              memberAssignment: memberAssignmentCount,
              noticeAck: noticeAckCount,
              printLog: printLogCount,
              stockAllocSession: stockAllocSessionCount,
              user: userCount,
            }
          : null,
      },
      message: force
        ? `担当者と関連 ${total} 件のレコードを削除しました`
        : 'OK',
    });
  } catch (e) {
    return maskError(
      '[DELETE /api/master/staff]',
      e,
      'CONFLICT',
      409,
      '削除できません（予期しない参照あり）。退職者は active=false での論理削除を推奨します',
    );
  }
}
