import assert from 'node:assert/strict';
import test from 'node:test';
import { BIRTHDAY, EXTRAS, LINES, NEWS } from '../src/templates.js';

test('템플릿 개수와 형식', () => {
  for (const s of [1,2,3,4,5] as const) { assert.ok(LINES[s].length >= 10); assert.ok(EXTRAS[s].length >= 10); }
  assert.ok(NEWS.length >= 20); assert.ok(BIRTHDAY.length >= 5);
  const all = [...Object.values(LINES).flat(), ...Object.values(EXTRAS).flat(), ...NEWS, ...BIRTHDAY];
  for (const t of all) { assert.doesNotMatch(t, /[*_\[\]<>{}]/); assert.match(t, /…/); }
  for (const t of Object.values(LINES).flat()) assert.ok([...t].length <= 40);
  for (const t of [...Object.values(EXTRAS).flat(), ...NEWS, ...BIRTHDAY]) assert.ok([...t].length <= 60);
});
