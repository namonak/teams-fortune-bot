import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildDayFacts } from '../src/domain.js';
import { templateTexts } from '../src/llm.js';
import { Store } from '../src/store.js';

test('없는 폴더에도 DB를 연다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fortune-'));
  const store = Store.open(join(dir, 'a', 'b', 'x.sqlite')); store.close();
});
test('발송 기록은 하루 한 번만 잡힌다', () => {
  const s = Store.open(':memory:');
  assert.equal(s.claimDelivery('c1', '2026-11-27'), true);
  assert.equal(s.claimDelivery('c1', '2026-11-27'), false);
  s.releaseDelivery('c1', '2026-11-27');
  assert.equal(s.claimDelivery('c1', '2026-11-27'), true);
  assert.equal(s.claimDelivery('c2', '2026-11-27'), true);
});
test('운세 저장과 최근 근황', () => {
  const s = Store.open(':memory:');
  for (const [date, news] of [['2026-11-25', 'A…'], ['2026-11-26', 'B…'], ['2026-11-27', 'C…']]) {
    const facts = buildDayFacts(date, []);
    s.saveFortune({ date, facts, texts: { ...templateTexts(facts), news }, source: 'template' });
  }
  assert.deepEqual(s.recentNews('2026-11-27'), ['B…', 'A…']);
  assert.equal(s.getFortune('2026-11-26')!.texts.news, 'B…');
  assert.equal(s.getFortune('2026-11-28'), null);
});
