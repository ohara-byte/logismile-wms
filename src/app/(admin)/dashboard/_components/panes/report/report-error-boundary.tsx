'use client';

/**
 * レポートサブタブ用エラー境界（Sprint I-1）
 *
 * 1 タブで例外が発生してもダッシュボード全体を巻き込まないよう、
 * pane の描画範囲だけを切り離してフォールバック UI を表示する。
 */

import React from 'react';

interface Props {
  children: React.ReactNode;
  /** 切り替え時に内部状態をリセットするキー（サブタブ ID） */
  resetKey?: string;
}

interface State {
  err: Error | null;
}

export class ReportErrorBoundary extends React.Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidUpdate(prevProps: Props) {
    // タブを切り替えたら錯覚なくリセット
    if (prevProps.resetKey !== this.props.resetKey && this.state.err) {
      this.setState({ err: null });
    }
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ReportErrorBoundary]', err, info);
  }

  render() {
    if (this.state.err) {
      return (
        <div className="p-4 text-2xs">
          <div className="bg-red-950/40 border border-status-error/40 rounded p-3 text-status-error">
            <div className="font-bold mb-1">⚠ このサブタブの描画でエラーが発生しました</div>
            <div className="text-2xs whitespace-pre-wrap break-words text-red-200">
              {this.state.err.message}
            </div>
            <button
              onClick={() => this.setState({ err: null })}
              className="mt-2 px-2 py-1 rounded bg-red-900/60 text-red-100 text-3xs hover:bg-red-800"
            >
              再試行
            </button>
          </div>
        </div>
      );
    }
    return <>{this.props.children}</>;
  }
}
