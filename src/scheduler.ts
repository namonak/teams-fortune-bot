import { CardFactory, type CloudAdapter } from '@microsoft/agents-hosting';
import { isBusinessDay, kstParts, parseBirthdays } from './calendar.js';
import { buildFortuneCard } from './cards.js';
import { buildDayFacts } from './domain.js';
import { generateTexts } from './llm.js';
import { DEFAULT_SEND_TIME, type Store, type StoredFortune } from './store.js';

export type FortuneDeps = { env: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; iconUrl: string };

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// 업무일에 대화방 발송 시각부터 1시간 안(한국 시간). 재시작으로 발송 시각을 놓쳐도 1시간 안이면 보낸다
export function isSendWindow(now: Date, sendTime = DEFAULT_SEND_TIME) {
  const { date, time } = kstParts(now);
  const late = minutes(time) - minutes(sendTime);
  return late >= 0 && late < 60 && isBusinessDay(date);
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

// 진행 중인 발송(대화방 id + 날짜)을 저장소 객체별로 보관한다
// ponytail: 컨테이너 하나에 프로세스 하나로 도는 전제다. 프로세스가 둘 이상이 되면 delivery 테이블에 발송 소유자 표시를 두어 claim과 release를 묶는다
const sendingByStore = new WeakMap<Store, Set<string>>();

export async function runScheduledTasks(adapter: Pick<CloudAdapter, 'continueConversation'>, appId: string, store: Store, deps: FortuneDeps, now = new Date()) {
  const due = store.conversationReferences().filter((c) => isSendWindow(now, c.sendTime));
  if (!due.length) return;
  const { date } = kstParts(now);
  let fortune = store.getFortune(date);
  if (!fortune) {
    // 다른 주기가 생성 중이면 이번 주기는 건너뛴다
    if (generating.get(store)?.has(date)) return;
    fortune = await ensureFortune(store, date, deps);
  }
  const card = CardFactory.adaptiveCard(buildFortuneCard(fortune.facts, fortune.texts, deps.iconUrl));
  const sending = sendingByStore.get(store) ?? new Set<string>();
  sendingByStore.set(store, sending);
  for (const { id, reference } of due) {
    // 앞 주기의 발송이 아직 끝나지 않은 대화방은 claim하지 않는다(늦은 응답 중 5분 재확보로 두 번 나가는 것을 막는다)
    const key = `${id}\n${date}`;
    // 앞 대화방 발송을 기다리는 사이 시각이 바뀌었을 수 있어 저장된 시각을 다시 확인한다
    if (!isSendWindow(now, store.sendTime(id)) || sending.has(key) || !store.claimDelivery(id, date, now)) continue;
    sending.add(key);
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
    } finally {
      sending.delete(key);
    }
  }
}
