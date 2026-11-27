import { CardFactory, type CloudAdapter } from '@microsoft/agents-hosting';
import { isBusinessDay, kstParts, parseBirthdays } from './calendar.js';
import { buildFortuneCard } from './cards.js';
import { buildDayFacts } from './domain.js';
import { generateTexts } from './llm.js';
import type { Store, StoredFortune } from './store.js';

export type FortuneDeps = { env: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; iconUrl: string };

// 업무일 09:00~09:59(한국 시간). 재시작으로 9시를 놓쳐도 10시 전이면 보낸다
export function isSendWindow(now: Date) {
  const { date, time } = kstParts(now);
  return isBusinessDay(date) && time >= '09:00' && time < '10:00';
}

// 같은 날짜의 운세 생성이 겹치지 않도록 진행 중인 생성을 대화방 저장소별로 보관한다
const generating = new WeakMap<Store, Map<string, Promise<StoredFortune>>>();

export function ensureFortune(store: Store, date: string, deps: FortuneDeps): Promise<StoredFortune> {
  const saved = store.getFortune(date);
  if (saved) return Promise.resolve(saved);
  const inFlight = generating.get(store) ?? new Map<string, Promise<StoredFortune>>();
  generating.set(store, inFlight);
  let p = inFlight.get(date);
  if (!p) {
    p = (async () => {
      const facts = buildDayFacts(date, parseBirthdays(deps.env.BIRTHDAYS));
      const { texts, source } = await generateTexts(facts, store.recentNews(date), deps.env, deps.fetchImpl);
      store.saveFortune({ date, facts, texts, source });
      // 먼저 저장된 운세가 있으면 그쪽을 쓴다
      return store.getFortune(date)!;
    })().finally(() => inFlight.delete(date));
    inFlight.set(date, p);
  }
  return p;
}

export async function runScheduledTasks(adapter: Pick<CloudAdapter, 'continueConversation'>, appId: string, store: Store, deps: FortuneDeps, now = new Date()) {
  if (!isSendWindow(now)) return;
  const { date } = kstParts(now);
  let fortune = store.getFortune(date);
  if (!fortune) {
    // 다른 주기가 생성 중이면 이번 주기는 건너뛴다
    if (generating.get(store)?.has(date)) return;
    fortune = await ensureFortune(store, date, deps);
  }
  const card = CardFactory.adaptiveCard(buildFortuneCard(fortune.facts, fortune.texts, deps.iconUrl));
  for (const { id, reference } of store.conversationReferences()) {
    if (!store.claimDelivery(id, date, now)) continue;
    try {
      // continueConversation은 logic 안 예외를 onTurnError로 넘기고 정상 종료하므로 안에서 잡아 밖에서 다시 던진다
      let messageId: string | undefined, error: unknown;
      await adapter.continueConversation(appId, reference, async (context) => {
        try { messageId = (await context.sendActivity({ type: 'message', attachments: [card] } as never))?.id; } catch (e) { error = e; }
      });
      if (error) throw error;
      if (!messageId) throw new Error('발송 응답에 메시지 id가 없습니다');
      store.setDeliveryMessage(id, date, messageId);
    } catch (error) {
      store.releaseDelivery(id, date);
      console.error('[발송] 운세 카드 발송 실패:', id, error);
    }
  }
}
