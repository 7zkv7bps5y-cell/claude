import { SAMPLE_FACILITY_ID } from '@facility-nav/sample-data';

/**
 * アプリの設定。apps/mobile/.env に書いた値が読み込まれます（.env.example を参照）。
 * Supabase の設定がない場合は、アプリに内蔵した【サンプル】データだけで動作します。
 */
export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '',
  facilityId: process.env.EXPO_PUBLIC_FACILITY_ID || SAMPLE_FACILITY_ID,
  appVersion: '0.1.0-phase1a',
};

// https のみ許可。開発用に同じPC内・同じLAN内のサーバー（Supabase をPC上で動かす場合など）は http も許可する
const isLocalDev = /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?$/.test(config.supabaseUrl);
export const hasServer = (config.supabaseUrl.startsWith('https://') || isLocalDev) && config.supabaseKey.length > 0;
