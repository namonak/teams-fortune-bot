import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DayFacts } from './domain.js';
import type { DayTexts } from './llm.js';

export type StoredFortune = { date: string; facts: DayFacts; texts: DayTexts; source: 'llm' | 'template' };

export class Store {
  private constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS conversation (id INTEGER PRIMARY KEY, teams_conversation_id TEXT UNIQUE NOT NULL, reference_json TEXT);
      CREATE TABLE IF NOT EXISTS daily_fortune (date_kst TEXT PRIMARY KEY, json TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS delivery (conversation_id TEXT NOT NULL, date_kst TEXT NOT NULL, message_id TEXT, PRIMARY KEY(conversation_id, date_kst));`);
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
  conversationReferences(): { id: string; reference: any }[] {
    return (this.db.prepare('SELECT teams_conversation_id AS id, reference_json AS reference FROM conversation WHERE reference_json IS NOT NULL').all() as { id: string; reference: string }[])
      .map(({ id, reference }) => ({ id, reference: JSON.parse(reference) }));
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
  claimDelivery(conversationId: string, date: string) {
    return this.db.prepare('INSERT OR IGNORE INTO delivery (conversation_id, date_kst) VALUES (?, ?)').run(conversationId, date).changes === 1;
  }
  setDeliveryMessage(conversationId: string, date: string, messageId: string) {
    this.db.prepare('UPDATE delivery SET message_id=? WHERE conversation_id=? AND date_kst=?').run(messageId, conversationId, date);
  }
  releaseDelivery(conversationId: string, date: string) {
    this.db.prepare('DELETE FROM delivery WHERE conversation_id=? AND date_kst=?').run(conversationId, date);
  }
  close() { this.db.close(); }
}
