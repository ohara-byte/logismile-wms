import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// 本番コンテナは JST で動くため、テストも既定で JST に揃える。
// UTC で走らせると @db.Date（UTC 真夜中）まわりの 1 日ズレバグが
// 再現せず素通りする（TZ=UTC 等で上書きも可能）。
process.env.TZ ??= 'Asia/Tokyo';

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
