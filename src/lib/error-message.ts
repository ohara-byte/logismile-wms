/**
 * エラーメッセージの日本語化（タブレット / ハンディ共用）
 *
 * 2026-08-11 新規（現場要望）:
 *   端末に `HTTP 500` / `TypeError: Failed to fetch` のような英語・コードがそのまま出ており、
 *   何が起きたのか現場で判断できず対応が遅れていた。
 *   「何が起きたか」「どうすればよいか」を日本語で返す純関数に集約する。
 *
 * 方針:
 *   - サーバが返した日本語メッセージ（API の `message`）は最優先で尊重する。
 *     業務文脈を持つのはサーバ側なので、こちらで上書きしない。
 *   - 日本語が無い場合だけ、HTTP ステータスや例外の種類から日本語を組み立てる。
 *   - 原文（英語・コード）は捨てずに `raw` として残し、画面の折りたたみで見せる。
 *     現場は日本語だけ見れば済み、問い合わせ時は原文を伝えられる。
 */

export interface FriendlyError {
  /** 大きく出す見出し。「何が起きたか」 */
  title: string;
  /** 補足。「どうすればよいか」 */
  hint?: string;
  /** 原文（英語・スタックなど）。折りたたみ表示用。日本語化できた場合のみ意味を持つ */
  raw?: string;
}

/** 日本語（ひらがな・カタカナ・漢字）を含むか。含めばサーバ側の業務メッセージとみなす。 */
export function hasJapanese(s: string): boolean {
  return /[぀-ヿ㐀-鿿]/.test(s);
}

/** HTTP ステータス → 日本語。業務メッセージが無いときのフォールバック。 */
export function httpStatusToJapanese(status: number): FriendlyError {
  if (status === 400 || status === 422) {
    return {
      title: '入力内容に誤りがあります',
      hint: 'スキャンし直すか、入力内容をご確認ください。',
    };
  }
  if (status === 401) {
    return {
      title: 'ログインの有効期限が切れました',
      hint: '社員番号で入り直してください。',
    };
  }
  if (status === 403) {
    return {
      title: 'この操作を行う権限がありません',
      hint: '管理PCの担当者にご連絡ください。',
    };
  }
  if (status === 404) {
    return {
      title: '対象が見つかりません',
      hint: 'ピッキング№・商品コードが正しいかご確認ください。',
    };
  }
  if (status === 409) {
    return {
      title: '他の端末と操作が重なりました',
      hint: '画面を読み込み直してから、もう一度お試しください。',
    };
  }
  if (status === 429) {
    return {
      title: '一時的に混み合っています',
      hint: '少し待ってから、もう一度お試しください。',
    };
  }
  if (status === 408 || status === 504) {
    return {
      title: 'サーバーの応答がありません',
      hint: '通信状況をご確認のうえ、もう一度お試しください。',
    };
  }
  if (status === 502 || status === 503) {
    return {
      title: 'サーバーに接続できません',
      hint: 'しばらく待っても直らない場合は管理PCの担当者にご連絡ください。',
    };
  }
  if (status >= 500) {
    return {
      title: 'サーバー側でエラーが発生しました',
      hint: '同じ操作を繰り返しても直らない場合は管理PCの担当者にご連絡ください。',
    };
  }
  if (status >= 400) {
    return {
      title: '操作を受け付けられませんでした',
      hint: 'もう一度お試しください。',
    };
  }
  return { title: 'エラーが発生しました' };
}

/**
 * 通信・実行時例外の英語メッセージ → 日本語。
 * 該当しなければ null（＝定型化できない未知のエラー）。
 */
function networkErrorToJapanese(text: string): FriendlyError | null {
  const t = text.toLowerCase();
  // ブラウザによって文言が違う（Chrome: Failed to fetch / Safari: Load failed / Firefox: NetworkError）
  if (
    t.includes('failed to fetch') ||
    t.includes('networkerror') ||
    t.includes('load failed') ||
    t.includes('network request failed') ||
    t.includes('err_internet_disconnected') ||
    t.includes('err_network')
  ) {
    return {
      title: 'サーバーに接続できません',
      hint: '端末の Wi-Fi が切れていないかご確認ください。直らない場合は管理PCの担当者へ。',
    };
  }
  if (t.includes('aborterror') || t.includes('timeout') || t.includes('timed out')) {
    return {
      title: '応答がありませんでした（タイムアウト）',
      hint: '通信状況をご確認のうえ、もう一度お試しください。',
    };
  }
  if (t.includes('unexpected token') || t.includes('json')) {
    // HTML のエラーページが返ってきて JSON パースに失敗した等
    return {
      title: 'サーバーから正しい応答が返りませんでした',
      hint: '画面を読み込み直してください。直らない場合は管理PCの担当者へ。',
    };
  }
  return null;
}

/**
 * 何でも受け取って日本語のエラーに変換する。
 *
 * @param input  Error / 文字列 / API の message など
 * @param status HTTP ステータス（分かる場合）
 * @param fallbackTitle 定型化できないときの見出し（画面ごとの文脈を渡す）
 */
export function toFriendlyError(
  input: unknown,
  opts?: { status?: number; fallbackTitle?: string },
): FriendlyError {
  const status = opts?.status;
  const text =
    input == null
      ? ''
      : input instanceof Error
        ? `${input.name}: ${input.message}`
        : typeof input === 'string'
          ? input
          : (() => {
              try {
                return JSON.stringify(input);
              } catch {
                return String(input);
              }
            })();
  const trimmed = text.trim();

  // ① 末尾等に紛れた `HTTP 500` を切り離す。
  //   既存コードには `エラー: HTTP 500` `引き継ぎに失敗しました: HTTP 500` のような
  //   「日本語 + HTTP コード」が多数あり、そのままだと②の日本語判定を素通りして
  //   現場にコードが出てしまう。日本語部分だけを見出しにし、コードは raw へ落とす。
  const httpMatch = trimmed.match(/HTTP\s*(\d{3})/i);
  const embeddedStatus = httpMatch ? Number(httpMatch[1]) : undefined;
  const withoutHttp = httpMatch
    ? trimmed.replace(httpMatch[0], '').replace(/[:：\-—\s]+$/u, '').replace(/^[:：\-—\s]+/u, '').trim()
    : trimmed;
  // 「エラー」「失敗」だけが残った場合は理由を説明していないので、日本語とみなさない
  const isMeaningful = (s: string) =>
    hasJapanese(s) && !/^(エラー|失敗|エラーです|失敗しました)$/u.test(s);

  const effectiveStatus = status ?? embeddedStatus;

  if (httpMatch) {
    const base =
      typeof effectiveStatus === 'number'
        ? httpStatusToJapanese(effectiveStatus)
        : { title: 'エラーが発生しました' };
    return {
      title: isMeaningful(withoutHttp) ? withoutHttp : base.title,
      hint: base.hint,
      raw: trimmed,
    };
  }

  // ② サーバが日本語で理由を返している場合はそれを使う（業務文脈を持つのはサーバ側）
  if (trimmed && isMeaningful(trimmed)) {
    return { title: trimmed };
  }

  // ③ 通信・実行時例外の定型パターン
  const net = trimmed ? networkErrorToJapanese(trimmed) : null;
  if (net) return { ...net, raw: trimmed };

  // ④ HTTP ステータスから
  if (typeof effectiveStatus === 'number') {
    return { ...httpStatusToJapanese(effectiveStatus), raw: trimmed || `HTTP ${effectiveStatus}` };
  }

  // ⑤ 定型化できない
  return {
    title: opts?.fallbackTitle ?? 'エラーが発生しました',
    hint: '同じ操作を繰り返しても直らない場合は管理PCの担当者にご連絡ください。',
    raw: trimmed || undefined,
  };
}

/**
 * fetch の Response からそのまま日本語エラーを作る。
 * API が `{ message }` を返していればそれを尊重し、無ければステータスから組み立てる。
 */
export async function friendlyErrorFromResponse(res: Response): Promise<FriendlyError> {
  let serverMessage: string | null = null;
  try {
    const j = await res.clone().json();
    const m = j?.message;
    if (typeof m === 'string' && m.trim()) serverMessage = m.trim();
  } catch {
    /* JSON でない（HTML エラーページ等）。ステータスから組み立てる */
  }
  if (serverMessage && hasJapanese(serverMessage)) {
    return { title: serverMessage };
  }
  return {
    ...httpStatusToJapanese(res.status),
    raw: serverMessage ? `${serverMessage}（HTTP ${res.status}）` : `HTTP ${res.status}`,
  };
}
