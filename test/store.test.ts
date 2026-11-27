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
test('발송 전에 멈춘 미완료 기록은 5분 뒤 다시 잡힌다', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'fortune-')), 'x.sqlite');
  const t0 = new Date('2026-11-27T00:00:30Z');
  const min = (n: number) => new Date(t0.getTime() + n * 60_000);
  let s = Store.open(path);
  assert.equal(s.claimDelivery('c1', '2026-11-27', t0), true);
  assert.equal(s.claimDelivery('c2', '2026-11-27', t0), true);
  s.setDeliveryMessage('c2', '2026-11-27', 'm2');
  s.close();
  s = Store.open(path);
  assert.equal(s.claimDelivery('c1', '2026-11-27', min(4)), false);
  assert.equal(s.claimDelivery('c1', '2026-11-27', min(6)), true);
  assert.equal(s.claimDelivery('c1', '2026-11-27', min(7)), false);
  assert.equal(s.claimDelivery('c2', '2026-11-27', min(60)), false);
  s.close();
});
test('대화방 참조는 갱신되고 null이면 기존 값을 유지한다', () => {
  const s = Store.open(':memory:');
  s.activateConversation('c1', { v: 1 });
  s.activateConversation('c1', { v: 2 });
  s.activateConversation('c1', null);
  s.activateConversation('c2', null);
  assert.deepEqual(s.conversationReferences(), [{ id: 'c1', reference: { v: 2 } }]);
});
test('같은 날짜 운세는 처음 저장본을 유지한다', () => {
  const s = Store.open(':memory:');
  const facts = buildDayFacts('2026-11-27', []);
  s.saveFortune({ date: '2026-11-27', facts, texts: { ...templateTexts(facts), news: '처음…' }, source: 'llm' });
  s.saveFortune({ date: '2026-11-27', facts, texts: { ...templateTexts(facts), news: '나중…' }, source: 'template' });
  const f = s.getFortune('2026-11-27')!;
  assert.equal(f.texts.news, '처음…');
  assert.equal(f.source, 'llm');
});
