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
