import type { FacilityBundle, Store } from './types';

/**
 * 日本語検索用の正規化:
 * - NFKC（全角英数→半角、半角カナ→全角カナ）
 * - カタカナ→ひらがな
 * - 小文字化、空白除去
 */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase()
    .replace(/[\s　]+/g, '');
}

export interface SearchHit {
  store: Store;
  categoryName: string;
  score: number;
}

/** 端末内での店舗検索（オフラインで動作）。名前・読み仮名・カテゴリーを対象にする */
export function searchStores(bundle: FacilityBundle, query: string, limit = 50): SearchHit[] {
  const q = normalizeForSearch(query);
  const cats = new Map(bundle.categories.map((c) => [c.id, c.name]));
  const hits: SearchHit[] = [];
  for (const store of bundle.stores) {
    if (!store.isVisible) continue;
    const categoryName = cats.get(store.categoryId) ?? '';
    if (q === '') {
      hits.push({ store, categoryName, score: 0 });
      continue;
    }
    const name = normalizeForSearch(store.name);
    const kana = normalizeForSearch(store.nameKana);
    const cat = normalizeForSearch(categoryName);
    let score = 0;
    if (name.startsWith(q) || kana.startsWith(q)) score = 3;
    else if (name.includes(q) || kana.includes(q)) score = 2;
    else if (cat.includes(q)) score = 1;
    if (score > 0) hits.push({ store, categoryName, score });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.store.nameKana.localeCompare(b.store.nameKana, 'ja'))
    .slice(0, limit);
}
