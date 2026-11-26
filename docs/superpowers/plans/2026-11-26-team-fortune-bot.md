# 쓱부엉 Teams 운세 봇 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 평일 09:00 KST에 Teams 단체방마다 12띠 운세 카드 한 장을 보내는 봇 `쓱부엉`을 만듭니다.

**Architecture:** 냠요정(`../team-meal-bot`)과 같은 구조입니다. 순수 계산(`domain.ts`, `calendar.ts`), 문장 생성(`llm.ts`, `templates.ts`), 카드(`cards.ts`), 저장(`store.ts`), 발송 주기(`scheduler.ts`), 서버(`index.ts`)로 나눕니다. 운세는 날짜별로 한 번 만들어 SQLite에 저장하고, 모든 대화방과 멘션 재요청에 같은 저장본을 씁니다.

**Tech Stack:** Node 24, TypeScript 5.8, Express 5, `@microsoft/agents-hosting` ^1.10.2, `node:sqlite`, `node:crypto`, `node:test` + `tsx`, Docker Compose, Gemini API(OpenAI 호환 엔드포인트, `fetch`).

**Spec:** `docs/superpowers/specs/2026-11-26-team-fortune-bot-design.md`. 카드 시안은 `docs/superpowers/specs/mockup/index.html`입니다.

## Global Constraints

- 런타임 의존성은 `@microsoft/agents-hosting`, `express` 두 개뿐입니다. 일진 라이브러리, `openai` 패키지를 추가하지 않습니다.
- `package.json` `overrides`: `"body-parser": "2.4.0"`, `"proxy-addr": "2.0.8"`. `engines.node`: `">=24"`.
- 날짜와 시각은 항상 `Asia/Seoul` 기준이며 날짜 문자열 형식은 `YYYY-MM-DD`입니다. 서버 시간대에 의존하지 않습니다.
- 띠 번호: 0 쥐, 1 소, 2 호랑이, 3 토끼, 4 용, 5 뱀, 6 말, 7 양, 8 원숭이, 9 닭, 10 개, 11 돼지.
- 이름, 생일, 생일 인원 수는 LLM 요청에 넣지 않습니다. 실제 팀원 이름과 생일은 저장소(코드, 테스트, 문서)에 쓰지 않고 `홍길동`, `김철수` 같은 예시만 씁니다.
- 카드에 들어가는 LLM 문장에서 `*`, `_`, `[`, `]`, `<`, `>`를 제거합니다.
- 길이 제한: `line` 40자, `extra`·`news`·`birthday` 60자(`[...s].length` 기준).
- 컨테이너·이미지·서비스 `team-fortune-bot`, 호스트 바인딩 `127.0.0.1:3981:3978`, 볼륨 `fortune-data`, DB `/data/team-fortune-bot.sqlite`(개발 `./data/team-fortune-bot.sqlite`), 도메인 `fortune-bot.namonak.dev`.
- 환경 변수: `MicrosoftAppId`, `MicrosoftAppPassword`, `MicrosoftAppTenantId`(셋 중 하나라도 없으면 시작 거부), `PUBLIC_BASE_URL`, `DATABASE_PATH`, `PORT`, `GEMINI_API_KEY`, `GEMINI_MODEL`(기본 `gemini-3.6-flash`), `GEMINI_REASONING_EFFORT`(기본 `low`), `GEMINI_BASE_URL`(기본 `https://generativelanguage.googleapis.com/v1beta/openai/`), `BIRTHDAYS`.
- 말투: 짧은 존댓말, 말줄임표(…), 맺음 「(쓱)」. 코드 주석과 로그는 한국어로 씁니다.
- 커밋: `type(범위): 한글 제목`, 본문은 `- ~한다` 목록, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **DB 폴더가 없는 첫 실행:** `./data`가 없어도 `Store.open`이 상위 폴더를 만들고 열립니다. (Task 5 테스트)
2. **서버 시간대가 UTC인 컨테이너:** `2026-11-27T00:00:30Z`(09:00 KST)에는 발송하고 `2026-11-26T23:59:00Z`(08:59 KST)에는 발송하지 않습니다. (Task 7 테스트)
3. **`BIRTHDAYS` 입력 오염:** 공백, 줄 끝 `\r`, 빈 항목, `13-40` 같은 날짜, 콜론 없는 항목이 섞여도 올바른 항목만 읽고 시작합니다. (Task 2 테스트)
4. **LLM이 띠 순서를 바꾸거나 이름을 틀리게 준 응답:** 12개라도 `animal`이 쥐~돼지 순서와 다르면 전체를 템플릿으로 바꿉니다. (Task 4 테스트)
5. **대화방이 둘 이상이고 9시 정각에 실행 주기가 겹칠 때:** LLM 호출은 그날 한 번뿐이고 대화방마다 카드가 한 번씩 갑니다. (Task 7 테스트)

---

### Task 1: 개발 환경과 일진·띠 관계

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`(쿠웨이트박 파일 내용과 같음, 이름만 `team-fortune-bot`)
- Create: `src/domain.ts`
- Test: `test/domain.test.ts`

**Interfaces:**
- Produces:
  - `ANIMALS: readonly ['쥐','소','호랑이','토끼','용','뱀','말','양','원숭이','닭','개','돼지']`
  - `type Relation = '충' | '육합' | '삼합' | '형·해' | '오늘의 띠' | '보통'`
  - `STARS: Record<Relation, number>` = 충 1, 육합 5, 삼합 4, 형·해 2, 오늘의 띠 3, 보통 3
  - `dayGanji(date: string): { name: string; branch: number }` (예: `{ name: '을사', branch: 5 }`)
  - `yearGanji(year: number): { name: string; branch: number }`
  - `relation(dayBranch: number, animal: number): Relation`

- [ ] **Step 1: `package.json` 작성 후 `npm install`**

스크립트는 쿠웨이트박과 같습니다: `test` = `node --import tsx --test test/*.test.ts`, `typecheck` = `tsc --noEmit`, `build` = `tsc --outDir dist --rootDir src -p tsconfig.build.json`, `start` = `tsx src/index.ts`. `card:preview` = `tsx scripts/preview-card.ts`(Task 6에서 만듦).

Run: `npm install && npm audit --omit=dev --audit-level=moderate`
Expected: `found 0 vulnerabilities`

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
test('일진 검증값', () => {
  assert.deepEqual(dayGanji('2000-01-01'), { name: '무오', branch: 6 });
  assert.deepEqual(dayGanji('2026-11-26'), { name: '갑진', branch: 4 });
  assert.deepEqual(dayGanji('2026-11-27'), { name: '을사', branch: 5 });
  assert.deepEqual(dayGanji('2026-12-11'), { name: '기미', branch: 7 });
  assert.deepEqual(dayGanji('2024-02-29'), { name: '계해', branch: 11 });
  assert.deepEqual(dayGanji('2026-12-31'), { name: '기묘', branch: 3 });
  assert.deepEqual(dayGanji('2027-01-01'), { name: '경진', branch: 4 });
  assert.equal(yearGanji(2027).name, '정미');
  assert.equal(yearGanji(2026).name, '병오');
});
test('을사일과 기미일의 12띠 별점', () => {
  const stars = (d: number) => ANIMALS.map((_, a) => STARS[relation(d, a)]);
  assert.deepEqual(stars(5), [3,4,2,3,3,3,3,3,5,4,3,1]);
  assert.deepEqual(stars(7), [2,1,3,4,3,3,5,3,3,3,2,4]);
  assert.equal(relation(5, 5), '오늘의 띠');
  assert.equal(relation(7, 7), '오늘의 띠');
});
test('겹치는 관계의 우선순위', () => {
  assert.equal(relation(5, 8), '육합');   // 뱀·원숭이: 육합이면서 형
  assert.equal(relation(1, 7), '충');     // 소·양: 충이면서 형
  assert.equal(relation(2, 8), '충');     // 호랑이·원숭이: 충이면서 형
  assert.equal(relation(2, 5), '형·해');  // 호랑이·뱀: 형이면서 해
  assert.equal(relation(4, 4), '형·해');  // 용날의 용띠: 자형
  assert.equal(relation(0, 0), '오늘의 띠');
});
test('매일 충 1띠, 육합 1띠', () => {
  for (let d = 0; d < 12; d++) {
    const r = ANIMALS.map((_, a) => relation(d, a));
    assert.equal(r.filter((x) => x === '충').length, 1);
    assert.equal(r.filter((x) => x === '육합').length, 1);
  }
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL (`domain.js` 없음)

- [ ] **Step 4: `src/domain.ts` 구현**

일진 번호는 `(율리우스 적일 + 49) % 60`, 천간 `갑을병정무기경신임계`, 지지 `자축인묘진사오미신유술해`. 연간지는 `(year - 4) % 60`. 관계표와 우선순위는 설계 문서 4.2절 그대로이며, 같은 띠끼리는 육합·삼합으로 보지 않습니다.

- [ ] **Step 5: 테스트와 타입 검사 통과 확인**

Run: `npm test && npm run typecheck`
Expected: PASS, 오류 없음

- [ ] **Step 6: 커밋**

`git add package.json package-lock.json tsconfig*.json src/domain.ts test/domain.test.ts` 후 커밋: `feat(운세): 일진과 띠 관계로 별점을 계산`

---

### Task 2: 달력, 생일, 하루 운세 값

**Files:**
- Create: `src/holidays.ts`(`../team-meal-bot/src/holidays.ts` 그대로 복사)
- Create: `src/calendar.ts`
- Modify: `src/domain.ts`(세부 운세, 행운 항목, `buildDayFacts` 추가)
- Test: `test/calendar.test.ts`, `test/domain.test.ts`

**Interfaces:**
- Consumes: Task 1의 `dayGanji`, `relation`, `STARS`, `ANIMALS`
- Produces (`calendar.ts`):
  - `kstParts(now: Date): { date: string; time: string; weekday: number }` (weekday 0=일 … 6=토, time `HH:MM`)
  - `addDays(date: string, n: number): string`
  - `isBusinessDay(date: string): boolean`
  - `nextBusinessDay(date: string): string`
  - `type DayHint = '새해 첫 업무일' | '올해 마지막 업무일' | '연휴 다음 날' | '월요일' | '금요일'`
  - `dayHint(date: string): DayHint | null` (위 순서가 우선순위. 연휴 다음 날 = 전날이 `holidays.ts` 공휴일인 업무일)
  - `type Birthday = { name: string; monthDay: string }`
  - `parseBirthdays(raw: string | undefined): Birthday[]`
  - `type BirthdayFacts = { today: string[]; ahead: string[]; when: '내일은' | '주말에' | '연휴에' | null }`
  - `birthdaysFor(date: string, list: Birthday[]): BirthdayFacts | null`
- Produces (`domain.ts`):
  - `type RowFacts = { animal: number; relation: Relation; stars: number; meeting: number; lunch: number; leave: number; menu: string; color: string }`
  - `type DayFacts = { date: string; weekday: number; ganji: string; dayBranch: number; rows: RowFacts[]; best: number; rest: number; hint: DayHint | null; birthday: BirthdayFacts | null }`
  - `seeded(key: string, min: number, max: number): number` (`sha256` 앞 4바이트로 정수 선택)
  - `MENUS: readonly string[]`(30개), `COLORS: readonly string[]`(12개)
  - `buildDayFacts(date: string, birthdays: Birthday[]): DayFacts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('업무일과 날짜 힌트', () => {
  assert.equal(isBusinessDay('2026-11-28'), false);          // 토
  assert.equal(isBusinessDay('2026-12-25'), false);          // 공휴일
  assert.equal(nextBusinessDay('2026-12-11'), '2026-12-14');
  assert.equal(dayHint('2026-11-27'), '금요일');
  assert.equal(dayHint('2026-11-30'), '월요일');
  assert.equal(dayHint('2026-12-31'), '올해 마지막 업무일');
  assert.equal(dayHint('2027-01-04'), '새해 첫 업무일');
  assert.equal(dayHint('2026-12-28'), '연휴 다음 날');        // 12-25 금 공휴일 뒤 월요일
  assert.equal(dayHint('2026-11-26'), null);
});
test('KST 변환은 서버 시간대와 무관', () => {
  assert.deepEqual(kstParts(new Date('2026-11-27T00:00:30Z')), { date: '2026-11-27', time: '09:00', weekday: 5 });
});
test('BIRTHDAYS 파싱은 잘못된 항목을 건너뜀', () => {
  assert.deepEqual(parseBirthdays(' 홍길동:12-12 , 김철수:02-29\r,,이상:13-40,콜론없음, 박영희:7-5'),
    [{ name: '홍길동', monthDay: '12-12' }, { name: '김철수', monthDay: '02-29' }]);
  assert.deepEqual(parseBirthdays(undefined), []);
});
test('생일 대상', () => {
  const list = [{ name: '홍길동', monthDay: '12-12' }, { name: '김철수', monthDay: '12-13' }, { name: '이영희', monthDay: '11-27' }];
  assert.deepEqual(birthdaysFor('2026-12-11', list), { today: [], ahead: ['홍길동', '김철수'], when: '주말에' });
  assert.deepEqual(birthdaysFor('2026-11-27', list), { today: ['이영희'], ahead: [], when: null });
  assert.deepEqual(birthdaysFor('2026-12-24', [{ name: '홍길동', monthDay: '12-25' }]), { today: [], ahead: ['홍길동'], when: '내일은' });
  assert.equal(birthdaysFor('2026-11-26', list), null);
  assert.deepEqual(birthdaysFor('2026-12-11', [{ name: '홍길동', monthDay: '12-12' }]), { today: [], ahead: ['홍길동'], when: '내일은' });
  assert.deepEqual(birthdaysFor('2027-02-26', [{ name: '김철수', monthDay: '02-29' }]), { today: [], ahead: ['김철수'], when: '주말에' }); // 평년이라 2/28(일)
});
test('하루 운세 값', () => {
  const f = buildDayFacts('2026-11-27', []);
  assert.equal(f.ganji, '을사');
  assert.deepEqual(f.rows.map((r) => r.stars), [3,4,2,3,3,3,3,3,5,4,3,1]);
  assert.equal(f.best, 8); assert.equal(f.rest, 11);
  assert.deepEqual(buildDayFacts('2026-11-27', []), f);                 // 같은 날 같은 값
  for (const r of f.rows) for (const v of [r.meeting, r.lunch, r.leave]) assert.ok(v >= 1 && v <= 5);
  assert.ok(f.rows.every((r) => MENUS.includes(r.menu) && COLORS.includes(r.color)));
  assert.equal(f.hint, '금요일');
});
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `npm test`, Expected: FAIL

- [ ] **Step 3: 구현**

`ahead`는 다음 날부터 `nextBusinessDay(date)` 전날까지가 생일인 사람입니다. `when` 규칙: `ahead`가 비면 `null`. `ahead`의 생일이 모두 다음 날이면 `'내일은'`, 그렇지 않고 걸치는 날이 모두 토·일이면 `'주말에'`, 그 밖은 `'연휴에'`. 2월 29일 생일은 평년에 `02-28`로 봅니다. 세부 운세는 `clamp(stars + seeded(`${date}:${animal}:${항목}`, -2, 2), 1, 5)`, 금요일에는 칼퇴운 +1(최대 5). 메뉴·색은 `seeded(`${date}:${animal}:menu`, 0, MENUS.length - 1)`. `best`는 육합 띠, `rest`는 충 띠입니다.

- [ ] **Step 4: 통과 확인** — Run: `npm test && npm run typecheck`, Expected: PASS

- [ ] **Step 5: 커밋** — `feat(운세): 업무일·생일 대상과 하루 운세 값을 계산`

---

### Task 3: 템플릿 문장

**Files:**
- Create: `src/templates.ts`
- Test: `test/templates.test.ts`

설계 문서는 템플릿을 `llm.ts`에 둔다고 적었지만, 문장 100개 이상이 섞이면 호출 코드를 읽기 어려워 파일을 나눕니다(구현 담당 판단).

**Interfaces:**
- Produces:
  - `LINES: Record<1|2|3|4|5, readonly string[]>`(각 10개 이상), `EXTRAS: Record<1|2|3|4|5, readonly string[]>`(각 10개 이상), `NEWS: readonly string[]`(20개 이상), `BIRTHDAY: readonly string[]`(5개 이상)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('템플릿 개수와 형식', () => {
  for (const s of [1,2,3,4,5] as const) { assert.ok(LINES[s].length >= 10); assert.ok(EXTRAS[s].length >= 10); }
  assert.ok(NEWS.length >= 20); assert.ok(BIRTHDAY.length >= 5);
  const all = [...Object.values(LINES).flat(), ...Object.values(EXTRAS).flat(), ...NEWS, ...BIRTHDAY];
  for (const t of all) { assert.doesNotMatch(t, /[*_\[\]<>{}]/); assert.match(t, /…/); }
  for (const t of Object.values(LINES).flat()) assert.ok([...t].length <= 40);
  for (const t of [...Object.values(EXTRAS).flat(), ...NEWS, ...BIRTHDAY]) assert.ok([...t].length <= 60);
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test`, Expected: FAIL

- [ ] **Step 3: 문장 작성**

설계 문서 5.3절 가드레일과 9절 성격을 따릅니다. 시안 문장(`mockup/index.html`의 `rows`)을 별점별 첫 문장으로 씁니다. 생일 문장은 이름 없이 쓰고, 별점을 바꿨다는 표현과 「오늘 생일」 표현을 쓰지 않습니다(당일과 미리 축하 모두에 쓰기 때문). 근황 문장은 다른 봇 관계 설정을 소재로 씁니다.

- [ ] **Step 4: 통과 확인** — Run: `npm test`, Expected: PASS

- [ ] **Step 5: 커밋** — `feat(문장): LLM 실패에 대비한 쓱부엉 템플릿 문장을 추가`

---

### Task 4: LLM 호출과 검증

**Files:**
- Create: `src/llm.ts`
- Test: `test/llm.test.ts`

**Interfaces:**
- Consumes: Task 2 `DayFacts`, `ANIMALS`, Task 3 템플릿
- Produces:
  - `type DayTexts = { rows: { line: string; extra: string }[]; news: string; birthday: string | null }`
  - `type LlmEnv = { GEMINI_API_KEY?: string; GEMINI_MODEL?: string; GEMINI_REASONING_EFFORT?: string; GEMINI_BASE_URL?: string }`
  - `buildPrompt(facts: DayFacts, recentNews: string[]): { system: string; user: string }`
  - `validateTexts(raw: unknown, wantBirthday: boolean): DayTexts | null`
  - `templateTexts(facts: DayFacts): DayTexts`(`seeded(date + 항목)`으로 선택)
  - `generateTexts(facts: DayFacts, recentNews: string[], env: LlmEnv, fetchImpl?: typeof fetch): Promise<{ texts: DayTexts; source: 'llm' | 'template'; reason?: string }>`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
const facts = buildDayFacts('2026-12-11', [{ name: '홍길동', monthDay: '12-12' }]);
const ok = { rows: ANIMALS.map((a) => ({ animal: a, line: '좋은 하루…', extra: '천천히…' })), news: '붕어빵…', birthday: '케이크…' };
const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), { status });
test('정상 응답', async () => {
  const r = await generateTexts(facts, [], { GEMINI_API_KEY: 'k' }, reply(ok));
  assert.equal(r.source, 'llm'); assert.equal(r.texts.rows.length, 12); assert.equal(r.texts.birthday, '케이크…');
});
test('프롬프트에 이름·인원 수가 없다', () => {
  const p = buildPrompt(facts, []);
  assert.doesNotMatch(p.system + p.user, /홍길동/);
  assert.match(p.user, /미리 축하/);
});
test('실패는 모두 템플릿', async () => {
  const env = { GEMINI_API_KEY: 'k' };
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
```

- [ ] **Step 2: 실패 확인** — Run: `npm test`, Expected: FAIL

- [ ] **Step 3: 구현**

요청: `POST ${GEMINI_BASE_URL}chat/completions`, 헤더 `Authorization: Bearer ${GEMINI_API_KEY}`, 본문 `{ model, reasoning_effort, response_format, messages: [system, user] }`, `signal: AbortSignal.timeout(60_000)`, 재시도 없음. `response_format`은 구현 전에 [Gemini OpenAI 호환 문서](https://ai.google.dev/gemini-api/docs/openai)에서 `json_schema` 지원을 확인해 쓰고, 지원하지 않으면 `{ type: 'json_object' }`를 씁니다. 어느 쪽이든 `validateTexts`가 최종 판정합니다. `user` 입력은 설계 문서 5.2절 목록(생일 종류는 `없음`/`당일`/`미리 축하`), `system`은 5.3절 가드레일입니다. 템플릿으로 바꿀 때 `console.warn('[llm] 템플릿 사용:', reason)`을 남깁니다(본문·키는 로그에 넣지 않음).

- [ ] **Step 4: 통과 확인** — Run: `npm test && npm run typecheck`, Expected: PASS

- [ ] **Step 5: 실제 호출 1회 확인(키가 있을 때만)**

Run: `GEMINI_API_KEY=... npx tsx -e "import('./src/llm.ts').then(async m=>{const d=await import('./src/domain.ts');const r=await m.generateTexts(d.buildDayFacts('2026-11-27',[]),[],process.env);console.log(r.source,r.reason??'',JSON.stringify(r.texts).length)})"`
Expected: `llm`. 실패하면 `reason`을 보고 `response_format`·모델명을 바로잡습니다. 응답 `usage`의 토큰 수를 기록해 README 비용 절에 씁니다.

- [ ] **Step 6: 커밋** — `feat(문장): Gemini로 운세 문장을 만들고 실패하면 템플릿을 쓴다`

---

### Task 5: 저장소

**Files:**
- Create: `src/store.ts`
- Test: `test/store.test.ts`

**Interfaces:**
- Consumes: Task 2 `DayFacts`, Task 4 `DayTexts`, `templateTexts`(테스트용)
- Produces:
  - `type StoredFortune = { date: string; facts: DayFacts; texts: DayTexts; source: 'llm' | 'template' }`
  - `class Store` — `static open(path: string): Store`(상위 폴더 생성, `:memory:` 허용), `activateConversation(id: string, reference: unknown): void`, `conversationReferences(): { id: string; reference: any }[]`, `getFortune(date: string): StoredFortune | null`, `saveFortune(f: StoredFortune): void`(같은 날짜가 있으면 무시), `recentNews(before: string, n?: number): string[]`(기본 5, 최신순), `claimDelivery(conversationId: string, date: string): boolean`, `setDeliveryMessage(conversationId: string, date: string, messageId: string): void`, `releaseDelivery(conversationId: string, date: string): void`, `close(): void`
- 스키마: 설계 문서 8.4절. `conversation`은 냠요정 `activateConversation`처럼 참조가 `null`이면 기존 값을 유지합니다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
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
```

- [ ] **Step 2~4: 실패 확인 → 구현 → `npm test && npm run typecheck` 통과**

- [ ] **Step 5: 커밋** — `feat(저장소): 대화방·날짜별 운세·발송 기록을 SQLite에 보관`

---

### Task 6: 카드

**Files:**
- Create: `src/cards.ts`, `scripts/preview-card.ts`
- Test: `test/cards.test.ts`

**Interfaces:**
- Consumes: `DayFacts`, `DayTexts`, `ANIMALS`, `yearGanji`
- Produces:
  - `buildFortuneCard(facts: DayFacts, texts: DayTexts, iconUrl: string): Record<string, unknown>`
  - `HELP_TEXT`, `NOT_YET_TEXT = '오늘 쪽지는… 아직이에요… (쓱)'`, `GREETING_TEXT = '저… 평일 아침 9시에 쪽지 두고 갈게요… (쓱)'`

구조와 ID는 시안 `mockup/index.html`의 `card` 객체를 그대로 따릅니다(줄 `row{i}`, 상세 `d{i}`, 펼침 표시 `open{i}`/`close{i}`, 카드 버전 1.5). 시안에서 바뀌는 점은 세 가지입니다.

- 생일 상자: 「생일 쪽지」, 이름 문장, `texts.birthday`. 이름 목록은 `**A**님, **B**님` 형식입니다. `today`가 있으면 `오늘은 {목록} 생일이에요…`, `ahead`가 있으면 `${when} {목록} 생일이 있어요… ${when === '내일은' ? '하루 일찍' : '미리'} 두고 가요…`. 둘 다 있으면 두 문장을 이어 씁니다.
- 메뉴 뒤 「(냠요정한테 말해보세요…)」 고정 문구는 넣지 않습니다(다른 봇 언급은 LLM 문장에서).
- 부제는 `dayHint`에 따라: 금요일 `금요일이에요… 칼퇴운부터 보세요…`, 월요일 `월요일이에요… 주말 잘 보내셨어요…`, 연휴 다음 날 `연휴 잘 보내셨어요…`, 올해 마지막 업무일 `올해 마지막 쪽지예요…`, 새해 첫 업무일 `새해 첫 쪽지예요… ${yearGanji(year).name}년이에요…`, 없음 `저… 두고 갈게요…`. 모두 뒤에 ` 자기 띠를 누르면 펼쳐져요…`를 붙입니다.
- 관계 근거 문구는 시안의 `why` 객체를 일진 띠 이름으로 바꿔 씁니다(예: `양과 짝이 맞는 육합이에요…`).
- 꼬리말: `오늘은 ${ganji}일(${ANIMALS[dayBranch]}날)이에요… 재미로만 봐 주세요…`, `…그럼 이만. (쓱)`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('카드 구조', () => {
  const facts = buildDayFacts('2026-11-27', []); const texts = templateTexts(facts);
  const card = buildFortuneCard(facts, texts, 'https://x/assets/owl.png'); const json = JSON.stringify(card);
  for (let i = 0; i < 12; i++) assert.match(json, new RegExp(`"targetElements":\\["d${i}","open${i}","close${i}"\\]`));
  assert.ok(json.indexOf('"쥐"') < json.indexOf('"돼지"'));
  assert.match(json, /오늘 제일 좋은 띠는 \*\*원숭이\*\*… \*\*돼지\*\*띠는 쉬어 가세요…/);
  assert.match(json, /오늘은 을사일\(뱀날\)이에요/);
  assert.match(json, /금요일이에요… 칼퇴운부터 보세요/);
  assert.doesNotMatch(json, /생일 쪽지/);
});
test('생일 상자와 별점 유지', () => {
  const facts = buildDayFacts('2026-12-11', [{ name: '홍길동', monthDay: '12-12' }, { name: '김철수', monthDay: '12-13' }]);
  const json = JSON.stringify(buildFortuneCard(facts, { ...templateTexts(facts), birthday: '케이크…' }, 'u'));
  assert.match(json, /주말에 \*\*홍길동\*\*님, \*\*김철수\*\*님 생일이 있어요… 미리 두고 가요…/);
  assert.match(json, /케이크…/);
  assert.match(json, /오늘 제일 좋은 띠는 \*\*말\*\*… \*\*소\*\*띠는 쉬어 가세요…/);
});
test('최대 길이 문장에서도 28KB 이하', () => {
  const facts = buildDayFacts('2026-12-11', [{ name: '가'.repeat(10), monthDay: '12-12' }]);
  const texts = { rows: ANIMALS.map(() => ({ line: '가'.repeat(40), extra: '가'.repeat(60) })), news: '가'.repeat(60), birthday: '가'.repeat(60) };
  assert.ok(Buffer.byteLength(JSON.stringify(buildFortuneCard(facts, texts, 'https://fortune-bot.namonak.dev/assets/owl.png'))) < 28 * 1024);
});
```

- [ ] **Step 2~4: 실패 확인 → 구현 → `npm test && npm run typecheck` 통과**

- [ ] **Step 5: 미리보기 스크립트**

`scripts/preview-card.ts [YYYY-MM-DD]`는 템플릿 문장으로 카드 JSON을 `dist/card-YYYY-MM-DD.json`에 씁니다(LLM 호출 없음). 이 JSON은 Teams 실기 확인에서 펼침 동작을 먼저 보는 데 씁니다(Task 9 README 절차).

Run: `npm run card:preview -- 2026-11-27 && node -e "JSON.parse(require('fs').readFileSync('dist/card-2026-11-27.json','utf8'))"`
Expected: 오류 없음

- [ ] **Step 6: 커밋** — `feat(카드): 한 줄형 띠별 운세 카드와 펼쳐보기를 만든다`

---

### Task 7: 하루 운세 준비와 정기 발송

**Files:**
- Create: `src/scheduler.ts`
- Test: `test/scheduler.test.ts`

설계 문서는 `scheduler.ts`에 발송 시각 판정만 둔다고 적었지만, 발송 순서까지 이 파일에 두어 `index.ts` 없이 테스트합니다(구현 담당 판단).

**Interfaces:**
- Consumes: `kstParts`, `isBusinessDay`, `buildDayFacts`, `parseBirthdays`, `generateTexts`, `buildFortuneCard`, `Store`
- Produces:
  - `isSendWindow(now: Date): boolean` (업무일이고 `09:00 <= time < 10:00`)
  - `type FortuneDeps = { env: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; iconUrl: string }`
  - `ensureFortune(store: Store, date: string, deps: FortuneDeps): Promise<StoredFortune>` (같은 날짜 동시 호출은 진행 중인 `Promise` 하나를 공유)
  - `runScheduledTasks(adapter: Pick<CloudAdapter, 'continueConversation'>, appId: string, store: Store, deps: FortuneDeps, now?: Date): Promise<void>`

순서는 설계 문서 8.1절입니다. 대화방마다 `claimDelivery` → `continueConversation` 안에서 `sendActivity`(카드) → 받은 `id`로 `setDeliveryMessage`. 예외가 나면 `releaseDelivery` 후 `console.error`. 운세 준비가 아직 끝나지 않았으면 이번 주기는 발송하지 않고 끝냅니다.

- [ ] **Step 1: 실패하는 테스트 작성**

`fakeAdapter`는 `continueConversation(appId, ref, fn)`에서 `sendActivity`를 기록하는 가짜 `context`로 `fn`을 실행합니다. `fail` 옵션이 있으면 한 번 예외를 던집니다. `fetchImpl`은 호출 횟수를 세는 정상 응답입니다.

```ts
test('평일 09:00에 대화방마다 한 번, LLM은 하루 한 번', async () => {
  const store = Store.open(':memory:'); store.activateConversation('c1', ref('c1')); store.activateConversation('c2', ref('c2'));
  const nine = new Date('2026-11-27T00:00:30Z');
  await Promise.all([runScheduledTasks(adapter, 'app', store, deps, nine), runScheduledTasks(adapter, 'app', store, deps, nine)]);
  await runScheduledTasks(adapter, 'app', store, deps, new Date('2026-11-27T00:01:00Z'));
  assert.equal(adapter.sent.length, 2); assert.equal(llmCalls, 1);
});
test('발송 시간 밖과 휴일에는 보내지 않음', async () => {
  for (const t of ['2026-11-26T23:59:00Z', '2026-11-27T01:00:00Z', '2026-11-28T00:00:30Z', '2026-12-25T00:00:30Z'])
    await runScheduledTasks(adapter, 'app', store, deps, new Date(t));
  assert.equal(adapter.sent.length, 0);
});
test('09:30 재시작 뒤에도 보냄', async () => { /* 새 Store(같은 DB 파일)로 '2026-11-27T00:30:00Z' 실행 → 1회 */ });
test('발송 실패는 다음 주기에 재시도', async () => { /* 첫 실행 fail → sent 0, 두 번째 실행 → sent 1, delivery에 message id 기록 */ });
```

- [ ] **Step 2~4: 실패 확인 → 구현 → `npm test && npm run typecheck` 통과**

- [ ] **Step 5: 커밋** — `feat(발송): 평일 아침 9시대에 대화방마다 운세 카드를 한 번 보낸다`

---

### Task 8: 서버와 멘션 명령

**Files:**
- Create: `src/index.ts`
- Test: `test/index.test.ts`

**Interfaces:**
- Consumes: Task 4~7 전부
- Produces:
  - `parseCommand(text: string): 'today' | 'help'` (공백 제거 후 `''`, `'오늘'`, `'오늘 운세'` → `today`, 나머지 → `help`)
  - `mentionReply(store: Store, text: string, now: Date, iconUrl: string): { card: Record<string, unknown> } | { text: string }` (`help`이면 `HELP_TEXT`. `today`이면 오늘 저장본이 있을 때 같은 카드, 없을 때 `NOT_YET_TEXT`. LLM 호출 없음)
  - `createApp(env?: NodeJS.ProcessEnv): express.Express` (쿠웨이트박 `createApp`과 같은 인증 확인, `authorizeJWT`, `express.json({ limit: '64kb' })`, `/healthz`, 오류 처리. 추가로 `app.use('/assets', express.static(<저장소 루트>/assets))`, 30초 주기 `runScheduledTasks`, `app.locals.dispose`)

봇 동작: 설치(`membersAdded`에 봇 자신 포함)되면 대화방 참조를 저장하고 `GREETING_TEXT`를 보냅니다. 메시지를 받으면 참조를 저장하고 `removeRecipientMention()` 뒤 `mentionReply` 결과를 보냅니다. 아이콘 주소는 `${PUBLIC_BASE_URL}/assets/owl.png`입니다. `GEMINI_API_KEY`가 없으면 기동 로그에 `GEMINI_API_KEY가 없어 템플릿 문장만 씁니다`를 남깁니다.

- [ ] **Step 1: 실패하는 테스트 작성**

쿠웨이트박 `test/index.test.ts`의 가짜 `IncomingMessage`/`ServerResponse` 요청 함수를 그대로 씁니다.

```ts
test('인증 누락은 시작 거부, 무인증 요청은 401, healthz와 아이콘', async () => {
  assert.throws(() => createApp({}), /MicrosoftAppId/);
  // createApp({...가짜 인증값, DATABASE_PATH: 임시}) 뒤
  // GET /healthz → 200 {"ok":true}, POST /api/messages → 401, GET /assets/owl.png → 200
});
test('명령 해석과 멘션 응답', () => {
  assert.equal(parseCommand(' '), 'today'); assert.equal(parseCommand('오늘'), 'today'); assert.equal(parseCommand('도움말'), 'help'); assert.equal(parseCommand('뭐야'), 'help');
  const s = Store.open(':memory:');
  assert.deepEqual(mentionReply(s, '', new Date('2026-11-28T03:00:00Z'), 'u'), { text: NOT_YET_TEXT });
  // 저장본을 넣은 뒤 같은 날 mentionReply → card가 buildFortuneCard(저장본)과 같음
});
```

- [ ] **Step 2~4: 실패 확인 → 구현 → `npm test && npm run typecheck && npm run build` 통과**

- [ ] **Step 5: 로컬 기동 확인**

Run: `MicrosoftAppId=00000000-0000-0000-0000-000000000001 MicrosoftAppPassword=x MicrosoftAppTenantId=00000000-0000-0000-0000-000000000002 PORT=3999 npm start &` 후 `curl -s localhost:3999/healthz; curl -s -o /dev/null -w '%{http_code}\n' localhost:3999/assets/owl.png`, 끝나면 프로세스 종료
Expected: `{"ok":true}`, `200`

- [ ] **Step 6: 커밋** — `feat(팀즈): 설치 인사와 멘션으로 오늘 쪽지를 다시 보여준다`

---

### Task 9: 아이콘, 배포, 보안 검사, 안내 문서

**Files:**
- Create: `appPackage/manifest.json`, `appPackage/outline.svg`, `appPackage/outline.png`
- Create: `Dockerfile`, `.dockerignore`, `compose.yaml`, `.env.example`, `deploy/team-fortune-bot.service`, `scripts/package-teams-app.sh`, `.github/workflows/security.yml`, `README.md`
- 이미 있음: `appPackage/color.png`(192×192), `assets/owl.png`(96×96)

모두 쿠웨이트박 파일을 바탕으로 이름·포트·볼륨·도메인만 Global Constraints 값으로 바꿉니다. 바뀌는 점만 적습니다.

- `manifest.json`: 설계 문서 9절 값, `version` `1.0.0`, `scopes` `["groupChat"]`, `commandLists`는 `오늘`(「오늘 쪽지를… 다시 보여드려요…」), `도움말`(「제가 뭘 하는지… 알려드려요…」), `validDomains` `["fortune-bot.namonak.dev"]`.
- `outline.svg`: 32×32, 투명 배경, `#FFFFFF` 단색. 귀 깃털 두 개가 있는 둥근 부엉이 머리와 앞에 든 네모 쪽지. `rsvg-convert -w 32 -h 32 appPackage/outline.svg -o appPackage/outline.png`로 변환합니다.
- `Dockerfile`: 쿠웨이트박과 같고, 실행 단계에 `COPY assets ./assets`, `RUN mkdir -p /data && chown node:node /data`, `USER node`를 추가합니다. `ENV DATABASE_PATH=/data/team-fortune-bot.sqlite`.
- `.env.example`: 쿠웨이트박 항목에 `GEMINI_API_KEY=`, `# GEMINI_MODEL=gemini-3.6-flash`, `# GEMINI_REASONING_EFFORT=low`, `BIRTHDAYS=홍길동:12-12,김철수:02-04`(예시임을 주석으로 표시) 추가.
- `security.yml`: 쿠웨이트박 파일과 같고 이미지 태그만 `teams-fortune-bot`.
- `package-teams-app.sh`: ZIP 이름 `team-fortune-bot-YYYYMMDD-HHMMSS.zip`, 안내 문구는 쓱부엉 말투.
- `README.md`: 쿠웨이트박 README 목차를 따릅니다. 하는 일, 로컬 개발, 환경 변수(생일은 `.env`에만), 배포(소유자 작업: Azure 봇 등록, DNS·Caddy, 서버), Teams 설치, **실기 확인 순서**(① `npm run card:preview` JSON으로 데스크톱·모바일 펼침 확인 → 안 되면 설계 문서 6절 대안 ② 설치 인사 ③ 다음 날 09시 발송 ④ `@쓱부엉` 재요청), 예상 비용(Task 4 Step 5 측정값), 백업.

- [ ] **Step 1: 아이콘 규격 확인**

Run: `sips -g pixelWidth -g pixelHeight -g hasAlpha appPackage/color.png appPackage/outline.png`
Expected: color 192×192, outline 32×32 `hasAlpha: yes`

- [ ] **Step 2: 패키지 생성 확인**

Run: `MicrosoftAppId=00000000-0000-0000-0000-000000000001 bash scripts/package-teams-app.sh && unzip -l dist/team-fortune-bot-*.zip && unzip -p dist/team-fortune-bot-*.zip manifest.json | grep -c 00000000-0000-0000-0000-000000000001`
Expected: 파일 3개(`manifest.json`, `color.png`, `outline.png`), `2`

- [ ] **Step 3: 이미지 빌드와 실행 확인**

Run: `docker build -t teams-fortune-bot:check . && docker run --rm -d --name fortune-check -p 127.0.0.1:3998:3978 -e MicrosoftAppId=00000000-0000-0000-0000-000000000001 -e MicrosoftAppPassword=x -e MicrosoftAppTenantId=00000000-0000-0000-0000-000000000002 teams-fortune-bot:check && sleep 3 && curl -s localhost:3998/healthz; docker exec fortune-check id -un; docker rm -f fortune-check`
Expected: `{"ok":true}`, `node`

- [ ] **Step 4: 전체 검증**

Run: `npm test && npm run typecheck && npm run build && npm audit --omit=dev --audit-level=moderate`
Expected: 전부 통과, `found 0 vulnerabilities`. Trivy는 푸시 뒤 GitHub Actions `Security` 워크플로 결과로 확인합니다.

- [ ] **Step 5: 커밋** — 작업 단위로 나눕니다: `feat(배포): 쓱부엉 윤곽선 아이콘과 Teams 설치 패키지를 추가`, `chore(배포): Docker 실행 구성과 서비스 파일을 추가`, `ci(보안): 일일 의존성과 이미지 검사를 추가`, `docs(안내): 쓱부엉 사용법과 운영 방법을 정리`
