import assert from 'node:assert/strict';
import test from 'node:test';
import { birthdaysFor, dayHint, isBusinessDay, kstParts, nextBusinessDay, parseBirthdays } from '../src/calendar.js';

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
