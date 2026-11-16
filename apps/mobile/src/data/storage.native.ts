/**
 * iPhone / Android の保存処理（端末内の SQLite）。
 * - 施設データ・規制情報・設定：キー・バリュー形式（expo-sqlite/kv-store）
 * - 送信待ちキュー：専用テーブル（event_id を主キーにして端末内でも重複させない）
 */
import type { KeyValueStore, OutboxEvent, OutboxStore } from '@facility-nav/core';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { SQLiteStorage } from 'expo-sqlite/kv-store';

export function createKeyValueStore(): KeyValueStore {
  const s = new SQLiteStorage('facility-nav-kv.db');
  return {
    getItem: (k) => s.getItemAsync(k),
    setItem: (k, v) => s.setItemAsync(k, v),
    async removeItem(k) {
      await s.removeItemAsync(k);
    },
  };
}

class SQLiteOutboxStore implements OutboxStore {
  constructor(private readonly db: SQLiteDatabase) {}

  async add(e: OutboxEvent) {
    await this.db.runAsync(
      'INSERT OR IGNORE INTO outbox (event_id, occurred_at, body) VALUES (?, ?, ?)',
      e.eventId,
      e.occurredAt,
      JSON.stringify(e),
    );
  }
  async peek(limit: number) {
    const rows = await this.db.getAllAsync<{ body: string }>(
      'SELECT body FROM outbox ORDER BY occurred_at ASC LIMIT ?',
      limit,
    );
    return rows.map((r) => JSON.parse(r.body) as OutboxEvent);
  }
  async remove(ids: string[]) {
    if (ids.length === 0) return;
    await this.db.withTransactionAsync(async () => {
      for (const id of ids) await this.db.runAsync('DELETE FROM outbox WHERE event_id = ?', id);
    });
  }
  async count() {
    const r = await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox');
    return r?.n ?? 0;
  }
  async clear() {
    await this.db.runAsync('DELETE FROM outbox');
  }
  async deleteOlderThan(cutoffIso: string) {
    const r = await this.db.runAsync('DELETE FROM outbox WHERE occurred_at < ?', cutoffIso);
    return r.changes;
  }
  async trimToMax(max: number) {
    const r = await this.db.runAsync(
      'DELETE FROM outbox WHERE event_id IN (SELECT event_id FROM outbox ORDER BY occurred_at DESC LIMIT -1 OFFSET ?)',
      max,
    );
    return r.changes;
  }
}

export async function createOutboxStore(): Promise<OutboxStore> {
  const db = await openDatabaseAsync('facility-nav-outbox.db');
  await db.execAsync(
    'CREATE TABLE IF NOT EXISTS outbox (event_id TEXT PRIMARY KEY NOT NULL, occurred_at TEXT NOT NULL, body TEXT NOT NULL);' +
      'CREATE INDEX IF NOT EXISTS outbox_time ON outbox (occurred_at);',
  );
  return new SQLiteOutboxStore(db);
}
