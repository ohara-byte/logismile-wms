// 大江ノ郷自然牧場 WMS — 初期データ投入スクリプト
// Phase 1: マスタ系の最小限初期データ + 管理PC ログイン用 admin ユーザー

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seed 開始');

  // ---------------------------------------------------------------
  // 11. shift_patterns（15パターン）
  // ---------------------------------------------------------------
  await prisma.shiftPattern.createMany({
    skipDuplicates: true,
    data: [
      { code: 'G7',  name: 'G勤務 7時間（9:00-17:00）', startTime: '09:00', endTime: '17:00', breakMin: 60, isOff: false, sortOrder: 10 },
      { code: 'G6',  name: 'G勤務 6時間（9:00-16:00）', startTime: '09:00', endTime: '16:00', breakMin: 60, isOff: false, sortOrder: 11 },
      { code: 'A7',  name: 'A勤務 7時間（8:00-16:00）', startTime: '08:00', endTime: '16:00', breakMin: 60, isOff: false, sortOrder: 20 },
      { code: 'A6',  name: 'A勤務 6時間（8:00-15:00）', startTime: '08:00', endTime: '15:00', breakMin: 60, isOff: false, sortOrder: 21 },
      { code: 'A4',  name: 'A勤務 4時間（8:00-12:00）', startTime: '08:00', endTime: '12:00', breakMin: 0,  isOff: false, sortOrder: 22 },
      { code: 'A3',  name: 'A勤務 3時間（8:00-11:00）', startTime: '08:00', endTime: '11:00', breakMin: 0,  isOff: false, sortOrder: 23 },
      { code: 'B7',  name: 'B勤務 7時間（10:00-18:00）', startTime: '10:00', endTime: '18:00', breakMin: 60, isOff: false, sortOrder: 30 },
      { code: 'D7',  name: 'D勤務 7時間（13:00-21:00）', startTime: '13:00', endTime: '21:00', breakMin: 60, isOff: false, sortOrder: 40 },
      { code: 'D6',  name: 'D勤務 6時間（13:00-20:00）', startTime: '13:00', endTime: '20:00', breakMin: 60, isOff: false, sortOrder: 41 },
      { code: 'E6',  name: 'E勤務 6時間（14:00-21:00）', startTime: '14:00', endTime: '21:00', breakMin: 60, isOff: false, sortOrder: 50 },
      { code: '公休', name: '公休',  isOff: true, sortOrder: 90 },
      { code: '有休', name: '有給休暇', isOff: true, sortOrder: 91 },
      { code: '希休', name: '希望休', isOff: true, sortOrder: 92 },
      { code: '特休', name: '特別休暇', isOff: true, sortOrder: 93 },
      { code: '欠勤', name: '欠勤', isOff: true, sortOrder: 99 },
    ],
  });
  console.log('  ✓ shift_patterns: 15');

  // ---------------------------------------------------------------
  // 12. employment_types（8区分）
  // ---------------------------------------------------------------
  await prisma.employmentType.createMany({
    skipDuplicates: true,
    data: [
      { code: 'seishain_a',  name: '正社員A',     dailyHours: 8.0, sortOrder: 10 },
      { code: 'seishain_8h', name: '正社員8h',    dailyHours: 8.0, sortOrder: 11 },
      { code: 'seishain_6h', name: '正社員6h',    dailyHours: 6.0, sortOrder: 12 },
      { code: 'jun_8',       name: '準社員8h',    dailyHours: 8.0, sortOrder: 20 },
      { code: 'jun_7',       name: '準社員7h',    dailyHours: 7.0, sortOrder: 21 },
      { code: 'jun_6',       name: '準社員6h',    dailyHours: 6.0, sortOrder: 22 },
      { code: 'short',       name: '短時間',     dailyHours: 4.0, sortOrder: 30 },
      { code: 'shokutaku',   name: '嘱託',       dailyHours: 8.0, sortOrder: 40 },
    ],
  });
  console.log('  ✓ employment_types: 8');

  // ---------------------------------------------------------------
  // 9. inspection_groups（7グループ）
  // ---------------------------------------------------------------
  await prisma.inspectionGroup.createMany({
    skipDuplicates: true,
    data: [
      { id: 'ABL', name: 'ABLグループ', tables: ['A', 'B', 'L'],   category: 'main',   needStaff: 4 },
      { id: 'CD',  name: 'CDグループ',  tables: ['C', 'D'],         category: 'main',   needStaff: 3 },
      { id: 'EF',  name: 'EFグループ',  tables: ['E', 'F'],         category: 'sweet',  needStaff: 3 },
      { id: 'GH',  name: 'GHグループ',  tables: ['G', 'H'],         category: 'gift',   needStaff: 3 },
      { id: 'IJ',  name: 'IJグループ',  tables: ['I', 'J'],         category: 'meat',   needStaff: 2 },
      { id: 'K',   name: 'Kグループ',   tables: ['K'],              category: 'frozen', needStaff: 2 },
      { id: 'MN',  name: 'MNグループ',  tables: ['M', 'N'],         category: 'gift',   needStaff: 2 },
    ],
  });
  console.log('  ✓ inspection_groups: 7');

  // ---------------------------------------------------------------
  // 6. carriers（5社）
  // ---------------------------------------------------------------
  await prisma.carrier.createMany({
    skipDuplicates: true,
    data: [
      { code: 'YMT-N',  name: 'ヤマト運輸（通常便）',   short: 'ヤマト',   priority: 10, cutoff: '17:00', pickup: '17:30', cool: false, wbType: '送り状A' },
      { code: 'YMT-C',  name: 'ヤマト運輸（クール便）', short: 'ヤマト冷', priority: 11, cutoff: '16:30', pickup: '17:30', cool: true,  wbType: '送り状A冷' },
      { code: 'SGW-N',  name: '佐川急便（通常便）',     short: '佐川',     priority: 20, cutoff: '17:00', pickup: '17:30', cool: false, wbType: '送り状B' },
      { code: 'SGW-C',  name: '佐川急便（クール便）',   short: '佐川冷',   priority: 21, cutoff: '16:00', pickup: '17:30', cool: true,  wbType: '送り状B冷' },
      { code: 'JPP-N',  name: 'ゆうパック',             short: 'ゆうパ',   priority: 30, cutoff: '16:30', pickup: '17:30', cool: false, wbType: '送り状C' },
    ],
  });
  console.log('  ✓ carriers: 5');

  // ---------------------------------------------------------------
  // 14. printers（6台）
  // ---------------------------------------------------------------
  await prisma.printer.createMany({
    skipDuplicates: true,
    data: [
      { code: 'PRN-01', name: '検品エリアA', ipAddress: '192.168.10.101', location: 'ABLテーブル付近', port: 9100, model: 'SCeaTa CT4-LX', labelSize: '30x40' },
      { code: 'PRN-02', name: '検品エリアB', ipAddress: '192.168.10.102', location: 'CDテーブル付近',  port: 9100, model: 'SCeaTa CT4-LX', labelSize: '30x40' },
      { code: 'PRN-03', name: '検品エリアC', ipAddress: '192.168.10.103', location: 'EFテーブル付近',  port: 9100, model: 'SCeaTa CT4-LX', labelSize: '30x40' },
      { code: 'PRN-04', name: '検品エリアD', ipAddress: '192.168.10.104', location: 'GHテーブル付近',  port: 9100, model: 'SCeaTa CT4-LX', labelSize: '30x40' },
      { code: 'PRN-05', name: '検品エリアE', ipAddress: '192.168.10.105', location: 'IJKテーブル付近', port: 9100, model: 'SCeaTa CT4-LX', labelSize: '30x40' },
      { code: 'PRN-06', name: '検品エリアF', ipAddress: '192.168.10.106', location: 'MNテーブル付近',  port: 9100, model: 'SCeaTa CT4-LX', labelSize: '30x40' },
    ],
  });
  console.log('  ✓ printers: 6');

  // ---------------------------------------------------------------
  // 5. boxes（サンプル）
  // ---------------------------------------------------------------
  await prisma.box.createMany({
    skipDuplicates: true,
    data: [
      { code: 'BOX-FX-GIFT-A', name: 'ギフトA固定箱',  type: 'fixed',     sizeRank: 60,  wMm: 240, dMm: 180, hMm: 100, innerWMm: 230, innerDMm: 170, innerHMm: 95,  noshi: true, priority: 10, targetProducts: [] },
      { code: 'BOX-FX-GIFT-B', name: 'ギフトB固定箱',  type: 'fixed',     sizeRank: 80,  wMm: 280, dMm: 220, hMm: 120, innerWMm: 270, innerDMm: 210, innerHMm: 115, noshi: true, priority: 10, targetProducts: [] },
      { code: 'BOX-VAR-60',    name: '可変箱60サイズ', type: 'variable',  sizeRank: 60,  wMm: 250, dMm: 200, hMm: 150, innerWMm: 240, innerDMm: 190, innerHMm: 145, priority: 50, targetProducts: [] },
      { code: 'BOX-VAR-80',    name: '可変箱80サイズ', type: 'variable',  sizeRank: 80,  wMm: 320, dMm: 240, hMm: 180, innerWMm: 310, innerDMm: 230, innerHMm: 175, priority: 50, targetProducts: [] },
      { code: 'BOX-VAR-100',   name: '可変箱100サイズ', type: 'variable', sizeRank: 100, wMm: 400, dMm: 300, hMm: 220, innerWMm: 390, innerDMm: 290, innerHMm: 215, priority: 50, targetProducts: [] },
      { code: 'BOX-FZ-A',      name: '冷凍箱A',        type: 'fixed',     sizeRank: 80,  wMm: 300, dMm: 220, hMm: 150, innerWMm: 290, innerDMm: 210, innerHMm: 145, frozen: true, priority: 5, targetProducts: [] },
    ],
  });
  console.log('  ✓ boxes: 6');

  // ---------------------------------------------------------------
  // 1. products（サンプル）
  // ---------------------------------------------------------------
  await prisma.product.createMany({
    skipDuplicates: true,
    data: [
      { code: 'E-RAW-10',   jan: '4901234567890', name: '天美卵 10個入',         cat: 'egg',    pkg: '箱',   price: 1080, stdSec: 30,  noshi: false },
      { code: 'E-RAW-30',   jan: '4901234567906', name: '天美卵 30個入',         cat: 'egg',    pkg: '箱',   price: 2980, stdSec: 45,  noshi: true },
      { code: 'SW-CAKE-A',  jan: '4901234567913', name: 'プリンセット 6個',      cat: 'sweet',  pkg: '箱',   price: 2400, stdSec: 60,  noshi: true,  frozen: false },
      { code: 'SW-CAKE-B',  jan: '4901234567920', name: 'パンケーキミックス',     cat: 'sweet',  pkg: '袋',   price: 980,  stdSec: 20,  noshi: false },
      { code: 'MT-CHIK-A',  jan: '4901234567937', name: '天美鶏 もも肉 500g',    cat: 'meat',   pkg: 'パック', price: 1480, stdSec: 40, frozen: true,  special: true },
      { code: 'MT-CHIK-B',  jan: '4901234567944', name: '天美鶏 むね肉 500g',    cat: 'meat',   pkg: 'パック', price: 1280, stdSec: 40, frozen: true,  special: true },
      { code: 'FZ-SOUP-A',  jan: '4901234567951', name: '冷凍スープセット 6袋',  cat: 'frozen', pkg: '箱',   price: 3200, stdSec: 50,  frozen: true },
      { code: 'GFT-SET-A',  jan: '4901234567968', name: 'ギフトセットA',         cat: 'gift',   pkg: '箱',   price: 5400, stdSec: 90,  noshi: true,  special: true },
      { code: 'GFT-SET-B',  jan: '4901234567975', name: 'ギフトセットB',         cat: 'gift',   pkg: '箱',   price: 7800, stdSec: 120, noshi: true,  special: true },
      { code: 'SUP-MISO-A', jan: '4901234567982', name: 'みそ汁の素 10食',       cat: 'soup',   pkg: '箱',   price: 1620, stdSec: 25 },
    ],
  });
  console.log('  ✓ products: 10');

  // ---------------------------------------------------------------
  // 7. staff（admin + 数名のサンプル）
  // ---------------------------------------------------------------
  await prisma.staff.createMany({
    skipDuplicates: true,
    data: [
      { code: 'ADMIN01', empCode: '0001', name: '管理者 太郎',   kana: 'カンリシャ タロウ', role: 'admin',   employmentTypeCode: 'seishain_a', groupId: null,  defaultShiftPattern: 'G7' },
      { code: 'MGR01',   empCode: '0002', name: '管理 花子',     kana: 'カンリ ハナコ',     role: 'manager', employmentTypeCode: 'seishain_a', groupId: 'ABL', defaultShiftPattern: 'G7' },
      { code: 'STF01',   empCode: '1001', name: '検品 一郎',     kana: 'ケンピン イチロウ', role: 'staff',   employmentTypeCode: 'jun_8',      groupId: 'ABL', defaultShiftPattern: 'A7' },
      { code: 'STF02',   empCode: '1002', name: '検品 二郎',     kana: 'ケンピン ジロウ',   role: 'staff',   employmentTypeCode: 'jun_7',      groupId: 'CD',  defaultShiftPattern: 'A6' },
      { code: 'STF03',   empCode: '1003', name: '検品 三子',     kana: 'ケンピン ミツコ',   role: 'staff',   employmentTypeCode: 'short',      groupId: 'EF',  defaultShiftPattern: 'A4' },
    ],
  });
  console.log('  ✓ staff: 5');

  // ---------------------------------------------------------------
  // 8. devices（サンプル）
  // ---------------------------------------------------------------
  await prisma.device.createMany({
    skipDuplicates: true,
    data: [
      { code: 'PC-01',  name: '管理PC 1号機',    type: 'pc',     model: 'Dell OptiPlex',         location: '事務所' },
      { code: 'TBL-01', name: 'タブレット 1号機', type: 'tablet', model: 'HP14',                  location: 'ABLテーブル' },
      { code: 'TBL-02', name: 'タブレット 2号機', type: 'tablet', model: 'HP14',                  location: 'CDテーブル' },
      { code: 'HDY-01', name: 'ハンディ 1号機',   type: 'handy',  model: 'KEYENCE BT-A500',       location: 'EFテーブル' },
      { code: 'HDY-02', name: 'ハンディ 2号機',   type: 'handy',  model: 'KEYENCE BT-A500',       location: 'GHテーブル' },
    ],
  });
  console.log('  ✓ devices: 5');

  // ---------------------------------------------------------------
  // 15. device_printer_map（サンプル）
  // ---------------------------------------------------------------
  await prisma.devicePrinterMap.createMany({
    skipDuplicates: true,
    data: [
      { deviceCode: 'TBL-01', printerCode: 'PRN-01' },
      { deviceCode: 'TBL-02', printerCode: 'PRN-02' },
      { deviceCode: 'HDY-01', printerCode: 'PRN-03' },
      { deviceCode: 'HDY-02', printerCode: 'PRN-04' },
    ],
  });
  console.log('  ✓ device_printer_map: 4');

  // ---------------------------------------------------------------
  // 26. users（管理PC ログイン用 admin）
  // ---------------------------------------------------------------
  const adminPassword = 'admin123';
  const adminHash = await bcrypt.hash(adminPassword, 10);
  await prisma.user.upsert({
    where: { email: 'admin@wms.local' },
    update: {},
    create: {
      email: 'admin@wms.local',
      passwordHash: adminHash,
      role: 'admin',
      staffCode: 'ADMIN01',
      active: true,
    },
  });

  const mgrHash = await bcrypt.hash('manager123', 10);
  await prisma.user.upsert({
    where: { email: 'manager@wms.local' },
    update: {},
    create: {
      email: 'manager@wms.local',
      passwordHash: mgrHash,
      role: 'manager',
      staffCode: 'MGR01',
      active: true,
    },
  });
  console.log('  ✓ users: 2 (admin@wms.local / manager@wms.local)');

  console.log('🎉 Seed 完了');
  console.log('');
  console.log('  管理PC ログイン:');
  console.log('    Email:    admin@wms.local      Password: admin123');
  console.log('    Email:    manager@wms.local    Password: manager123');
  console.log('  タブレット/ハンディ ログイン:');
  console.log('    社員番号: 0001 (admin) / 0002 (manager) / 1001-1003 (staff)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
