import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// ★ TZ は固定しない（2026-10-01）。
//
//   以前はここで JST に固定していた。「本番コンテナは JST で動く」前提だったが、
//   その前提自体が崩れうる（CraftSmile では Alpine に tzdata が無く TZ 設定が
//   黙って無視され、本番が UTC で動いていた＝ADR-042）。
//   テスト側で TZ を固定すると、**TZ に依存したコードが永久に素通りする**。
//   実際このリポジトリでも report-period.ts の境界計算が TZ 依存のままだった。
//
//   CI は TZ=UTC と TZ=Asia/Tokyo の2回まわし、両方緑を必須にする。
//   手元で片方だけ試すときは `TZ=UTC npm test` のように指定する。

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // tsconfig.json の paths と同一（"@/*" -> "./src/*"）
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
