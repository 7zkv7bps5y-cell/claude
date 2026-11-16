import type { FacilityApi, OutboxEvent, SendResult } from '@facility-nav/core';
import { config } from '../config';

/**
 * Supabase の公開API（PostgREST の RPC）を呼ぶ最小限のクライアント。
 * 利用者アプリはログイン不要のため、公開用のキーのみを使う（秘密鍵はアプリに含めない）。
 */
const TIMEOUT_MS = 10_000;

function headers(): Record<string, string> {
  const h: Record<string, string> = { apikey: config.supabaseKey, 'Content-Type': 'application/json' };
  // 旧形式の anon キー（JWT）の場合のみ Authorization ヘッダーにも入れる。
  // 新形式の publishable キー（sb_publishable_...）は apikey ヘッダーだけで使う。
  if (!config.supabaseKey.startsWith('sb_publishable_')) h.Authorization = `Bearer ${config.supabaseKey}`;
  return h;
}

async function rpc<T>(name: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('通信がタイムアウトしました');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const facilityApi: FacilityApi = {
  getVersion: (facilityId) => rpc('get_facility_version', { p_facility_id: facilityId }),
  getBundle: (facilityId) => rpc('get_published_facility', { p_facility_id: facilityId }),
  async getRules(facilityId) {
    const r = await rpc<Awaited<ReturnType<FacilityApi['getRules']>> | null>('get_active_route_rules', {
      p_facility_id: facilityId,
    });
    if (!r) throw new Error('施設が公開されていません');
    return r;
  },
};

export async function sendEvents(events: OutboxEvent[]): Promise<SendResult> {
  const r = await rpc<{ accepted: string[]; rejected: { eventId: string; reason: string }[] }>('ingest_events', {
    p_events: events,
  });
  return { accepted: r.accepted ?? [], rejected: r.rejected ?? [] };
}
