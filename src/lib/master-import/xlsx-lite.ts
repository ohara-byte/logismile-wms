/**
 * 依存追加なしの最小 xlsx リーダ（2026-06-22・基幹マスタ統合）。
 *
 * xlsx は XML を deflate 圧縮した ZIP。Node 標準の zlib だけで:
 *   1. ZIP 中央ディレクトリを読み、エントリ（名前→オフセット/圧縮法/サイズ）を取得
 *   2. 必要な XML（sharedStrings / worksheets/sheetN）を inflateRaw で展開
 *   3. sharedStrings と各セルを正規表現で解析し、行×列の文字列配列に変換
 *
 * アップロード経路に CVE 付きパーサ（SheetJS 0.18.5 等）を載せないための自前実装。
 * 対象は社内の信頼できるマスタ xlsx のみ。ZIP64 や暗号化は非対応（数MB級で不要）。
 */

import zlib from 'node:zlib';

interface ZipEntry {
  method: number;
  compSize: number;
  localOffset: number;
}

/** ZIP 中央ディレクトリを走査して filename→entry の Map を作る */
function readZipEntries(buf: Buffer): Map<string, ZipEntry> {
  // End of Central Directory (EOCD) を末尾から探す（シグネチャ 0x06054b50）
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('xlsx: EOCD レコードが見つかりません（不正な ZIP）');
  const cdOffset = buf.readUInt32LE(eocd + 16);

  const entries = new Map<string, ZipEntry>();
  let p = cdOffset;
  while (p + 4 <= buf.length && buf.readUInt32LE(p) === 0x02014b50) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** エントリ1件を展開して UTF-8 文字列で返す */
function extractEntry(buf: Buffer, entry: ZipEntry): string {
  // ローカルファイルヘッダ（0x04034b50）からデータ開始位置を算出
  const lo = entry.localOffset;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('xlsx: ローカルヘッダ不正');
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  const raw = buf.subarray(dataStart, dataStart + entry.compSize);
  if (entry.method === 0) return raw.toString('utf8'); // stored
  if (entry.method === 8) return zlib.inflateRawSync(raw).toString('utf8'); // deflate
  throw new Error(`xlsx: 未対応の圧縮方式 ${entry.method}`);
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml: string): string[] {
  return xml.split('<si>').slice(1).map((si) => {
    const texts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]);
    return decodeXmlEntities(texts.join(''));
  });
}

/** セル参照（例 "AB12"）の列を 0 始まり index に変換 */
function colIndex(ref: string): number {
  const letters = (ref.match(/^[A-Z]+/) ?? ['A'])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * 指定シートの全行を文字列の2次元配列で返す（行は出現順、セルは0始まり列に配置）。
 * 数値・日付セルは保存された生文字列（日付はシリアル値）で返す。
 */
export function readXlsxSheet(buf: Buffer, sheetIndex = 1): string[][] {
  const entries = readZipEntries(buf);
  const ssEntry = entries.get('xl/sharedStrings.xml');
  const shared = ssEntry ? parseSharedStrings(extractEntry(buf, ssEntry)) : [];

  const sheetName = `xl/worksheets/sheet${sheetIndex}.xml`;
  const sheetEntry = entries.get(sheetName);
  if (!sheetEntry) throw new Error(`xlsx: ${sheetName} が見つかりません`);
  const sx = extractEntry(buf, sheetEntry);

  const rows: string[][] = [];
  const rowChunks = sx.split('<row').slice(1);
  for (const chunk of rowChunks) {
    const cells: string[] = [];
    const cellRe = /<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let m: RegExpExecArray | null;
    while ((m = cellRe.exec(chunk)) !== null) {
      const attrs = m[1];
      const inner = m[2] ?? '';
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) ?? [])[1];
      if (!ref) continue;
      const type = (attrs.match(/t="([^"]+)"/) ?? [])[1];
      const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
      let val = '';
      if (type === 's') {
        val = shared[parseInt(vMatch?.[1] ?? '-1', 10)] ?? '';
      } else if (type === 'inlineStr' || type === 'str') {
        const it = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        val = decodeXmlEntities(it?.[1] ?? vMatch?.[1] ?? '');
      } else {
        val = vMatch?.[1] != null ? decodeXmlEntities(vMatch[1]) : '';
      }
      cells[colIndex(ref)] = val;
    }
    // 欠損列を空文字で埋める
    for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}
