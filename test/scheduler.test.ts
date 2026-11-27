import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ANIMALS } from '../src/domain.js';
import { isSendWindow, runScheduledTasks, type FortuneDeps } from '../src/scheduler.js';
import { Store } from '../src/store.js';

const ref = (id: string) => ({ conversation: { id }, serviceUrl: 'https://example.invalid/' });

// 실제 CloudAdapter처럼 logic 안 예외는 onTurnError로 넘기고 정상 종료한다
function fakeAdapter(opts: { fail?: boolean } = {}) {
  let fail = opts.fail ?? false;
  const sent: { conversation: string; activity: any }[] = [];
  const adapter = {
    sent,
    async continueConversation(_appId: string, reference: any, fn: (ctx: any) => Promise<void>) {
      const context = {
        async sendActivity(activity: any) {
          if (fail) { fail = false; throw new Error('network_error'); }
          sent.push({ conversation: reference.conversation.id, activity });
          return { id: `m${sent.length}` };
        },
      };
      try { await fn(context); } catch { /* onTurnError가 처리한 것으로 본다 */ }
    },
  };
  return adapter as typeof adapter & Parameters<typeof runScheduledTasks>[0];
}

function fakeDeps() {
  const deps = { calls: 0 } as FortuneDeps & { calls: number };
  deps.env = { GEMINI_API_KEY: 'test-key' };
  deps.iconUrl = 'https://example.invalid/owl.png';
  deps.fetchImpl = (async () => {
    deps.calls++;
    const content = JSON.stringify({ rows: ANIMALS.map((animal) => ({ animal, line: '조용한 하루예요…', extra: '회의실 구석이 편해요…' })), news: '별을 세다 졸았어요…' });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;
  return deps;
}

test('발송 시간은 업무일 09:00 이상 10:00 미만', () => {
  assert.equal(isSendWindow(new Date('2026-11-27T00:00:30Z')), true);
  assert.equal(isSendWindow(new Date('2026-11-27T00:59:59Z')), true);
  assert.equal(isSendWindow(new Date('2026-11-26T23:59:00Z')), false);
  assert.equal(isSendWindow(new Date('2026-11-27T01:00:00Z')), false);
});

test('평일 09:00에 대화방마다 한 번, LLM은 하루 한 번', async () => {
  const adapter = fakeAdapter(), deps = fakeDeps();
  const store = Store.open(':memory:'); store.activateConversation('c1', ref('c1')); store.activateConversation('c2', ref('c2'));
  const nine = new Date('2026-11-27T00:00:30Z');
  await Promise.all([runScheduledTasks(adapter, 'app', store, deps, nine), runScheduledTasks(adapter, 'app', store, deps, nine)]);
  await runScheduledTasks(adapter, 'app', store, deps, new Date('2026-11-27T00:01:00Z'));
  assert.equal(adapter.sent.length, 2); assert.equal(deps.calls, 1);
  assert.deepEqual(adapter.sent.map((s) => s.conversation).sort(), ['c1', 'c2']);
  assert.equal(adapter.sent[0].activity.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
  assert.equal(store.getFortune('2026-11-27')!.source, 'llm');
});

test('발송 시간 밖과 휴일에는 보내지 않음', async () => {
  const adapter = fakeAdapter(), deps = fakeDeps();
  const store = Store.open(':memory:'); store.activateConversation('c1', ref('c1'));
  for (const t of ['2026-11-26T23:59:00Z', '2026-11-27T01:00:00Z', '2026-11-28T00:00:30Z', '2026-12-25T00:00:30Z'])
    await runScheduledTasks(adapter, 'app', store, deps, new Date(t));
  assert.equal(adapter.sent.length, 0); assert.equal(deps.calls, 0);
});

test('09:30 재시작 뒤에도 보냄', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'fortune-')), 'x.sqlite');
  const before = Store.open(path); before.activateConversation('c1', ref('c1')); before.close();
  const adapter = fakeAdapter(), store = Store.open(path);
  await runScheduledTasks(adapter, 'app', store, fakeDeps(), new Date('2026-11-27T00:30:00Z'));
  assert.equal(adapter.sent.length, 1);
  store.close();
});

test('발송 실패는 다음 주기에 재시도', async () => {
  const adapter = fakeAdapter({ fail: true }), deps = fakeDeps();
  const store = Store.open(':memory:'); store.activateConversation('c1', ref('c1'));
  const errors: unknown[] = [], original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    await runScheduledTasks(adapter, 'app', store, deps, new Date('2026-11-27T00:00:30Z'));
  } finally { console.error = original; }
  assert.equal(adapter.sent.length, 0); assert.equal(errors.length, 1);
  await runScheduledTasks(adapter, 'app', store, deps, new Date('2026-11-27T00:01:00Z'));
  assert.equal(adapter.sent.length, 1);
  // message_id가 기록됐으므로 5분이 지나도 다시 잡히지 않는다
  assert.equal(store.claimDelivery('c1', '2026-11-27', new Date('2026-11-27T00:30:00Z')), false);
  assert.equal(deps.calls, 1);
});
