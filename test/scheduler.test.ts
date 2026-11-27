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
  deps.env = { OPENROUTER_API_KEY: 'test-key' };
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
  // 대화방 발송 시각 13:45 → 13:45 이상 14:45 미만
  assert.equal(isSendWindow(new Date('2026-11-27T04:45:00Z'), '13:45'), true);
  assert.equal(isSendWindow(new Date('2026-11-27T05:44:59Z'), '13:45'), true);
  assert.equal(isSendWindow(new Date('2026-11-27T04:44:00Z'), '13:45'), false);
  assert.equal(isSendWindow(new Date('2026-11-27T05:45:00Z'), '13:45'), false);
  assert.equal(isSendWindow(new Date('2026-11-28T04:45:00Z'), '13:45'), false); // 토요일
});

test('대화방마다 자기 발송 시각에 보내고, 시각을 바꿔도 같은 날 다시 보내지 않는다', async () => {
  const adapter = fakeAdapter(), deps = fakeDeps();
  const store = Store.open(':memory:'); store.activateConversation('c1', ref('c1')); store.activateConversation('c2', ref('c2'));
  store.setSendTime('c2', '10:30');
  const at = (kst: string) => runScheduledTasks(adapter, 'app', store, deps, new Date(`2026-11-27T${kst}:00+09:00`));
  await at('09:00');
  assert.deepEqual(adapter.sent.map((s) => s.conversation), ['c1']);
  await at('10:00'); // c1 창은 끝났고 c2는 아직
  assert.equal(adapter.sent.length, 1);
  store.setSendTime('c1', '10:30'); // 이미 받은 c1은 바꾼 시각이 되어도 오늘 다시 받지 않는다
  await at('10:30');
  assert.deepEqual(adapter.sent.map((s) => s.conversation), ['c1', 'c2']);
  assert.equal(deps.calls, 1);
});

test('발송 시각이 된 대화방이 없으면 운세를 만들지 않는다', async () => {
  const adapter = fakeAdapter(), deps = fakeDeps();
  const store = Store.open(':memory:'); store.activateConversation('c1', ref('c1')); store.setSendTime('c1', '11:00');
  await runScheduledTasks(adapter, 'app', store, deps, new Date('2026-11-27T09:00:30+09:00'));
  assert.equal(deps.calls, 0); assert.equal(store.getFortune('2026-11-27'), null);
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

// 첫 sendActivity만 테스트가 끝낼 때까지 붙잡아 두고, 그 뒤 호출은 바로 성공한다
function slowAdapter() {
  let finish!: (ok: boolean) => void, started!: () => void;
  const firstStarted = new Promise<void>((r) => { started = r; });
  let calls = 0;
  const adapter = {
    get calls() { return calls; }, firstStarted, finish: (ok: boolean) => finish(ok),
    async continueConversation(_appId: string, _reference: any, fn: (ctx: any) => Promise<void>) {
      const context = {
        sendActivity: () => ++calls > 1 ? Promise.resolve({ id: `m${calls}` }) : new Promise((resolve, reject) => {
          finish = (ok) => ok ? resolve({ id: 'm1' }) : reject(new Error('late_failure'));
          started();
        }),
      };
      try { await fn(context); } catch { /* onTurnError가 처리한 것으로 본다 */ }
    },
  };
  return adapter as typeof adapter & Parameters<typeof runScheduledTasks>[0];
}

for (const ok of [true, false]) {
  test(`첫 발송이 5분 넘게 늦어도 다음 주기는 겹쳐 보내지 않음(늦게 ${ok ? '성공' : '실패'})`, async () => {
    const adapter = slowAdapter(), deps = fakeDeps();
    const store = Store.open(':memory:'); store.activateConversation('c1', ref('c1'));
    const original = console.error;
    console.error = () => {};
    try {
      const first = runScheduledTasks(adapter, 'app', store, deps, new Date('2026-11-27T00:00:30Z'));
      await adapter.firstStarted;
      await runScheduledTasks(adapter, 'app', store, deps, new Date('2026-11-27T00:06:30Z'));
      assert.equal(adapter.calls, 1);
      adapter.finish(ok);
      await first;
    } finally { console.error = original; }
    await runScheduledTasks(adapter, 'app', store, deps, new Date('2026-11-27T00:07:00Z'));
    // 늦게 성공하면 기록이 남아 다시 보내지 않고, 늦게 실패하면 다음 주기에 다시 보낸다
    assert.equal(adapter.calls, ok ? 1 : 2);
    assert.equal(store.claimDelivery('c1', '2026-11-27', new Date('2026-11-27T00:30:00Z')), false);
  });
}
