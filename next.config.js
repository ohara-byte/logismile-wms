/** @type {import('next').NextConfig} */
const nextConfig = {
  // 2026-06-02: Windows + Prisma ネイティブエンジンが、ビルドの静的生成フェーズで
  //   複数ワーカー同時起動すると query_engine-windows.dll.node の読込で
  //   ネイティブクラッシュ（exit 0xC0000409）する事象を回避するため、
  //   ビルドの並列度を 1 に制限してエンジン読込を直列化する。
  //   （本番ビルドはやや遅くなるが安定性を優先。Linux 本番では影響なし）
  experimental: {
    cpus: 1,
    workerThreads: false,
  },
};

module.exports = nextConfig;
