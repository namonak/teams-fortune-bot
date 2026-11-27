import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays } from '../src/calendar.js';
import { ANIMALS, buildDayFacts } from '../src/domain.js';
import { buildPrompt, generateTexts, templateTexts, validateTexts } from '../src/llm.js';

const facts = buildDayFacts('2026-12-11', [{ name: '홍길동', monthDay: '12-12' }]);
const ok = { rows: ANIMALS.map((a) => ({ animal: a, line: '좋은 하루…', extra: '천천히…' })), news: '붕어빵…', birthday: '케이크…' };
const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), { status });

test('정상 응답', async () => {
  const r = await generateTexts(facts, [], { OPENROUTER_API_KEY: 'k' }, reply(ok));
  assert.equal(r.source, 'llm'); assert.equal(r.texts.rows.length, 12); assert.equal(r.texts.birthday, '케이크…');
});

test('OpenRouter로 요청하고 .env 값의 공백을 지운다', async () => {
  const sent: { url: string; init: RequestInit }[] = [];
  const f = async (url: string, init: RequestInit) => { sent.push({ url, init }); return reply(ok)(); };
  await generateTexts(facts, [], { OPENROUTER_API_KEY: ' k\r' }, f as unknown as typeof fetch);
  await generateTexts(facts, [], { OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'google/gemini-3.5-flash-lite ', OPENROUTER_BASE_URL: 'http://127.0.0.1:9/v1/' }, f as unknown as typeof fetch);
  assert.equal(sent[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal((sent[0].init.headers as Record<string, string>).Authorization, 'Bearer k');
  const body = JSON.parse(sent[0].init.body as string);
  assert.equal(body.model, 'google/gemini-3.6-flash'); assert.equal(body.reasoning_effort, 'low'); assert.equal(body.response_format.type, 'json_schema');
  assert.equal(sent[1].url, 'http://127.0.0.1:9/v1/chat/completions');
  assert.equal(JSON.parse(sent[1].init.body as string).model, 'google/gemini-3.5-flash-lite');
});

test('프롬프트에 이름·인원 수가 없다', () => {
  const p = buildPrompt(facts, []);
  assert.doesNotMatch(p.system + p.user, /홍길동/);
  assert.match(p.user, /미리 축하/);
});

test('실패는 모두 템플릿', async () => {
  const env = { OPENROUTER_API_KEY: 'k' };
  for (const [name, f] of [
    ['HTTP 500', reply(ok, 500)],
    ['JSON 아님', async () => new Response('{"choices":[{"message":{"content":"앗"}}]}')],
    ['11개', reply({ ...ok, rows: ok.rows.slice(1) })],
    ['순서 다름', reply({ ...ok, rows: [ok.rows[1], ok.rows[0], ...ok.rows.slice(2)] })],
    ['40자 초과', reply({ ...ok, rows: ok.rows.map((r) => ({ ...r, line: '가'.repeat(41) })) })],
    ['생일 누락', reply({ ...ok, birthday: '' })],
    ['예외', async () => { throw new DOMException('timeout', 'TimeoutError'); }],
  ] as const) assert.equal((await generateTexts(facts, [], env, f as typeof fetch)).source, 'template', name);
  let called = false;
  assert.equal((await generateTexts(facts, [], {}, async () => { called = true; return new Response(''); })).source, 'template');
  assert.equal(called, false);
});

test('마크다운 문자 제거', () => {
  const t = validateTexts({ ...ok, news: '**굵게** [링크](x) <b>' }, true)!;
  assert.equal(t.news, '굵게 링크(x) b');
});

test('목록·제목 표시와 줄바꿈 정리', () => {
  const rows = ok.rows.map((r, i) => i === 0 ? { ...r, line: '- ' + '가'.repeat(40), extra: '## 1. 첫째\r\n\n  둘째' } : i === 1 ? { ...r, line: '3시에 칼퇴…', extra: '+ 2. 점심은  12시…' } : r);
  const t = validateTexts({ ...ok, rows, news: '- 첫째\n- 둘째', birthday: '> 축하해요…' }, true)!;
  assert.equal(t.rows[0].line, '가'.repeat(40)); // 정리 후 길이로 검사합니다
  assert.equal(t.rows[0].extra, '첫째 둘째');
  assert.equal(t.rows[1].line, '3시에 칼퇴…');
  assert.equal(t.rows[1].extra, '점심은 12시…');
  assert.equal(t.news, '첫째 - 둘째');
  assert.equal(t.birthday, '축하해요…');
});

test('템플릿은 같은 날 같은 문장이고 생일이 없으면 null', () => {
  assert.deepEqual(templateTexts(facts), templateTexts(facts));
  assert.ok(templateTexts(facts).birthday);
  assert.equal(templateTexts(buildDayFacts('2026-12-11', [])).birthday, null);
});

test('템플릿의 다른 봇 언급은 하루 2번 이하', () => {
  const bots = /냠요정|쿠웨이트박|투표곰|장부장/;
  for (let d = '2026-01-02'; d < '2027-11-30'; d = addDays(d, 1)) {
    const t = templateTexts(buildDayFacts(d, []));
    const n = [...t.rows.map((r) => r.extra), t.news].filter((s) => bots.test(s)).length;
    assert.ok(n <= 2, `${d}: ${n}번`);
  }
});
