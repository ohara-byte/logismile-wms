import Link from 'next/link';

/** ルートページ — 端末別ログイン入口へのナビゲーション */
export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6">
      <div className="max-w-md w-full bg-white rounded-xl shadow-md p-8">
        <h1 className="text-2xl font-bold mb-1 text-gray-800">大江ノ郷自然牧場 WMS</h1>
        <p className="text-sm text-gray-600 mb-8">倉庫管理システム</p>

        <div className="space-y-3">
          <NavCard
            href="/login"
            title="管理PC"
            description="メールアドレス + パスワード"
            icon="💻"
          />
          <NavCard
            href="/tablet/login"
            title="タブレット検品"
            description="社員番号でログイン"
            icon="📱"
          />
          <NavCard
            href="/handy/login"
            title="ハンディ検品"
            description="社員番号でログイン（KEYENCE BT-A500）"
            icon="📡"
          />
        </div>

        <p className="text-xs text-gray-400 mt-8 text-center">
          認証はそれぞれ別系統です。
        </p>
      </div>
    </main>
  );
}

function NavCard({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 border rounded-lg p-4 hover:bg-blue-50 hover:border-blue-300 transition"
    >
      <div className="text-3xl">{icon}</div>
      <div>
        <div className="font-semibold text-gray-800">{title}</div>
        <div className="text-xs text-gray-500">{description}</div>
      </div>
    </Link>
  );
}
