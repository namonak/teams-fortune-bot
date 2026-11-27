import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import test, { mock } from 'node:test';
// agents-hosting이 함께 설치하는 활동 객체(테스트에서만 쓴다)
import { Activity } from '@microsoft/agents-activity';
import { CloudAdapter, TurnContext, getAuthConfigWithDefaults } from '@microsoft/agents-hosting';
import { kstParts } from '../src/calendar.js';
import { GREETING_TEXT, HELP_TEXT, NOT_YET_TEXT, buildFortuneCard } from '../src/cards.js';
import { buildDayFacts } from '../src/domain.js';
import { templateTexts } from '../src/llm.js';
import { FortuneBot, TURN_ERROR_TEXT, createAdapter, createApp, mentionReply, parseCommand, runScheduledTick } from '../src/index.js';
import { Store } from '../src/store.js';

const FAKE_AUTH = { MicrosoftAppId: '00000000-0000-0000-0000-000000000001', MicrosoftAppPassword: 'fake', MicrosoftAppTenantId: '00000000-0000-0000-0000-000000000002' };

test('인증 누락은 시작 거부, 무인증 요청은 401, healthz와 아이콘', async () => {
  assert.throws(() => createApp({}), /MicrosoftAppId/);
  const dir = mkdtempSync(join(tmpdir(), 'fortune-app-'));
  const app = createApp({ ...FAKE_AUTH, DATABASE_PATH: join(dir, 'test.sqlite'), OPENROUTER_API_KEY: 'test-key' });
  const request = async (method: string, url: string) => {
    let output = '';
    const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    const req = new IncomingMessage(socket as Socket); req.method = method; req.url = url; req.headers = { host: 'localhost' };
    const res = new ServerResponse(req); res.assignSocket(socket as Socket);
    const done = new Promise<void>((resolve, reject) => { res.on('finish', resolve); res.on('error', reject); });
    app(req, res); await done; return { status: res.statusCode, output };
  };
  try {
    const health = await request('GET', '/healthz'); assert.equal(health.status, 200); assert.match(health.output, /\{"ok":true\}/);
    assert.equal((await request('POST', '/api/messages')).status, 401);
    const icon = await request('GET', '/assets/owl.png'); assert.equal(icon.status, 200); assert.match(icon.output, /image\/png/);
  } finally { await app.locals.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test('명령 해석과 멘션 응답', () => {
  assert.equal(parseCommand(' '), 'today'); assert.equal(parseCommand('오늘'), 'today'); assert.equal(parseCommand(' 오늘 운세 '), 'today');
  assert.equal(parseCommand('도움말'), 'help'); assert.equal(parseCommand('뭐야'), 'help');
  const s = Store.open(':memory:');
  assert.deepEqual(mentionReply(s, '', new Date('2026-11-28T03:00:00Z'), 'u'), { text: NOT_YET_TEXT });
  assert.deepEqual(mentionReply(s, '도움말', new Date('2026-11-28T03:00:00Z'), 'u'), { text: HELP_TEXT });
  const facts = buildDayFacts('2026-11-27', []), texts = templateTexts(facts);
  s.saveFortune({ date: '2026-11-27', facts, texts, source: 'template' });
  // 2026-11-27 23:00 KST(같은 날)
  assert.deepEqual(mentionReply(s, '오늘', new Date('2026-11-27T14:00:00Z'), 'u'), { card: buildFortuneCard(facts, texts, 'u') });
  // 2026-11-28 00:30 KST(다음 날)
  assert.deepEqual(mentionReply(s, '오늘', new Date('2026-11-27T15:30:00Z'), 'u'), { text: NOT_YET_TEXT });
});

test('정기 실행 실패는 한국어 로그만 남기고 다음 주기를 막지 않는다', async (t) => {
  const error = mock.method(console, 'error', () => {});
  t.after(() => error.mock.restore());
  const store = Store.open(':memory:'); store.close();
  const adapter = { async continueConversation() {} } as never;
  // 닫힌 저장소로 발송 시간(2026-11-27 09:00:30 KST)에 실행하면 운세 준비가 실패한다
  await runScheduledTick(adapter, 'app', store, { env: {}, iconUrl: 'u' }, new Date('2026-11-27T00:00:30Z'));
  assert.equal(error.mock.callCount(), 1);
  assert.match(String(error.mock.calls[0].arguments[0]), /정기 발송/);
});

test('설치되면 인사하고 대화방을 저장, 멘션에는 도움말로 답한다', async () => {
  const store = Store.open(':memory:');
  const adapter = new CloudAdapter(getAuthConfigWithDefaults({ clientId: 'app', clientSecret: 'secret', tenantId: 'tenant' }));
  const sent: any[] = [];
  Object.assign(adapter, { sendActivities: async (_context: unknown, activities: any[]) => { sent.push(...activities); return activities.map(() => ({ id: 'm' })); } });
  const bot = new FortuneBot(store, 'https://example.invalid/assets/owl.png');
  const base = { channelId: 'msteams', serviceUrl: 'https://example.invalid/', conversation: { id: 'chat', conversationType: 'groupChat' }, recipient: { id: 'bot', name: '쓱부엉' }, from: { id: 'user', name: '홍길동' } };
  // 다른 사람이 들어온 것은 설치가 아니다
  await bot.run(new TurnContext(adapter, Activity.fromObject({ ...base, type: 'conversationUpdate', membersAdded: [{ id: 'user' }] })));
  assert.equal(sent.length, 0);
  await bot.run(new TurnContext(adapter, Activity.fromObject({ ...base, type: 'conversationUpdate', membersAdded: [{ id: 'bot' }] })));
  assert.equal(sent.length, 1); assert.equal(sent[0].text, GREETING_TEXT);
  assert.deepEqual(store.conversationReferences().map((r) => r.id), ['chat']);
  await bot.run(new TurnContext(adapter, Activity.fromObject({ ...base, type: 'message', text: '<at>쓱부엉</at> 도움말', entities: [{ type: 'mention', mentioned: { id: 'bot', name: '쓱부엉' }, text: '<at>쓱부엉</at>' }] })));
  assert.equal(sent.length, 2); assert.equal(sent[1].text, HELP_TEXT);
  // 오늘 저장본이 있으면 같은 카드를 첨부해 보낸다
  const today = kstParts(new Date()).date, facts = buildDayFacts(today, []), texts = templateTexts(facts);
  store.saveFortune({ date: today, facts, texts, source: 'template' });
  await bot.run(new TurnContext(adapter, Activity.fromObject({ ...base, type: 'message', text: '<at>쓱부엉</at>', entities: [{ type: 'mention', mentioned: { id: 'bot', name: '쓱부엉' }, text: '<at>쓱부엉</at>' }] })));
  assert.equal(sent.length, 3);
  assert.deepEqual(sent[2].attachments[0].content, buildFortuneCard(facts, texts, 'https://example.invalid/assets/owl.png'));
});

test('처리 중 예외는 상세를 서버 로그에만 남기고 대화방에는 짧은 안내 한 줄만 보낸다', async (t) => {
  const error = mock.method(console, 'error', () => {});
  t.after(() => error.mock.restore());
  const adapter = createAdapter(getAuthConfigWithDefaults({ clientId: 'app', clientSecret: 'secret', tenantId: 'tenant' }));
  let failSend = false;
  const sent: any[] = [];
  Object.assign(adapter, {
    createConnectorClientWithIdentity: async () => ({}), createUserTokenClient: async () => ({}),
    sendActivities: async (_context: unknown, activities: any[]) => { if (failSend) throw new Error('send failed'); sent.push(...activities); return activities.map(() => ({ id: 'm' })); },
  });
  // 닫힌 저장소로 멘션을 처리하면 대화방 저장에서 예외가 난다
  const store = Store.open(':memory:'); store.close();
  const bot = new FortuneBot(store, 'u');
  const message = new TurnContext(adapter, Activity.fromObject({ type: 'message', channelId: 'msteams', serviceUrl: 'https://example.invalid/', conversation: { id: 'chat' }, recipient: { id: 'bot' }, from: { id: 'user' }, text: '오늘' }));
  // 처리기 밖으로 나온 예외가 실제 CloudAdapter의 onTurnError로 가도록 continueConversation 안에서 봇을 실행한다
  const turn = () => adapter.continueConversation('app', { serviceUrl: 'https://example.invalid/', channelId: 'msteams', conversation: { id: 'chat' }, agent: { id: 'bot' }, user: { id: 'user' } } as never, () => bot.run(message));
  await turn();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'message'); assert.equal(sent[0].text, TURN_ERROR_TEXT);
  assert.ok(!JSON.stringify(sent).includes('database is not open'));
  assert.match(String(error.mock.calls[0].arguments[0]), /처리 실패/);
  assert.match(String(error.mock.calls[0].arguments[1]), /database is not open/);
  // 안내 전송까지 실패해도 예외가 밖으로 나가지 않는다
  failSend = true;
  await turn();
  assert.equal(sent.length, 1);
});
