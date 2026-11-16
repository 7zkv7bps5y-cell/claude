/**
 * Web（ブラウザでの確認用）の保存処理。localStorage を使う。
 * iPhone / Android では storage.native.ts が使われる（端末内の SQLite に保存）。
 */
import { MemoryOutboxStore, type KeyValueStore, type OutboxEvent, type OutboxStore } from '@facility-nav/core';

const ls = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export function createKeyValueStore(): KeyValueStore {
  const mem = new Map<string, string>();
  return {
    async getItem(k) {
      return ls()?.getItem(k) ?? mem.get(k) ?? null;
    },
    async setItem(k, v) {
      const s = ls();
      if (s) s.setItem(k, v);
      else mem.set(k, v);
    },
    async removeItem(k) {
      ls()?.removeItem(k);
      mem.delete(k);
    },
  };
}

const OUTBOX_KEY = 'outbox:v1';

/** localStorage に保存するキュー（Web 確認用） */
class LocalStorageOutboxStore extends MemoryOutboxStore {
  constructor() {
    super();
    try {
      const raw = ls()?.getItem(OUTBOX_KEY);
      if (raw) this.items = JSON.parse(raw) as OutboxEvent[];
    } catch {
      this.items = [];
    }
  }
  private persist() {
    ls()?.setItem(OUTBOX_KEY, JSON.stringify(this.items));
  }
  override async add(e: OutboxEvent) {
    await super.add(e);
    this.persist();
  }
  override async remove(ids: string[]) {
    await super.remove(ids);
    this.persist();
  }
  override async clear() {
    await super.clear();
    this.persist();
  }
  override async deleteOlderThan(c: string) {
    const n = await super.deleteOlderThan(c);
    this.persist();
    return n;
  }
  override async trimToMax(m: number) {
    const n = await super.trimToMax(m);
    this.persist();
    return n;
  }
}

export async function createOutboxStore(): Promise<OutboxStore> {
  return new LocalStorageOutboxStore();
}
