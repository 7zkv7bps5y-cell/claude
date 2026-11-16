export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 徒歩の所要時間（分速80mで計算、最低1分） */
export function walkMinutes(distanceM: number): number {
  return Math.max(1, Math.round(distanceM / 80));
}
