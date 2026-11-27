// 템플릿 문장으로 카드 JSON을 dist/card-YYYY-MM-DD.json에 씁니다(LLM 호출 없음).
// 사용: npm run card:preview -- [YYYY-MM-DD] (생략하면 한국 시간 오늘)
import { mkdirSync, writeFileSync } from 'node:fs';
import { kstParts } from '../src/calendar.js';
import { buildFortuneCard } from '../src/cards.js';
import { buildDayFacts } from '../src/domain.js';
import { templateTexts } from '../src/llm.js';

const date = process.argv[2] ?? kstParts(new Date()).date;
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
  console.error(`날짜 형식이 올바르지 않습니다: ${date} (YYYY-MM-DD)`);
  process.exit(1);
}
const facts = buildDayFacts(date, []);
const card = buildFortuneCard(facts, templateTexts(facts), `${process.env.PUBLIC_BASE_URL ?? 'https://fortune-bot.namonak.dev'}/assets/owl.png`);
mkdirSync('dist', { recursive: true });
const file = `dist/card-${date}.json`;
writeFileSync(file, JSON.stringify(card, null, 2));
console.log(`카드 JSON을 저장했습니다: ${file}`);
