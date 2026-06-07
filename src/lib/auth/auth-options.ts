/**
 * NextAuth.js 設定 — 管理PC（admin / manager）専用
 *
 * - 認証方式: メール + パスワード（CredentialsProvider）
 * - DB: users テーブル（password_hash は bcrypt）
 * - セッション戦略: JWT
 *
 * タブレット/ハンディは別系統（社員番号のみ）。
 * `src/lib/auth/employee-session.ts` を参照。
 */

import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';

// 起動時の弱いシークレット検出（本番では起動を拒否する）
// ※ next build（ページデータ収集）でも本モジュールが評価されるが、ビルド時は .env が
//   読み込まれず NEXTAUTH_SECRET が空になりビルドが落ちる。実行時の起動チェックは維持しつつ
//   ビルドフェーズ（NEXT_PHASE='phase-production-build'）のみ検証をスキップする。
const _secret = process.env.NEXTAUTH_SECRET ?? '';
if (
  process.env.NODE_ENV === 'production' &&
  process.env.NEXT_PHASE !== 'phase-production-build' &&
  (_secret === '' || /change|please|dev/i.test(_secret))
) {
  // ロード時にスローしてサーバ起動を停止
  throw new Error(
    'NEXTAUTH_SECRET を本番用のランダム値に変更してください（現在の値は弱いデフォルトのままです）',
  );
}

// email enumeration 対策の dummy bcrypt（compare の所要時間を平均化）
// 値そのものは bcrypt.hashSync('placeholder', 10) で生成。
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 60 * 60 * 8 }, // 8 時間
  providers: [
    CredentialsProvider({
      id: 'credentials',
      name: 'メール+パスワード',
      credentials: {
        email: { label: 'メール', type: 'email' },
        password: { label: 'パスワード', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          select: {
            id: true,
            email: true,
            passwordHash: true,
            role: true,
            active: true,
            staffCode: true,
            staff: { select: { name: true } },
          },
        });

        // user が存在しなくても dummy hash で bcrypt を回し、応答時間を平均化する
        // （email 列挙攻撃対策）
        const hashToCompare = user?.passwordHash ?? DUMMY_HASH;
        const ok = await bcrypt.compare(credentials.password, hashToCompare);

        if (!user || !user.active || !ok) return null;

        // last_login 更新（fire-and-forget）
        prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } }).catch(() => {});

        return {
          id: user.id,
          email: user.email,
          name: user.staff?.name ?? user.email,
          role: user.role as 'admin' | 'manager' | 'lead' | 'staff' | 'parttime',
          staffCode: user.staffCode,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as {
          role: 'admin' | 'manager' | 'lead' | 'staff' | 'parttime';
          staffCode: string | null;
        };
        token.role = u.role;
        token.staffCode = u.staffCode;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role ?? 'staff';
        session.user.staffCode = token.staffCode ?? null;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
};
