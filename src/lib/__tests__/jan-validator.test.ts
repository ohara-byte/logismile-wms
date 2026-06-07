/**
 * JAN validator 動作確認スクリプト（node:test ベース）
 *
 * 実行: npm run test:lib
 * （Node 20+ 標準の test runner を使用）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateJan, calcCheckDigit } from '../jan-validator';

test('calcCheckDigit: GTIN-13 standard example', () => {
  // 4901777018013（実在する Suntory 天然水 PET の JAN）の CD は 3
  assert.equal(calcCheckDigit('490177701801'), 3);
  // '490123456789' の CD は 4
  assert.equal(calcCheckDigit('490123456789'), 4);
});

test('validateJan: 空欄は empty', () => {
  assert.equal(validateJan('').code, 'empty');
  assert.equal(validateJan(null).code, 'empty');
  assert.equal(validateJan('   ').code, 'empty');
});

test('validateJan: 数字以外は non_digit', () => {
  assert.equal(validateJan('490ABC4567890').code, 'non_digit');
});

test('validateJan: 桁数不正は invalid_length（ただし 12 桁は warn 扱い）', () => {
  assert.equal(validateJan('123').code, 'invalid_length');
  assert.equal(validateJan('1234567').code, 'invalid_length');
  assert.equal(validateJan('12345678901').code, 'invalid_length');
  assert.equal(validateJan('12345678901234').code, 'invalid_length');
});

test('validateJan: 12 桁（UPC-A 互換）は warn 扱いで取込許可', () => {
  // 12 桁・CD OK の例: 036000291452（実在する UPC-A 例）
  const r1 = validateJan('036000291452');
  assert.equal(r1.code, 'warn_12_digit');
  assert.equal(r1.severity, 'warn');
  assert.equal(r1.isValid, true); // 取込許可
  assert.equal(r1.normalized, '036000291452'); // JAN は格納される

  // 12 桁・CD NG でも warn（取込許可）
  const r2 = validateJan('036000291459');
  assert.equal(r2.code, 'warn_12_digit');
  assert.equal(r2.severity, 'warn');
  assert.equal(r2.isValid, true);
  assert.equal(r2.normalized, '036000291459');
});

test('validateJan: チェックデジット不正は invalid_check_digit', () => {
  // CD=3 が正解だが 1 を入れて意図的に狂わせる
  const result = validateJan('4901777018011');
  assert.equal(result.code, 'invalid_check_digit');
  assert.equal(result.isValid, false);
});

test('validateJan: 正しい 13 桁は ok', () => {
  const result = validateJan('4901777018013');
  assert.equal(result.code, 'ok');
  assert.equal(result.isValid, true);
  assert.equal(result.normalized, '4901777018013');
});

test('validateJan: 8 桁も許容', () => {
  // 49580001 は CD=1 (4*3+9*1+5*3+8*1+0*3+0*1+0*3 = 12+9+15+8 = 44, 10-4=6...let's compute properly)
  // GTIN-8 chk: weights from right: 3,1,3,1,3,1,3
  // For '4958000', digits: 4,9,5,8,0,0,0; from right: 0,0,0,8,5,9,4
  // weights: 3,1,3,1,3,1,3 -> 0+0+0+8+15+9+12 = 44 -> 10-(44%10)=10-4=6
  const result = validateJan('49580006');
  assert.equal(result.code, 'ok');
});

test('validateJan: trim される', () => {
  assert.equal(validateJan('  4901777018013  ').code, 'ok');
});
