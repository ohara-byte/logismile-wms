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

        if (!user || !user.active) return null;
        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;

        // last_login 更新（fire-and-forget）
        prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } }).catch(() => {});

        return {
          id: user.id,
          email: user.email,
          name: user.staff?.name ?? user.email,
          role: user.role as 'admin' | 'manager' | 'staff',
          staffCode: user.staffCode,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as { role: 'admin' | 'manager' | 'staff'; staffCode: string | null };
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
