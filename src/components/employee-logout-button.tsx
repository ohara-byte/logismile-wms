'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  variant: 'tablet' | 'handy';
}

export function LogoutButton({ variant }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    await fetch('/api/auth/employee-signout', { method: 'POST' });
    router.replace(`/${variant}/login`);
    router.refresh();
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="text-sm text-blue-600 hover:underline disabled:text-gray-400"
    >
      {busy ? '…' : 'ログアウト'}
    </button>
  );
}
