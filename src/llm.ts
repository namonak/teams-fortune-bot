import { ANIMALS, seeded, type DayFacts } from './domain.js';
import { BIRTHDAY, EXTRAS, LINES, NEWS } from './templates.js';

export type DayTexts = { rows: { line: string; extra: string }[]; news: string; birthday: string | null };
export type LlmEnv = { OPENROUTER_API_KEY?: string; OPENROUTER_MODEL?: string; OPENROUTER_REASONING_EFFORT?: string; OPENROUTER_BASE_URL?: string };

const WEEKDAYS = '일월화수목금토';

const birthdayKind = (facts: DayFacts) => !facts.birthday ? '없음' : facts.birthday.today.length ? '당일' : '미리 축하';

// 설계 문서 5.3절 가드레일입니다.
const SYSTEM = `당신은 팀 단체방에 아침마다 띠별 운세 쪽지를 두고 가는 부엉이 「쓱부엉」입니다.
말수가 적고 낯을 가리며, 칭찬받으면 날개로 얼굴을 가리고 숨는 내성적인 성격입니다. 밤새 별을 보느라 아침엔 조금 졸립니다.
규칙:
- 짧은 존댓말과 말줄임표(…)로 씁니다. 크게 부르거나 느낌표를 남발하지 않습니다.
- 소재는 회의, 점심, 칼퇴, 메신저, 회의실 같은 회사 생활입니다.
- 저주와 불길한 예언, 건강·투자·연애 조언, 특정인 비하는 쓰지 않습니다.
- 별점 1(충)인 띠도 「쉬어 가는 날」처럼 가볍게 씁니다.
- 생일 문장은 이름을 쓰지 않고, 별점을 바꿨다는 식의 표현을 쓰지 않습니다. 미리 축하하는 날에는 「오늘 생일」이라고 쓰지 않습니다.
- 다른 봇(냠요정, 쿠웨이트박, 투표곰, 장부장)은 extra나 news에서 하루 1~2번만 언급합니다.
  쿠웨이트박은 자꾸 판에 끌어들이려 해서 곤란하고, 냠요정은 가끔 간식을 주고, 투표곰과는 말없이 같이 앉아 있는 사이이고, 장부장에게는 「운세는 비용 처리가 안 됩니다」라는 말을 들었습니다.
- 새해 첫 업무일 힌트가 있으면 2027년은 정미년, 양띠 해입니다.
- 마크다운 문자(*, _, [, ], <, >)를 쓰지 않습니다.
- line은 40자 이하, extra·news·birthday는 60자 이하로 씁니다. 빈 문자열은 안 됩니다.
- rows는 쥐, 소, 호랑이, 토끼, 용, 뱀, 말, 양, 원숭이, 닭, 개, 돼지 순서로 정확히 12개입니다.
- news는 쓱부엉 근황 한 줄입니다. 최근 근황과 겹치지 않게 씁니다.
- 생일 쪽지 종류가 없음이면 birthday를 빼고, 있으면 이름 없이 쓰는 축하 한 줄을 birthday에 넣습니다.
JSON 하나만 답합니다: {"rows":[{"animal":"쥐","line":"한 줄 운세","extra":"펼친 내용의 한 줄"}],"news":"근황 한 줄","birthday":"생일 축하 한 줄"}`;

// 설계 문서 5.2절 입력입니다. 이름, 생일 날짜, 생일 인원 수는 넣지 않습니다.
export function buildPrompt(facts: DayFacts, recentNews: string[]) {
  const rows = facts.rows.map((r) =>
    `- ${ANIMALS[r.animal]}: 관계 ${r.relation}, 별점 ${r.stars}, 회의운 ${r.meeting}, 점심운 ${r.lunch}, 칼퇴운 ${r.leave}`);
  const user = [
    `날짜: ${facts.date} (${WEEKDAYS[facts.weekday]}요일)`,
    `특별한 날 힌트: ${facts.hint ?? '없음'}`,
    `일진: ${facts.ganji}일`,
    '띠별 운세 값:', ...rows,
    `최근 근황(반복 금지): ${recentNews.length ? recentNews.join(' / ') : '없음'}`,
    `생일 쪽지 종류: ${birthdayKind(facts)}`,
  ].join('\n');
  return { system: SYSTEM, user };
}

// TextBlock이 마크다운 목록·제목으로 그리지 않도록 마크다운 문자를 지우고, 줄바꿈·연속 공백을 하나로 합친 뒤 문장 앞의 목록·제목 표시(-, +, #, >, 1.)를 지웁니다.
const clean = (s: unknown) => typeof s === 'string'
  ? s.replace(/[*_[\]<>]/g, '').replace(/\s+/g, ' ').trim().replace(/^(?:(?:[-+#>]+|\d+\.)(?: |$))+/, '').trim()
  : '';
const fits = (s: string, max: number) => s.length > 0 && [...s].length <= max;

// 하나라도 어긋나면 전체를 버립니다(설계 문서 5.2절).
export function validateTexts(raw: unknown, wantBirthday: boolean): DayTexts | null {
  const o = raw as { rows?: unknown; news?: unknown; birthday?: unknown } | null;
  if (!o || typeof o !== 'object' || !Array.isArray(o.rows) || o.rows.length !== ANIMALS.length) return null;
  const rows: DayTexts['rows'] = [];
  for (const [i, r] of o.rows.entries()) {
    if (r?.animal !== ANIMALS[i]) return null;
    const line = clean(r.line), extra = clean(r.extra);
    if (!fits(line, 40) || !fits(extra, 60)) return null;
    rows.push({ line, extra });
  }
  const news = clean(o.news), birthday = wantBirthday ? clean(o.birthday) : null;
  if (!fits(news, 60) || (birthday !== null && !fits(birthday, 60))) return null;
  return { rows, news, birthday };
}

const pick = <T>(list: readonly T[], key: string) => list[seeded(key, 0, list.length - 1)];

const BOTS = /냠요정|쿠웨이트박|투표곰|장부장/;

export function templateTexts(facts: DayFacts): DayTexts {
  const d = facts.date;
  // 다른 봇 언급은 news, 쥐~돼지 extra 순서로 2번까지만 두고, 넘으면 언급 없는 문장으로 바꿉니다(설계 문서 5.3절).
  let mentions = 0;
  const choose = (list: readonly string[], key: string) => {
    const s = pick(list, key);
    if (!BOTS.test(s)) return s;
    if (++mentions <= 2) return s;
    return pick(list.filter((t) => !BOTS.test(t)), key);
  };
  const news = choose(NEWS, `${d}:news`);
  const rows = facts.rows.map((r) => {
    const s = r.stars as keyof typeof LINES;
    return { line: pick(LINES[s], `${d}:${r.animal}:line`), extra: choose(EXTRAS[s], `${d}:${r.animal}:extra`) };
  });
  return { rows, news, birthday: facts.birthday ? pick(BIRTHDAY, `${d}:birthday`) : null };
}

function schema(wantBirthday: boolean) {
  const str = { type: 'string' };
  return {
    type: 'json_schema',
    json_schema: {
      name: 'day_texts', strict: true,
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          rows: {
            type: 'array', minItems: 12, maxItems: 12,
            items: { type: 'object', additionalProperties: false, properties: { animal: { type: 'string', enum: ANIMALS }, line: str, extra: str }, required: ['animal', 'line', 'extra'] },
          },
          news: str,
          ...(wantBirthday ? { birthday: str } : {}),
        },
        required: wantBirthday ? ['rows', 'news', 'birthday'] : ['rows', 'news'],
      },
    },
  };
}

async function callLlm(facts: DayFacts, recentNews: string[], env: LlmEnv, fetchImpl: typeof fetch): Promise<DayTexts | string> {
  const { system, user } = buildPrompt(facts, recentNews);
  const wantBirthday = facts.birthday !== null;
  // OpenRouter의 OpenAI 호환 API로 Gemini를 부릅니다. .env 값의 앞뒤 공백은 지웁니다.
  const base = (env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  try {
    const res = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENROUTER_API_KEY!.trim()}` },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL?.trim() || 'google/gemini-3.6-flash',
        reasoning_effort: env.OPENROUTER_REASONING_EFFORT?.trim() || 'low',
        response_format: schema(wantBirthday),
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return `HTTP 오류 ${res.status}`;
    const body = await res.json() as { choices?: { message?: { content?: string } }[] };
    let parsed: unknown;
    try { parsed = JSON.parse(body.choices?.[0]?.message?.content ?? ''); } catch { return '형식 오류(JSON 아님)'; }
    return validateTexts(parsed, wantBirthday) ?? '형식 오류(검증 실패)';
  } catch (e) {
    return (e as Error).name === 'TimeoutError' ? '시간 초과' : `요청 실패(${(e as Error).name})`;
  }
}

export async function generateTexts(facts: DayFacts, recentNews: string[], env: LlmEnv, fetchImpl: typeof fetch = fetch): Promise<{ texts: DayTexts; source: 'llm' | 'template'; reason?: string }> {
  const r = env.OPENROUTER_API_KEY?.trim() ? await callLlm(facts, recentNews, env, fetchImpl) : 'OPENROUTER_API_KEY 없음';
  if (typeof r !== 'string') return { texts: r, source: 'llm' };
  // 응답 본문과 키는 로그에 넣지 않습니다.
  console.warn('[llm] 템플릿 사용:', r);
  return { texts: templateTexts(facts), source: 'template', reason: r };
}
