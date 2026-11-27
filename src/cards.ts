import type { DayHint } from './calendar.js';
import { ANIMALS, yearGanji, type DayFacts, type Relation } from './domain.js';
import type { DayTexts } from './llm.js';

// 'HH:MM' → '오전 9시 30분'
export function timeLabel(hhmm: string) {
  const h = Number(hhmm.slice(0, 2)), m = Number(hhmm.slice(3, 5));
  return `${h < 12 ? '오전' : '오후'} ${h > 12 ? h - 12 : h}시${m ? ` ${m}분` : ''}`;
}
export const helpText = (sendTime: string) => [
  `저… 쓱부엉이에요… 평일 ${timeLabel(sendTime)}에 띠별 운세 쪽지를 두고 가요…`,
  '',
  '- `@쓱부엉` 또는 `@쓱부엉 오늘`: 오늘 쪽지 다시 보기',
  '- `@쓱부엉 시간 9:30`: 이 대화방의 쪽지 시각 바꾸기(07:00~18:00)',
  '- `@쓱부엉 시간`: 지금 쪽지 시각 보기',
  '- `@쓱부엉 도움말`: 이 안내',
  '',
  '재미로만 봐 주세요… (쓱)',
].join('\n');
export const NOT_YET_TEXT = '오늘 쪽지는… 아직이에요… (쓱)';
export const greetingText = (sendTime: string) => `저… 평일 ${timeLabel(sendTime)}에 쪽지 두고 갈게요… (쓱)`;
export const timeSetText = (sendTime: string, who: string) => `${who ? `${who}님 말씀대로… ` : ''}앞으로 평일 ${timeLabel(sendTime)}에 쪽지 둘게요… (쓱)`;
export const timeShowText = (sendTime: string) => `지금은 평일 ${timeLabel(sendTime)}에 쪽지를 두고 가요… 바꾸려면 \`@쓱부엉 시간 9:30\`처럼 불러 주세요… (쓱)`;
export const TIME_FORMAT_TEXT = '저… 시각은 07:00~18:00 사이로 `@쓱부엉 시간 9:30`처럼 적어 주세요… (쓱)';

const WEEKDAYS = '일월화수목금토';

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

// 받침이 있으면 '과', 없으면 '와'(뱀과, 쥐와)
const withGwa = (word: string) => word + ((word.charCodeAt(word.length - 1) - 0xac00) % 28 ? '과' : '와');

function why(rel: Relation, day: string) {
  const reasons: Record<Relation, string> = {
    육합: `${withGwa(day)} 짝이 맞는 육합이에요`,
    삼합: `${withGwa(day)} 뜻이 맞는 삼합이에요`,
    '형·해': `${withGwa(day)} 조금 부딪히는 형·해예요`,
    충: `${withGwa(day)} 마주 서는 충이에요`,
    보통: `${withGwa(day)} 특별한 관계가 없어요`,
    '오늘의 띠': `오늘이 바로 ${day}의 날이에요`,
  };
  return `${reasons[rel]}…`;
}

function subtitle(hint: DayHint | null, year: number) {
  const lead: Record<DayHint, string> = {
    금요일: '금요일이에요… 칼퇴운부터 보세요…',
    월요일: '월요일이에요… 주말 잘 보내셨어요…',
    '연휴 다음 날': '연휴 잘 보내셨어요…',
    '올해 마지막 업무일': '올해 마지막 쪽지예요…',
    '새해 첫 업무일': `새해 첫 쪽지예요… ${yearGanji(year).name}년이에요…`,
  };
  return `${hint ? lead[hint] : '저… 두고 갈게요…'} 자기 띠를 누르면 펼쳐져요…`;
}

function birthdayBox(facts: DayFacts, text: string | null) {
  const b = facts.birthday;
  if (!b) return [];
  const list = (names: string[]) => names.map((n) => `**${n}**님`).join(', ');
  const lines: string[] = [];
  if (b.today.length) lines.push(`오늘은 ${list(b.today)} 생일이에요…`);
  if (b.ahead.length) lines.push(`${b.when} ${list(b.ahead)} 생일이 있어요… ${b.when === '내일은' ? '하루 일찍' : '미리'} 두고 가요…`);
  return [{
    type: 'Container', style: 'emphasis', spacing: 'Medium',
    items: [
      { type: 'TextBlock', text: '생일 쪽지', weight: 'Bolder' },
      { type: 'TextBlock', text: lines.join(' '), wrap: true },
      ...(text ? [{ type: 'TextBlock', text, wrap: true }] : []),
    ],
  }];
}

// 구조와 ID는 시안 docs/superpowers/specs/mockup/index.html의 card 객체를 따릅니다.
export function buildFortuneCard(facts: DayFacts, texts: DayTexts, iconUrl: string): Record<string, unknown> {
  const [year, month, day] = facts.date.split('-').map(Number);
  const dayAnimal = ANIMALS[facts.dayBranch];

  const rowItems = facts.rows.flatMap((r, i) => [
    {
      type: 'Container', id: `row${i}`, separator: true, spacing: 'Small',
      selectAction: { type: 'Action.ToggleVisibility', targetElements: [`d${i}`, `open${i}`, `close${i}`] },
      items: [{ type: 'ColumnSet', columns: [
        { type: 'Column', width: '52px', items: [{ type: 'TextBlock', text: ANIMALS[r.animal], weight: 'Bolder' }] },
        { type: 'Column', width: 'auto', items: [{ type: 'TextBlock', text: stars(r.stars), color: r.stars >= 4 ? 'Good' : r.stars <= 2 ? 'Attention' : 'Warning' }] },
        { type: 'Column', width: 'stretch', items: [{ type: 'TextBlock', text: texts.rows[i].line, wrap: true }] },
        { type: 'Column', width: 'auto', items: [
          { type: 'TextBlock', id: `open${i}`, text: '▾', isSubtle: true },
          { type: 'TextBlock', id: `close${i}`, text: '▴', isSubtle: true, isVisible: false, spacing: 'None' },
        ] },
      ] }],
    },
    {
      type: 'Container', id: `d${i}`, isVisible: false, style: 'emphasis', spacing: 'None',
      items: [
        { type: 'FactSet', facts: [
          { title: '회의운', value: stars(r.meeting) },
          { title: '점심운', value: stars(r.lunch) },
          { title: '칼퇴운', value: stars(r.leave) },
          { title: '행운 메뉴', value: r.menu },
          { title: '행운의 색', value: r.color },
        ] },
        { type: 'TextBlock', text: texts.rows[i].extra, wrap: true },
        { type: 'TextBlock', text: why(r.relation, dayAnimal), isSubtle: true, size: 'Small', spacing: 'Small' },
      ],
    },
  ]);

  return {
    type: 'AdaptiveCard', version: '1.5',
    body: [
      { type: 'ColumnSet', columns: [
        { type: 'Column', width: 'auto', items: [{ type: 'Image', url: iconUrl, size: 'Small', style: 'Person' }] },
        { type: 'Column', width: 'stretch', verticalContentAlignment: 'Center', items: [
          { type: 'TextBlock', text: `${month}월 ${day}일 (${WEEKDAYS[facts.weekday]}) 쪽지예요…`, weight: 'Bolder', size: 'Medium' },
          { type: 'TextBlock', text: subtitle(facts.hint, year), isSubtle: true, wrap: true, spacing: 'None' },
        ] },
      ] },
      ...birthdayBox(facts, texts.birthday),
      { type: 'TextBlock', text: `오늘 제일 좋은 띠는 **${ANIMALS[facts.best]}**… **${ANIMALS[facts.rest]}**띠는 쉬어 가세요…`, wrap: true, spacing: 'Medium' },
      ...rowItems,
      { type: 'TextBlock', text: texts.news, wrap: true, separator: true },
      { type: 'TextBlock', text: `오늘은 ${facts.ganji}일(${dayAnimal}날)이에요… 재미로만 봐 주세요…`, isSubtle: true, size: 'Small', wrap: true },
      { type: 'TextBlock', text: '…그럼 이만. (쓱)', isSubtle: true, horizontalAlignment: 'Right', spacing: 'None' },
    ],
  };
}
