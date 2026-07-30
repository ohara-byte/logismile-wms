import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

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
