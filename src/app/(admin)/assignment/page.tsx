/**
 * メンバー割当 Gantt（Phase 5-12, 5-13, 5-14, 5-15）
 *
 * 簡易版（フル D&D Gantt は Phase 6 で精緻化予定）:
 *  - 縦軸: 担当者
 *  - 横軸: 9-18 時の 30 分刻み（19 列）
 *  - セルクリックで「割当」「未設定」「休み」を切替（toggle 風）
 *  - グループは行追加方式（同じ担当者を複数行で扱う）→ 簡略化のため最初は 1 行
 *  - 「昨日読込」「全クリア」「保存」「当日シフト反映」を備える
 *  - 朝礼用印刷は window.print() で代替
 */

import { AssignmentClient } from './_components/assignment-client';

export default function AssignmentPage() {
  return (
    <main className="p-4 max-w-7xl mx-auto">
      <h1 className="text-xl font-bold text-ink-strong mb-4">👥 メンバー割当</h1>
      <AssignmentClient />
    </main>
  );
}
