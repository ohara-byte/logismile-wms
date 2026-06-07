/**
 * SCeaTa CT4-LX プリンタークライアント
 *
 * 仕様（CLAUDE.md §6 より）：
 * - 用紙: SATO レスプリ・シータラベル 30×40mm
 * - 印字: QRコード（納品書№をエンコード）+ 納品書№テキスト
 *
 * ===================================================================
 * 2026-05-21 プラン B：現行 WMS の Wireshark 採取結果に合わせて
 *   実機が確実に受け付ける SBPL バイト列を再現する方式に切替
 * -------------------------------------------------------------------
 * 経緯：
 *   旧プラン A（<ESC>GH hex 形式）で QR 自体は印字できたが、
 *     - 縦横の比率がアプリ側調整では合わせきれない
 *     - スマホで読み取れない
 *   問題が解消できず、現行 WMS（同じ CT4-LX で運用中）の
 *   出力バイト列を Wireshark で採取して解析した。
 *
 * 採取で判明した現行プロトコル：
 *   1. 端末 → プリンタ  ENQ (0x05)
 *   2. プリンタ → 端末  状態応答
 *   3. 端末 → プリンタ  設定パケット
 *          <STX><ESC>A
 *               <ESC>A3V+00000H+0000   ← 基準座標 0,0
 *               <ESC>CS6               ← 印字速度 6
 *               <ESC>#F5               ← 印字濃度 5
 *               <ESC>A1V00240H0320     ← ラベル寸法 240×320 dot (=30×40mm)
 *               <ESC>Z
 *          <ETX>
 *   4. 端末 → プリンタ  ENQ
 *   5. プリンタ → 端末  状態応答
 *   6. 端末 → プリンタ  メインジョブ
 *          <STX><ESC>A
 *               <ESC>PS                     ← ペーパーセンサ自動判定
 *               <ESC>WKdocument             ← ジョブ ID
 *               <ESC>%0                     ← 文字方向 0
 *               <ESC>H0081<ESC>V00030       ← 描画開始位置 H=81, V=30
 *               <ESC>GB022025[4400バイト]    ← QR+テキスト合成ビットマップ
 *                                              ・xxx=022 = 22 バイト幅 = 176 ドット
 *                                              ・yyy=025 = 25×8 = 200 ドット高さ
 *                                              ・データ=22×25×8=4400 バイト（生バイナリ）
 *                                              ・行優先（1 行=22 バイト×200 行）
 *               <ESC>Q1                     ← 1 枚印刷
 *               <ESC>Z
 *          <ETX>
 *
 * 重要：
 *   - 現行は <ESC>GB（バイナリ）を使用（ASCII hex の <ESC>GH ではない）
 *   - 縦座標は 5 桁、横座標は 4 桁
 *   - GB の縦パラメータ yyy は「8 ドット単位の縦バイト数」
 *     ＝ 実際の縦ドット数 ÷ 8（25 → 200 ドット高さ）
 *   - データレイアウトは**行優先**：1 行 = xxx バイト、yyy×8 行
 *
 * 環境変数：
 *   PRINTER_DRY_RUN          "true" で実送信せず（既定: false で実印刷）
 *   PRINTER_LANG             sbpl | zpl （既定: sbpl）
 *   PRINTER_QR_H             描画開始 H 座標 (4桁, 既定 0081 = 現行と同じ)
 *   PRINTER_QR_V             描画開始 V 座標 (5桁, 既定 00030 = 現行と同じ)
 *   PRINTER_QR_MODULE        QR 1モジュール H 方向ドット数 (既定 6)
 *   PRINTER_QR_MODULE_V      QR 1モジュール V 方向ドット数 (既定 8)
 *   PRINTER_QR_ECC           誤り訂正 L|M|Q|H (既定 H)
 *   PRINTER_CANVAS_W_BYTES   キャンバス横バイト数 (既定 22 = 176 ドット)
 *   PRINTER_CANVAS_H_BYTEROW キャンバス縦 8 ドット行数 (既定 25 = 200 ドット)
 *   PRINTER_TXT_BELOW        テキストを QR の下に描画するか true|false (既定 true)
 *   PRINTER_TXT_SCALE        テキストフォント倍率 (既定 2)
 *   PRINTER_DENSITY          印字濃度 0〜9 (既定 5。高いほどインク転写量↑で
 *                            線が太く濃く見える。コンベア対応では 7〜8 推奨)
 *   PRINTER_SPEED            印字速度 1〜9 (既定 6。低いほどサーマルヘッドの加熱
 *                            時間↑でインク転写量↑→ 線が太く見える。3 程度推奨)
 */

import net from 'node:net';
import QRCode from 'qrcode';

export interface PrintLabelInput {
  invoiceNo: string;
  pkNo: string;
  printerHost: string;
  printerPort: number;
  /** 任意のメタ（再印刷理由など）。print_logs.error_msg ではなくログ用。 */
  meta?: Record<string, unknown>;
}

export interface PrintLabelResult {
  status: 'success' | 'failed';
  errorMsg?: string;
  /** DRY-RUN モードで実際の送信が行われていない場合 true */
  dryRun: boolean;
  /** 送信したペイロードの長さ（bytes）。DRY-RUN でも生成は行う。 */
  bytesSent: number;
}

const STX = 0x02;
const ETX = 0x03;
const ENQ = 0x05;
const ESC = 0x1b;

// ===================================================================
// 5×7 ピクセル ASCII フォント（QR の下に印字するテキスト用）
// ===================================================================
//   各文字は 7 行、bit 4=最左 / bit 0=最右 の 5 ビット。
const FONT_5X7: Record<string, readonly number[]> = {
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0e],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0e, 0x11, 0x10, 0x0e, 0x01, 0x11, 0x0e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x11, 0x0a, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '-': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  '/': [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0c],
  ':': [0x00, 0x04, 0x04, 0x00, 0x04, 0x04, 0x00],
  '_': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f],
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
};

// ===================================================================
// キャンバスにドットを書き込むヘルパ
// ===================================================================

/** (x, y) 位置の 1 ドットをセット（行優先、1 バイト=8 ドット横並び、MSB が左） */
function setDot(canvas: Buffer, widthBytes: number, x: number, y: number): void {
  if (x < 0 || y < 0) return;
  const widthDots = widthBytes * 8;
  if (x >= widthDots) return;
  const byteIdx = y * widthBytes + (x >> 3);
  if (byteIdx >= canvas.length) return;
  const bitIdx = 7 - (x & 7);
  canvas[byteIdx] |= 1 << bitIdx;
}

/** QR モジュール 1 つ（moduleH × moduleV ドット）の長方形を黒で塗る */
function drawQrModule(
  canvas: Buffer,
  widthBytes: number,
  heightDots: number,
  x: number,
  y: number,
  moduleH: number,
  moduleV: number,
): void {
  for (let dy = 0; dy < moduleV; dy++) {
    const yy = y + dy;
    if (yy >= heightDots) break;
    for (let dx = 0; dx < moduleH; dx++) {
      setDot(canvas, widthBytes, x + dx, yy);
    }
  }
}

/**
 * 1 文字（5×7 フォント）をキャンバスに描画。
 * scaleW = 横方向の拡大率、scaleH = 縦方向の拡大率（非均一スケーリング対応）。
 * 2026-05-27: SR-5000 対応で「縦だけ高く」したいケースのため scaleW/H 分離。
 */
function drawChar(
  canvas: Buffer,
  widthBytes: number,
  heightDots: number,
  ch: string,
  x: number,
  y: number,
  scaleW: number,
  scaleH: number,
): void {
  const glyph = FONT_5X7[ch.toUpperCase()] ?? FONT_5X7[' '];
  for (let gy = 0; gy < 7; gy++) {
    const row = glyph[gy];
    for (let gx = 0; gx < 5; gx++) {
      if (row & (1 << (4 - gx))) {
        for (let dy = 0; dy < scaleH; dy++) {
          for (let dx = 0; dx < scaleW; dx++) {
            setDot(canvas, widthBytes, x + gx * scaleW + dx, y + gy * scaleH + dy);
          }
        }
      }
    }
  }
}

// ===================================================================
// キャンバス合成（QR + 任意でテキスト）
// ===================================================================

interface CanvasOutput {
  /** raw binary bitmap（widthBytes × (heightByteRows*8) バイト） */
  data: Buffer;
  /** GB コマンド用：横バイト数（3 桁） */
  widthBytes: number;
  /** GB コマンド用：縦バイト行数（3 桁、実際の縦ドット数 ÷ 8） */
  heightByteRows: number;
}

/**
 * QR コードとテキストを 1 枚のビットマップキャンバスに合成する。
 * 現行 WMS と同じ <ESC>GB バイナリ形式でプリンタへ渡すための raw データ。
 */
export function buildCanvas(invoiceNoInput: string): CanvasOutput {
  // 2026-06-01 A-4: null/undefined/空白を正規化（QRCode.create が落ちないように）。
  //   呼び出し側は照合済み非空値を渡すが、念のため防御する。
  const invoiceNo = (invoiceNoInput ?? '').trim();
  if (invoiceNo === '') {
    throw new Error('buildCanvas: 印字対象の納品書№が空です');
  }
  const widthBytes = parseInt(process.env.PRINTER_CANVAS_W_BYTES ?? '22', 10);
  const heightByteRows = parseInt(process.env.PRINTER_CANVAS_H_BYTEROW ?? '25', 10);
  const widthDots = widthBytes * 8;
  const heightDots = heightByteRows * 8;
  const canvas = Buffer.alloc(widthBytes * heightDots);

  // ── QR 生成 ──
  const ecc = (process.env.PRINTER_QR_ECC ?? 'H') as 'L' | 'M' | 'Q' | 'H';
  //   PRINTER_QR_VERSION を指定すると QR バージョン（1〜40）を固定。
  //   未指定（または "auto"）ならデータ長に応じて自動選択。
  //   20mm 角に近いサイズを得るには V4 (33 module) × 4 dot が最適。
  const versionEnv = process.env.PRINTER_QR_VERSION;
  const versionFixed =
    versionEnv && versionEnv !== 'auto' ? parseInt(versionEnv, 10) : undefined;
  //   PRINTER_QR_MASK でマスクパターン（0〜7）を強制。
  //   既存システム解析結果：mask=0 を採用（2026-05-25）。
  //   未指定（または "auto"）ならライブラリの自動選択。
  const maskEnv = process.env.PRINTER_QR_MASK;
  const maskParsed =
    maskEnv && maskEnv !== 'auto' ? parseInt(maskEnv, 10) : NaN;
  const maskFixed =
    !isNaN(maskParsed) && maskParsed >= 0 && maskParsed <= 7
      ? (maskParsed as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7)
      : undefined;
  const qr = QRCode.create(invoiceNo, {
    errorCorrectionLevel: ecc,
    ...(versionFixed ? { version: versionFixed } : {}),
    ...(maskFixed !== undefined ? { maskPattern: maskFixed } : {}),
  });
  const N = qr.modules.size; // 例: V1=21, V2=25, V3=29, V4=33, ...

  // ── QR サイズ決定 ──
  // 2026-05-25: KEYENCE SR-5000 対応のため、既存システムと同じ
  //   「N モジュールを目標 dot 数に Bresenham 分配」 方式を導入。
  //   PRINTER_QR_TARGET_WIDTH / _HEIGHT が指定されれば新方式（可変モジュール幅）。
  //   未指定なら従来の uniform module 方式（後方互換）。
  const targetWidthEnv = process.env.PRINTER_QR_TARGET_WIDTH;
  const targetHeightEnv = process.env.PRINTER_QR_TARGET_HEIGHT;
  const targetWidth = targetWidthEnv ? parseInt(targetWidthEnv, 10) : 0;
  const targetHeight = targetHeightEnv ? parseInt(targetHeightEnv, 10) : 0;
  const useBresenham = targetWidth > 0 && targetHeight > 0;

  const moduleH = parseInt(process.env.PRINTER_QR_MODULE ?? '4', 10);
  const moduleV = parseInt(
    process.env.PRINTER_QR_MODULE_V ?? process.env.PRINTER_QR_MODULE ?? '4',
    10,
  );
  const qrWidth = useBresenham ? targetWidth : N * moduleH;
  const qrHeight = useBresenham ? targetHeight : N * moduleV;

  // QR 配置：env でオフセットを直接指定可能（既存システム互換 (~5, ~4) を再現）
  //   PRINTER_QR_OFFSET_X / _Y。"auto" または未指定 → 中央寄せ / 上寄せ
  const offXEnv = process.env.PRINTER_QR_OFFSET_X;
  const offYEnv = process.env.PRINTER_QR_OFFSET_Y;
  const qrX =
    offXEnv && offXEnv !== 'auto'
      ? parseInt(offXEnv, 10)
      : Math.max(0, Math.floor((widthDots - qrWidth) / 2));
  const qrY = offYEnv && offYEnv !== 'auto' ? parseInt(offYEnv, 10) : 0;

  // ── デバッグログ：印刷ごとに実際に使われている設定を出力 ──
  const renderMode = useBresenham ? `bresenham target=${targetWidth}x${targetHeight}` : `uniform module=${moduleH}x${moduleV}`;
  console.info(
    `[print-client] canvas=${widthBytes}x${heightByteRows} ` +
      `qr_version=${versionFixed ?? 'auto'} N=${N} mask=${maskFixed ?? 'auto'} ` +
      `render=${renderMode} qrSize=${qrWidth}x${qrHeight}dot offset=(${qrX},${qrY}) ` +
      `ecc=${ecc} gap=${process.env.PRINTER_QR_TEXT_GAP ?? '2'}`,
  );

  if (useBresenham) {
    // Bresenham 分配：N モジュールを targetWidth / targetHeight dot に均等分配。
    //   各モジュールのピクセル境界を端数なく決定し、合計が target に厳密一致するようにする。
    //   例：21 mod → 160 dot 幅 = (160-21*7)=13 個の "8 dot" モジュール + 8 個の "7 dot" モジュール
    //   既存システムの可変モジュール（平均 7.6 dot）と同等の配置になる。
    const colBoundaries: number[] = [0];
    for (let i = 1; i <= N; i++) {
      colBoundaries.push(Math.round((i * targetWidth) / N));
    }
    const rowBoundaries: number[] = [0];
    for (let i = 1; i <= N; i++) {
      rowBoundaries.push(Math.round((i * targetHeight) / N));
    }
    for (let my = 0; my < N; my++) {
      const yStart = qrY + rowBoundaries[my];
      const yEnd = qrY + rowBoundaries[my + 1];
      for (let mx = 0; mx < N; mx++) {
        // 🚨 2026-05-28 致命的バグ修正：qrcode lib の BitMatrix.get(row, col) シグネチャに合わせる。
        //   旧コード get(mx, my) は (col, row) 順で渡しており、QR 行列が transpose された
        //   状態で出力されていた（= 数学的に「ミラー反転 + 90° 回転」と等価）。
        //   これが SR-5000 等の厳密なリーダで読めなかった根本原因。
        if (!qr.modules.get(my, mx)) continue;
        const xStart = qrX + colBoundaries[mx];
        const xEnd = qrX + colBoundaries[mx + 1];
        for (let y = yStart; y < yEnd; y++) {
          if (y < 0 || y >= heightDots) continue;
          for (let x = xStart; x < xEnd; x++) {
            setDot(canvas, widthBytes, x, y);
          }
        }
      }
    }
  } else {
    // 旧方式：uniform module（後方互換用）
    for (let my = 0; my < N; my++) {
      for (let mx = 0; mx < N; mx++) {
        // 🚨 2026-05-28 致命的バグ修正：BitMatrix.get(row, col) 引数順を正す（上記 Bresenham 分岐と同じ）
        if (qr.modules.get(my, mx)) {
          drawQrModule(
            canvas,
            widthBytes,
            heightDots,
            qrX + mx * moduleH,
            qrY + my * moduleV,
            moduleH,
            moduleV,
          );
        }
      }
    }
  }

  // ── テキストを QR の下に描画 ──
  const drawText = (process.env.PRINTER_TXT_BELOW ?? 'true').toLowerCase() !== 'false';
  if (drawText && invoiceNo.length > 0) {
    const scale = parseInt(process.env.PRINTER_TXT_SCALE ?? '2', 10) || 2;
    // 2026-05-27: SR-5000 対応で「縦だけ高く」したいケース用に W / H を分離。
    //   PRINTER_TXT_SCALE_W / _H が指定されればそちらを使用、なければ PRINTER_TXT_SCALE 値を採用。
    const scaleW = parseInt(process.env.PRINTER_TXT_SCALE_W ?? '', 10) || scale;
    const scaleH = parseInt(process.env.PRINTER_TXT_SCALE_H ?? '', 10) || scale;
    const charW = 5 * scaleW;
    const charH = 7 * scaleH;
    // 文字間スペース：PRINTER_TXT_SPACING（dot 単位）で明示指定可能。
    // 既定は scaleW（既存挙動）。SR-5000 のパターン認識アンカー強化で広めに取りたいときに増やす。
    const spacing = parseInt(process.env.PRINTER_TXT_SPACING ?? '', 10) || scaleW;
    const totalW = invoiceNo.length * charW + (invoiceNo.length - 1) * spacing;
    const textX = Math.max(0, Math.floor((widthDots - totalW) / 2));
    // QR の下のギャップ（ドット単位、既定 2）
    const gap = parseInt(process.env.PRINTER_QR_TEXT_GAP ?? '2', 10);
    const textY = qrY + qrHeight + gap;
    // 2026-06-01 A-4: 縦(textY+charH)・横(textX+totalW) ともにキャンバス内に収まる時のみ描画。
    //   横幅超過時に末尾文字が欠ける/境界外に書き込むのを防ぐ（長い納品書№対策）。
    const fitsVertically = textY + charH <= heightDots;
    const fitsHorizontally = textX + totalW <= widthDots;
    if (fitsVertically && fitsHorizontally) {
      for (let i = 0; i < invoiceNo.length; i++) {
        drawChar(
          canvas,
          widthBytes,
          heightDots,
          invoiceNo[i],
          textX + i * (charW + spacing),
          textY,
          scaleW,
          scaleH,
        );
      }
    } else {
      // 収まらない場合はテキスト描画をスキップ（QR は印字される）。サイレント回避のため警告。
      console.warn(
        `[print-client] テキスト描画スキップ: 納品書№ "${invoiceNo}" がキャンバスに収まりません ` +
          `(textX=${textX} totalW=${totalW} widthDots=${widthDots} / textY=${textY} charH=${charH} heightDots=${heightDots})`,
      );
    }
  }

  return { data: canvas, widthBytes, heightByteRows };
}

// ===================================================================
// SBPL ペイロード組み立て
// ===================================================================

/**
 * ZPL（Zebra Programming Language）形式 — ZPL 互換モードのプリンタ向け（保険）。
 */
export function buildZplPayload(input: Pick<PrintLabelInput, 'invoiceNo' | 'pkNo'>): string {
  return [
    '^XA',
    '^MMT',
    '^PW240', // 30mm @ 8dpmm
    '^LL320', // 40mm @ 8dpmm
    '^LS0',
    `^FO20,40^BQN,2,5^FDLA,${input.invoiceNo}^FS`,
    `^FO20,220^A0N,24,24^FD${input.invoiceNo}^FS`,
    '^XZ',
    '',
  ].join('\n');
}

/** ASCII 文字列を Buffer に変換するショートカット */
function asc(s: string): Buffer {
  return Buffer.from(s, 'ascii');
}

/**
 * SBPL（SATO Barcode Printer Language）形式 — 現行 WMS と完全互換のバイト列。
 *
 * パケット構造（Wireshark 採取結果と一致）：
 *   1. ENQ (1 byte, 0x05)
 *   2. <STX><ESC>A<ESC>A3V+00000H+0000<ESC>CS6<ESC>#F5<ESC>A1V00240H0320<ESC>Z<ETX>
 *   3. ENQ
 *   4. <STX><ESC>A<ESC>PS<ESC>WKdocument<ESC>%0<ESC>H{H4}<ESC>V{V5}<ESC>GB{w3}{h3}{rawData}<ESC>Q1<ESC>Z<ETX>
 */
export function buildSbplPayload(
  input: Pick<PrintLabelInput, 'invoiceNo' | 'pkNo'>,
): Buffer {
  const data = input.invoiceNo;

  // 描画位置（既定は現行と同じ H=81, V=30）
  const h4 = (process.env.PRINTER_QR_H ?? '0081').padStart(4, '0');
  const v5 = (process.env.PRINTER_QR_V ?? '00030').padStart(5, '0');

  // キャンバス合成
  const canvas = buildCanvas(data);
  const w3 = String(canvas.widthBytes).padStart(3, '0');
  const h3 = String(canvas.heightByteRows).padStart(3, '0');

  // 印字濃度（既定 5）。0〜9 の範囲にクランプ。
  //   高い値ほどサーマルヘッドの転写量が増え、線が太く・濃く見える。
  //   コンベア式リーダー対応では 7〜8 を推奨。
  const densityRaw = parseInt(process.env.PRINTER_DENSITY ?? '5', 10);
  const density = Math.min(9, Math.max(0, isNaN(densityRaw) ? 5 : densityRaw));

  // 印字速度（既定 6）。1〜9 の範囲にクランプ。
  //   遅い値（小さい）ほどサーマルヘッドが各ドットを長く加熱し、
  //   インク転写量が増えて線が太く・濃く印字される。
  //   コンベア式リーダー対応では 3 程度を推奨（速度↓ → 太さ↑）。
  const speedRaw = parseInt(process.env.PRINTER_SPEED ?? '6', 10);
  const speed = Math.min(9, Math.max(1, isNaN(speedRaw) ? 6 : speedRaw));

  // ── 設定パケット（端末初期化）──
  const setupPacket = Buffer.concat([
    Buffer.from([STX, ESC]),
    asc('A'),
    Buffer.from([ESC]),
    asc('A3V+00000H+0000'),
    Buffer.from([ESC]),
    asc(`CS${speed}`),
    Buffer.from([ESC]),
    asc(`#F${density}`),
    Buffer.from([ESC]),
    asc('A1V00240H0320'),
    Buffer.from([ESC]),
    asc('Z'),
    Buffer.from([ETX]),
  ]);

  // ── メインジョブ（QR ビットマップ送信）──
  const mainPacket = Buffer.concat([
    Buffer.from([STX, ESC]),
    asc('A'),
    Buffer.from([ESC]),
    asc('PS'),
    Buffer.from([ESC]),
    asc('WKdocument'),
    Buffer.from([ESC]),
    asc('%0'),
    Buffer.from([ESC]),
    asc(`H${h4}`),
    Buffer.from([ESC]),
    asc(`V${v5}`),
    Buffer.from([ESC]),
    asc(`GB${w3}${h3}`),
    canvas.data,
    Buffer.from([ESC]),
    asc('Q1'),
    Buffer.from([ESC]),
    asc('Z'),
    Buffer.from([ETX]),
  ]);

  // ENQ → 設定 → ENQ → メインジョブ の順で連結
  return Buffer.concat([
    Buffer.from([ENQ]),
    setupPacket,
    Buffer.from([ENQ]),
    mainPacket,
  ]);
}

/** プリンタ言語を環境変数 PRINTER_LANG で切替（sbpl | zpl）。既定は sbpl。 */
export function buildLabelPayload(
  input: Pick<PrintLabelInput, 'invoiceNo' | 'pkNo'>,
): Buffer {
  const lang = (process.env.PRINTER_LANG ?? 'sbpl').toLowerCase();
  if (lang === 'zpl') return Buffer.from(buildZplPayload(input), 'ascii');
  return buildSbplPayload(input);
}

// ===================================================================
// プリンタ送信（TCP RAW）
// ===================================================================

/** プリンター送信（DRY-RUN 既定）。 */
export async function sendPrintJob(input: PrintLabelInput): Promise<PrintLabelResult> {
  const payload = buildLabelPayload(input);
  const dryRun = process.env.PRINTER_DRY_RUN !== 'false';

  if (dryRun) {
    console.info(
      `[print-client] DRY-RUN → ${input.printerHost}:${input.printerPort} ` +
        `pkNo=${input.pkNo} invoice=${input.invoiceNo} bytes=${payload.length}`,
    );
    return { status: 'success', dryRun: true, bytesSent: payload.length };
  }

  return await new Promise<PrintLabelResult>((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const finish = (result: PrintLabelResult) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(result);
    };

    sock.setTimeout(8000); // ビットマップは送信量が増えるためタイムアウト延長
    sock.once('error', (e) =>
      finish({ status: 'failed', errorMsg: e.message, dryRun: false, bytesSent: 0 }),
    );
    sock.once('timeout', () =>
      finish({ status: 'failed', errorMsg: 'TCP timeout', dryRun: false, bytesSent: 0 }),
    );

    sock.connect(input.printerPort, input.printerHost, () => {
      // 既に Buffer なのでそのまま送信（バイナリ完全保持）
      sock.end(payload, () => {
        finish({
          status: 'success',
          dryRun: false,
          bytesSent: payload.length,
        });
      });
    });
  });
}
