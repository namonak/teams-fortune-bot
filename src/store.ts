import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DayFacts } from './domain.js';
import type { DayTexts } from './llm.js';

// ponytail: 발송 직후 message_id 저장 전에 죽으면 5분 뒤 다시 잡혀 중복 카드 1장이 나갈 수 있다. 발송 결과 확인이 필요해지면 그때 보강한다
const STALE_CLAIM_MS = 5 * 60_000;
export const DEFAULT_SEND_TIME = '09:00';

export type StoredFortune = { date: string; facts: DayFacts; texts: DayTexts; source: 'llm' | 'template' };

export class Store {
  private constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS conversation (id INTEGER PRIMARY KEY, teams_conversation_id TEXT UNIQUE NOT NULL, reference_json TEXT);
      CREATE TABLE IF NOT EXISTS daily_fortune (date_kst TEXT PRIMARY KEY, json TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS delivery (conversation_id TEXT NOT NULL, date_kst TEXT NOT NULL, message_id TEXT, claimed_at INTEGER, PRIMARY KEY(conversation_id, date_kst));`);
    // 대화방별 발송 시각(HH:MM, 한국 시간). 칸이 없던 DB에도 한 번 추가한다
    if (!(db.prepare('PRAGMA table_info(conversation)').all() as { name: string }[]).some((c) => c.name === 'send_time'))
      db.exec(`ALTER TABLE conversation ADD COLUMN send_time TEXT NOT NULL DEFAULT '${DEFAULT_SEND_TIME}'`);
  }
  static open(path: string) {
    // 첫 실행에 ./data 폴더가 없어도 열리도록 상위 폴더를 만든다
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    return new Store(new DatabaseSync(path));
  }
  activateConversation(id: string, reference: unknown) {
    this.db.prepare(`INSERT INTO conversation (teams_conversation_id, reference_json) VALUES (?, ?)
      ON CONFLICT(teams_conversation_id) DO UPDATE SET reference_json=COALESCE(excluded.reference_json, conversation.reference_json)`).run(id, reference ? JSON.stringify(reference) : null);
  }
  conversationReferences(): { id: string; reference: any; sendTime: string }[] {
    return (this.db.prepare('SELECT teams_conversation_id AS id, reference_json AS reference, send_time AS sendTime FROM conversation WHERE reference_json IS NOT NULL').all() as { id: string; reference: string; sendTime: string }[])
      .map(({ id, reference, sendTime }) => ({ id, reference: JSON.parse(reference), sendTime }));
  }
  sendTime(id: string): string {
    return (this.db.prepare('SELECT send_time FROM conversation WHERE teams_conversation_id=?').get(id) as { send_time: string } | undefined)?.send_time ?? DEFAULT_SEND_TIME;
  }
  setSendTime(id: string, time: string) {
    this.db.prepare('UPDATE conversation SET send_time=? WHERE teams_conversation_id=?').run(time, id);
  }
  getFortune(date: string): StoredFortune | null {
    const row = this.db.prepare('SELECT json, source FROM daily_fortune WHERE date_kst=?').get(date) as { json: string; source: 'llm' | 'template' } | undefined;
    if (!row) return null;
    const { facts, texts } = JSON.parse(row.json) as Pick<StoredFortune, 'facts' | 'texts'>;
    return { date, facts, texts, source: row.source };
  }
  saveFortune(f: StoredFortune) {
    // 같은 날짜가 이미 있으면 먼저 저장한 운세를 유지한다
    this.db.prepare('INSERT OR IGNORE INTO daily_fortune VALUES (?, ?, ?, ?)')
      .run(f.date, JSON.stringify({ facts: f.facts, texts: f.texts }), f.source, new Date().toISOString());
  }
  recentNews(before: string, n = 5): string[] {
    return (this.db.prepare('SELECT json FROM daily_fortune WHERE date_kst < ? ORDER BY date_kst DESC LIMIT ?').all(before, n) as { json: string }[])
      .map((row) => (JSON.parse(row.json) as Pick<StoredFortune, 'texts'>).texts.news);
  }
  claimDelivery(conversationId: string, date: string, now = new Date()) {
    // 발송 전에 멈춰 message_id 없이 5분이 지난 기록은 다시 가져간다
    return this.db.prepare(`INSERT INTO delivery (conversation_id, date_kst, claimed_at) VALUES (?, ?, ?)
      ON CONFLICT(conversation_id, date_kst) DO UPDATE SET claimed_at=excluded.claimed_at
      WHERE delivery.message_id IS NULL AND delivery.claimed_at < excluded.claimed_at - ?`)
      .run(conversationId, date, now.getTime(), STALE_CLAIM_MS).changes === 1;
  }
  setDeliveryMessage(conversationId: string, date: string, messageId: string) {
    this.db.prepare('UPDATE delivery SET message_id=? WHERE conversation_id=? AND date_kst=?').run(messageId, conversationId, date);
  }
  releaseDelivery(conversationId: string, date: string) {
    this.db.prepare('DELETE FROM delivery WHERE conversation_id=? AND date_kst=?').run(conversationId, date);
  }
  close() { this.db.close(); }
}
