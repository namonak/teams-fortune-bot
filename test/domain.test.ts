import assert from 'node:assert/strict';
import test from 'node:test';
import { ANIMALS, COLORS, MENUS, STARS, buildDayFacts, dayGanji, relation, yearGanji } from '../src/domain.js';

test('일진 검증값', () => {
  assert.deepEqual(dayGanji('2000-01-01'), { name: '무오', branch: 6 });
  assert.deepEqual(dayGanji('2026-11-26'), { name: '갑진', branch: 4 });
  assert.deepEqual(dayGanji('2026-11-27'), { name: '을사', branch: 5 });
  assert.deepEqual(dayGanji('2026-12-11'), { name: '기미', branch: 7 });
  assert.deepEqual(dayGanji('2024-02-29'), { name: '계해', branch: 11 });
  assert.deepEqual(dayGanji('2026-12-31'), { name: '기묘', branch: 3 });
  assert.deepEqual(dayGanji('2027-01-01'), { name: '경진', branch: 4 });
  assert.equal(yearGanji(2027).name, '정미');
  assert.equal(yearGanji(2026).name, '병오');
});
test('을사일과 기미일의 12띠 별점', () => {
  const stars = (d: number) => ANIMALS.map((_, a) => STARS[relation(d, a)]);
  assert.deepEqual(stars(5), [3,4,2,3,3,3,3,3,5,4,3,1]);
  assert.deepEqual(stars(7), [2,1,3,4,3,3,5,3,3,3,2,4]);
  assert.equal(relation(5, 5), '오늘의 띠');
  assert.equal(relation(7, 7), '오늘의 띠');
});
test('겹치는 관계의 우선순위', () => {
  assert.equal(relation(5, 8), '육합');   // 뱀·원숭이: 육합이면서 형
  assert.equal(relation(1, 7), '충');     // 소·양: 충이면서 형
  assert.equal(relation(2, 8), '충');     // 호랑이·원숭이: 충이면서 형
  assert.equal(relation(2, 5), '형·해');  // 호랑이·뱀: 형이면서 해
  assert.equal(relation(4, 4), '형·해');  // 용날의 용띠: 자형
  assert.equal(relation(0, 0), '오늘의 띠');
});
test('매일 충 1띠, 육합 1띠', () => {
  for (let d = 0; d < 12; d++) {
    const r = ANIMALS.map((_, a) => relation(d, a));
    assert.equal(r.filter((x) => x === '충').length, 1);
    assert.equal(r.filter((x) => x === '육합').length, 1);
  }
});
test('하루 운세 값', () => {
  const f = buildDayFacts('2026-11-27', []);
  assert.equal(f.ganji, '을사');
  assert.deepEqual(f.rows.map((r) => r.stars), [3,4,2,3,3,3,3,3,5,4,3,1]);
  assert.equal(f.best, 8); assert.equal(f.rest, 11);
  assert.deepEqual(buildDayFacts('2026-11-27', []), f);                 // 같은 날 같은 값
  for (const r of f.rows) for (const v of [r.meeting, r.lunch, r.leave]) assert.ok(v >= 1 && v <= 5);
  assert.ok(f.rows.every((r) => MENUS.includes(r.menu) && COLORS.includes(r.color)));
  assert.equal(f.hint, '금요일');
});
