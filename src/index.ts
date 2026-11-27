import express from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ActivityHandler, CardFactory, CloudAdapter, MessageFactory, authorizeJWT, getAuthConfigWithDefaults, type AuthConfiguration, type TurnContext } from '@microsoft/agents-hosting';
import { kstParts } from './calendar.js';
import { NOT_YET_TEXT, TIME_FORMAT_TEXT, buildFortuneCard, greetingText, helpText, timeSetText, timeShowText } from './cards.js';
import { runScheduledTasks, type FortuneDeps } from './scheduler.js';
import { Store } from './store.js';

const TODAY_COMMANDS = new Set(['', '오늘', '오늘운세']);

export type Command = { kind: 'today' | 'help' | 'showTime' | 'badTime' } | { kind: 'setTime'; time: string };

// 'H:MM'·'HH:MM'을 'HH:MM'으로 바꾼다. 07:00~18:00 밖이면 null
export function parseSendTime(arg: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(arg);
  if (!m || Number(m[2]) > 59) return null;
  const time = `${m[1].padStart(2, '0')}:${m[2]}`;
  return time >= '07:00' && time <= '18:00' ? time : null;
}

export function parseCommand(text: string): Command {
  const t = text.trim();
  const time = /^시간(?:\s+(.*))?$/.exec(t);
  if (time) {
    if (!time[1]?.trim()) return { kind: 'showTime' };
    const value = parseSendTime(time[1].trim());
    return value ? { kind: 'setTime', time: value } : { kind: 'badTime' };
  }
  return { kind: TODAY_COMMANDS.has(t.replace(/\s+/g, '')) ? 'today' : 'help' };
}

// 멘션 응답은 저장본만 쓰고 LLM을 새로 부르지 않는다
export function mentionReply(store: Store, conversationId: string, text: string, now: Date, iconUrl: string, who = ''): { card: Record<string, unknown> } | { text: string } {
  const command = parseCommand(text);
  switch (command.kind) {
    case 'help': return { text: helpText(store.sendTime(conversationId)) };
    case 'showTime': return { text: timeShowText(store.sendTime(conversationId)) };
    case 'badTime': return { text: TIME_FORMAT_TEXT };
    case 'setTime':
      store.setSendTime(conversationId, command.time);
      // 표시 이름은 마크다운으로 해석되지 않게 기호를 지운다
      return { text: timeSetText(command.time, who.replace(/[*_`[\]<>]/g, '').trim()) };
  }
  const fortune = store.getFortune(kstParts(now).date);
  return fortune ? { card: buildFortuneCard(fortune.facts, fortune.texts, iconUrl) } : { text: NOT_YET_TEXT };
}

// 30초 주기 호출부. 실패해도 프로세스를 멈추지 않고 다음 주기에 다시 시도한다
export async function runScheduledTick(adapter: Pick<CloudAdapter, 'continueConversation'>, appId: string, store: Store, deps: FortuneDeps, now = new Date()) {
  try {
    await runScheduledTasks(adapter, appId, store, deps, now);
  } catch (error) {
    console.error('[정기 발송] 이번 주기 실행 실패, 다음 주기에 다시 시도합니다:', error);
  }
}

export class FortuneBot extends ActivityHandler {
  constructor(private store: Store, private iconUrl: string) {
    super();
    // 봇 자신이 추가되면 설치로 보고 대화방을 저장한 뒤 한 번 인사한다
    this.onMembersAdded(async (context, next) => {
      if (context.activity.membersAdded?.some((m) => m.id === context.activity.recipient?.id) && this.remember(context))
        await context.sendActivity(MessageFactory.text(greetingText(this.store.sendTime(context.activity.conversation!.id))));
      await next();
    });
    this.onMessage(async (context, next) => {
      this.remember(context);
      context.activity.removeRecipientMention();
      const reply = mentionReply(this.store, context.activity.conversation?.id ?? '', context.activity.text ?? '', new Date(), this.iconUrl, context.activity.from?.name ?? '');
      await context.sendActivity('card' in reply
        ? MessageFactory.attachment(CardFactory.adaptiveCard(reply.card))
        : { type: 'message', text: reply.text, textFormat: 'markdown' } as never);
      await next();
    });
  }
  private remember(context: TurnContext) {
    const id = context.activity.conversation?.id;
    if (id) this.store.activateConversation(id, context.activity.getConversationReference());
    return Boolean(id);
  }
}

export const TURN_ERROR_TEXT = '…잠깐 문제가 생겼어요… 조금 뒤에 다시 불러 주세요. 🦉💨';

// SDK 기본 처리기는 오류 문자열을 trace 활동과 영어 문장으로 대화방에 보내므로 바꾼다.
// 상세는 서버 로그에만 남기고 대화방에는 짧은 안내 한 줄만 보낸다
export function createAdapter(auth: AuthConfiguration) {
  const adapter = new CloudAdapter(auth);
  adapter.onTurnError = async (context, error) => {
    console.error('[대화] 요청 처리 실패:', error);
    try { await context.sendActivity(MessageFactory.text(TURN_ERROR_TEXT)); } catch (sendError) { console.error('[대화] 오류 안내 전송 실패:', sendError); }
  };
  return adapter;
}

export function createApp(env: NodeJS.ProcessEnv = process.env) {
  for (const key of ['MicrosoftAppId', 'MicrosoftAppPassword', 'MicrosoftAppTenantId'])
    if (!env[key]?.trim()) throw new Error(`.env에 ${key} 설정이 필요합니다`);
  if (!env.OPENROUTER_API_KEY?.trim()) console.log('OPENROUTER_API_KEY가 없어 템플릿 문장만 씁니다');
  const appId = env.MicrosoftAppId!;
  const auth = getAuthConfigWithDefaults({ clientId: appId, clientSecret: env.MicrosoftAppPassword, tenantId: env.MicrosoftAppTenantId });
  const adapter = createAdapter(auth);
  const store = Store.open(env.DATABASE_PATH ?? './data/team-fortune-bot.sqlite');
  const iconUrl = `${(env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '')}/assets/owl.png`;
  const deps: FortuneDeps = { env, iconUrl };
  const bot = new FortuneBot(store, iconUrl);

  // 종료할 때 진행 중인 발송이 끝난 뒤 저장소를 닫는다
  const running = new Set<Promise<void>>();
  const timer = setInterval(() => {
    const p = runScheduledTick(adapter, appId, store, deps).finally(() => running.delete(p));
    running.add(p);
  }, 30_000);
  timer.unref();

  const app = express();
  app.locals.dispose = async () => { clearInterval(timer); await Promise.all(running); store.close(); };
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  // src/와 dist/ 어디서 실행해도 저장소 루트의 assets를 가리킨다
  app.use('/assets', express.static(fileURLToPath(new URL('../assets', import.meta.url))));
  app.post('/api/messages', authorizeJWT(auth), express.json({ limit: '64kb' }), async (req, res) => { await adapter.process(req, res, (context) => bot.run(context)); });
  app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error.status === 413 ? 413 : error.status === 400 ? 400 : 500;
    res.status(status).json({ error: '요청을 처리하지 못했습니다.' });
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createApp();
  const port = Number(process.env.PORT ?? 3978);
  const server = app.listen(port, () => console.log(`쓱부엉이 ${port}번 포트에서 기다려요… 🦉💨`));
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => server.close(() => { void app.locals.dispose().then(() => process.exit(0)); }));
}
