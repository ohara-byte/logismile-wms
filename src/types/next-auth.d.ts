import 'next-auth';
import 'next-auth/jwt';

// Sprint Y-11: ロールに lead / parttime を追加
type AppRole = 'admin' | 'manager' | 'lead' | 'staff' | 'parttime';

declare module 'next-auth' {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: AppRole;
      staffCode: string | null;
    };
  }

  interface User {
    id: string;
    email: string;
    name?: string | null;
    role: AppRole;
    staffCode: string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: AppRole;
    staffCode?: string | null;
  }
}
