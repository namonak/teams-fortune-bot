import { createHash } from 'node:crypto';
import { birthdaysFor, dayHint, type Birthday, type BirthdayFacts, type DayHint } from './calendar.js';

export const ANIMALS = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'] as const;

export type Relation = '충' | '육합' | '삼합' | '형·해' | '오늘의 띠' | '보통';

export const STARS: Record<Relation, number> = { 충: 1, 육합: 5, 삼합: 4, '형·해': 2, '오늘의 띠': 3, 보통: 3 };

const STEMS = '갑을병정무기경신임계';
const BRANCHES = '자축인묘진사오미신유술해';

function ganji(index: number) {
  const i = ((index % 60) + 60) % 60;
  return { name: STEMS[i % 10] + BRANCHES[i % 12], branch: i % 12 };
}

// 'YYYY-MM-DD'는 UTC 자정으로 해석되므로 서버 시간대와 무관합니다. 1970-01-01의 율리우스 적일은 2440588입니다.
export function dayGanji(date: string) {
  return ganji(Date.parse(date) / 86_400_000 + 2_440_588 + 49);
}

export function yearGanji(year: number) {
  return ganji(year - 4);
}

// 형: 호랑이·뱀·원숭이, 소·개·양, 쥐·토끼
const HYUNG = [[2, 5, 8], [1, 10, 7], [0, 3]];
// 자형: 용·말·닭·돼지가 같은 띠의 날을 만날 때
const SELF_HYUNG = [4, 6, 9, 11];

// 설계 문서 4.2절 순서대로 먼저 맞는 관계를 적용합니다.
export function relation(dayBranch: number, animal: number): Relation {
  const d = dayBranch, a = animal;
  if ((d + 6) % 12 === a) return '충';
  if ((d + a) % 12 === 1) return '육합'; // 쥐·소, 호랑이·돼지, 토끼·개, 용·닭, 뱀·원숭이, 말·양
  if (d !== a && d % 4 === a % 4) return '삼합'; // 원숭이·쥐·용, 돼지·토끼·양, 호랑이·말·개, 뱀·닭·소
  const hyung = d === a ? SELF_HYUNG.includes(d) : HYUNG.some((g) => g.includes(d) && g.includes(a));
  const hae = (d + a) % 12 === 7; // 쥐·양, 소·말, 호랑이·뱀, 토끼·용, 원숭이·돼지, 닭·개
  if (hyung || hae) return '형·해';
  return d === a ? '오늘의 띠' : '보통';
}

// 같은 키는 언제나 같은 정수를 고릅니다(sha256 앞 4바이트).
export function seeded(key: string, min: number, max: number) {
  return min + (createHash('sha256').update(key).digest().readUInt32BE(0) % (max - min + 1));
}

export const MENUS: readonly string[] = [
  '김치찌개', '된장찌개', '순두부찌개', '부대찌개', '제육볶음', '불고기', '비빔밥', '돌솥비빔밥', '김밥', '라면',
  '칼국수', '냉면', '쌀국수', '짜장면', '짬뽕', '탕수육', '돈가스', '카레', '규동', '초밥',
  '우동', '떡볶이', '순대국', '설렁탕', '갈비탕', '삼계탕', '쌈밥', '샌드위치', '햄버거', '파스타',
];

export const COLORS: readonly string[] = [
  '빨강', '주황', '노랑', '연두', '초록', '하늘색', '파랑', '남색', '보라', '분홍', '하양', '검정',
];

export type RowFacts = { animal: number; relation: Relation; stars: number; meeting: number; lunch: number; leave: number; menu: string; color: string };

export type DayFacts = {
  date: string; weekday: number; ganji: string; dayBranch: number; rows: RowFacts[];
  best: number; rest: number; hint: DayHint | null; birthday: BirthdayFacts | null;
};

const clamp = (v: number) => Math.min(5, Math.max(1, v));

export function buildDayFacts(date: string, birthdays: Birthday[]): DayFacts {
  const { name, branch } = dayGanji(date);
  const weekday = new Date(date).getUTCDay();
  const rows = ANIMALS.map((_, animal): RowFacts => {
    const rel = relation(branch, animal), stars = STARS[rel];
    const detail = (item: string) => clamp(stars + seeded(`${date}:${animal}:${item}`, -2, 2));
    return {
      animal, relation: rel, stars,
      meeting: detail('meeting'),
      lunch: detail('lunch'),
      // 금요일에는 칼퇴운에 1을 더합니다(최대 5).
      leave: clamp(detail('leave') + (weekday === 5 ? 1 : 0)),
      menu: MENUS[seeded(`${date}:${animal}:menu`, 0, MENUS.length - 1)],
      color: COLORS[seeded(`${date}:${animal}:color`, 0, COLORS.length - 1)],
    };
  });
  return {
    date, weekday, ganji: name, dayBranch: branch, rows,
    best: rows.findIndex((r) => r.relation === '육합'),
    rest: rows.findIndex((r) => r.relation === '충'),
    hint: dayHint(date),
    birthday: birthdaysFor(date, birthdays),
  };
}
