import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFortuneCard } from '../src/cards.js';
import { ANIMALS, buildDayFacts } from '../src/domain.js';
import { templateTexts } from '../src/llm.js';

test('카드 구조', () => {
  const facts = buildDayFacts('2026-11-27', []); const texts = templateTexts(facts);
  const card = buildFortuneCard(facts, texts, 'https://x/assets/owl.png'); const json = JSON.stringify(card);
  for (let i = 0; i < 12; i++) assert.match(json, new RegExp(`"targetElements":\\["d${i}","open${i}","close${i}"\\]`));
  assert.ok(json.indexOf('"쥐"') < json.indexOf('"돼지"'));
  assert.match(json, /오늘 제일 좋은 띠는 \*\*원숭이\*\*… \*\*돼지\*\*띠는 쉬어 가세요…/);
  assert.match(json, /오늘은 을사일\(뱀날\)이에요/);
  assert.match(json, /금요일이에요… 칼퇴운부터 보세요/);
  assert.doesNotMatch(json, /생일 쪽지/);
});
test('생일 상자와 별점 유지', () => {
  const facts = buildDayFacts('2026-12-11', [{ name: '홍길동', monthDay: '12-12' }, { name: '김철수', monthDay: '12-13' }]);
  const json = JSON.stringify(buildFortuneCard(facts, { ...templateTexts(facts), birthday: '케이크…' }, 'u'));
  assert.match(json, /주말에 \*\*홍길동\*\*님, \*\*김철수\*\*님 생일이 있어요… 미리 두고 가요…/);
  assert.match(json, /케이크…/);
  assert.match(json, /오늘 제일 좋은 띠는 \*\*말\*\*… \*\*소\*\*띠는 쉬어 가세요…/);
});
test('최대 길이 문장에서도 28KB 이하', () => {
  const facts = buildDayFacts('2026-12-11', [{ name: '가'.repeat(10), monthDay: '12-12' }]);
  const texts = { rows: ANIMALS.map(() => ({ line: '가'.repeat(40), extra: '가'.repeat(60) })), news: '가'.repeat(60), birthday: '가'.repeat(60) };
  assert.ok(Buffer.byteLength(JSON.stringify(buildFortuneCard(facts, texts, 'https://fortune-bot.namonak.dev/assets/owl.png'))) < 28 * 1024);
});
