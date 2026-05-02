/**
 * className 結合ユーティリティ
 * 既に clsx を依存に持つので薄くラップ。
 */
import clsx, { type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
