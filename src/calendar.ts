import { isKoreanHoliday } from './holidays.js';

const KST = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
});
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function kstParts(now: Date) {
  const p = Object.fromEntries(KST.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: WEEKDAYS.indexOf(p.weekday) };
}

// 'YYYY-MM-DD'는 UTC 자정으로 계산하므로 서버 시간대와 무관합니다.
export function addDays(date: string, n: number) {
  return new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);
}

const weekday = (date: string) => new Date(date).getUTCDay();

export function isBusinessDay(date: string) {
  const w = weekday(date);
  return w !== 0 && w !== 6 && !isKoreanHoliday(date);
}

export function nextBusinessDay(date: string) {
  let d = addDays(date, 1);
  while (!isBusinessDay(d)) d = addDays(d, 1);
  return d;
}

function prevBusinessDay(date: string) {
  let d = addDays(date, -1);
  while (!isBusinessDay(d)) d = addDays(d, -1);
  return d;
}

export type DayHint = '새해 첫 업무일' | '올해 마지막 업무일' | '연휴 다음 날' | '월요일' | '금요일';

export function dayHint(date: string): DayHint | null {
  const year = date.slice(0, 4);
  const prev = prevBusinessDay(date);
  if (prev.slice(0, 4) !== year) return '새해 첫 업무일';
  if (nextBusinessDay(date).slice(0, 4) !== year) return '올해 마지막 업무일';
  // 직전 업무일과 오늘 사이의 쉬는 날에 공휴일이 끼어 있으면 연휴 다음 날로 봅니다(예: 금요일 공휴일 + 주말 뒤 월요일).
  for (let d = addDays(prev, 1); d < date; d = addDays(d, 1)) if (isKoreanHoliday(d)) return '연휴 다음 날';
  const w = weekday(date);
  return w === 1 ? '월요일' : w === 5 ? '금요일' : null;
}

export type Birthday = { name: string; monthDay: string };

// '이름:MM-DD'를 쉼표로 이은 값에서 형식과 날짜가 올바른 항목만 읽습니다.
export function parseBirthdays(raw: string | undefined): Birthday[] {
  const list: Birthday[] = [];
  for (const item of (raw ?? '').split(',')) {
    const m = /^(.+?):(\d{2})-(\d{2})$/.exec(item.trim());
    if (!m) continue;
    const name = m[1].trim(), month = Number(m[2]), day = Number(m[3]);
    // 윤년(2000년)으로 검사해 02-29를 허용합니다.
    const check = new Date(Date.UTC(2000, month - 1, day));
    if (name && check.getUTCMonth() === month - 1 && check.getUTCDate() === day) list.push({ name, monthDay: `${m[2]}-${m[3]}` });
  }
  return list;
}

export type BirthdayFacts = { today: string[]; ahead: string[]; when: '내일은' | '주말에' | '연휴에' | null };

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// 2월 29일 생일은 평년에 2월 28일로 봅니다.
function namesOn(date: string, list: Birthday[]) {
  const md = date.slice(5), leap = isLeap(Number(date.slice(0, 4)));
  return list.filter((b) => (b.monthDay === '02-29' && !leap ? '02-28' : b.monthDay) === md).map((b) => b.name);
}

export function birthdaysFor(date: string, list: Birthday[]): BirthdayFacts | null {
  const today = namesOn(date, list);
  const ahead: string[] = [], days: string[] = [];
  for (let d = addDays(date, 1), end = nextBusinessDay(date); d < end; d = addDays(d, 1)) {
    const names = namesOn(d, list);
    if (names.length) { ahead.push(...names); days.push(d); }
  }
  if (!today.length && !ahead.length) return null;
  const when = !ahead.length ? null
    : days.every((d) => d === addDays(date, 1)) ? '내일은'
    : days.every((d) => weekday(d) === 0 || weekday(d) === 6) ? '주말에'
    : '연휴에';
  return { today, ahead, when };
}
