/**
 * 社内 IP 判定
 *
 * 環境変数 INTRANET_CIDR_LIST に CIDR をカンマ区切りで指定:
 *   INTRANET_CIDR_LIST=192.168.0.0/16,10.0.0.0/8,172.16.0.0/12
 *
 * 未設定（または空）の場合は **すべて許可**（開発環境向けデフォルト）。
 * 本番では必ず設定する。
 *
 * リクエストヘッダの優先順位:
 *  1. CF-Connecting-IP（Cloudflare 経由）
 *  2. X-Forwarded-For（リバースプロキシ経由。先頭が原則信頼可）
 *  3. X-Real-IP
 *  4. リクエスト元（middleware の req.ip）
 */

function parseCidr(cidr: string): { ipBigInt: bigint; mask: bigint; family: 4 | 6 } | null {
  const [ip, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr ?? '32', 10);
  if (ip.includes(':')) {
    const ipBig = ipv6ToBigInt(ip);
    if (ipBig === null) return null;
    const maskBits = 128 - prefix;
    const mask = ((1n << 128n) - 1n) ^ ((1n << BigInt(maskBits)) - 1n);
    return { ipBigInt: ipBig & mask, mask, family: 6 };
  }
  const ipBig = ipv4ToBigInt(ip);
  if (ipBig === null) return null;
  const maskBits = 32 - prefix;
  const mask = ((1n << 32n) - 1n) ^ ((1n << BigInt(maskBits)) - 1n);
  return { ipBigInt: ipBig & mask, mask, family: 4 };
}

function ipv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    const num = parseInt(p, 10);
    if (!Number.isFinite(num) || num < 0 || num > 255) return null;
    n = (n << 8n) | BigInt(num);
  }
  return n;
}

function ipv6ToBigInt(ip: string): bigint | null {
  // 簡易実装: 完全展開のみ対応（::ff:ff:ff:ff のような圧縮表記も部分対応）
  let expanded = ip;
  if (ip.includes('::')) {
    const [head, tail] = ip.split('::');
    const headParts = head ? head.split(':') : [];
    const tailParts = tail ? tail.split(':') : [];
    const fill = 8 - headParts.length - tailParts.length;
    expanded = [...headParts, ...Array(fill).fill('0'), ...tailParts].join(':');
  }
  const parts = expanded.split(':');
  if (parts.length !== 8) return null;
  let n = 0n;
  for (const p of parts) {
    const num = parseInt(p || '0', 16);
    if (!Number.isFinite(num) || num < 0 || num > 0xffff) return null;
    n = (n << 16n) | BigInt(num);
  }
  return n;
}

type CidrEntry = NonNullable<ReturnType<typeof parseCidr>>;

let cachedAllowList: CidrEntry[] | null = null;
function getAllowList(): CidrEntry[] {
  if (cachedAllowList !== null) return cachedAllowList;
  const env = process.env.INTRANET_CIDR_LIST?.trim() ?? '';
  if (env === '') {
    cachedAllowList = [];
    return cachedAllowList;
  }
  cachedAllowList = env
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .map(parseCidr)
    .filter((x): x is CidrEntry => x !== null);
  return cachedAllowList;
}

/** 環境変数 INTRANET_CIDR_LIST が空なら true（開発環境）。 */
export function isIntranetEnforced(): boolean {
  return getAllowList().length > 0;
}

/** ip が許可 CIDR のいずれかに含まれるか。 */
export function isIntranetIp(ip: string): boolean {
  const list = getAllowList();
  if (list.length === 0) return true; // 未設定は全許可

  // ループバック / IPv6 mapped IPv4 を吸収
  if (ip === '::1' || ip === '127.0.0.1') return true;
  if (ip.startsWith('::ffff:')) ip = ip.slice('::ffff:'.length);

  const isIpv6 = ip.includes(':');
  const ipBig = isIpv6 ? ipv6ToBigInt(ip) : ipv4ToBigInt(ip);
  if (ipBig === null) return false;
  const family = isIpv6 ? 6 : 4;

  return list.some((entry) => {
    if (entry.family !== family) return false;
    return (ipBig & entry.mask) === entry.ipBigInt;
  });
}

/** Request ヘッダから client IP を抽出。 */
export function clientIpFromHeaders(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = headers.get('x-real-ip');
  if (xri) return xri.trim();
  return '127.0.0.1';
}
