import { describe, expect, it } from 'vitest';
import { assessRuleFreshness, DEFAULT_FRESHNESS, type RouteRulesSnapshot, type RuleFreshnessSettings } from '../src';
import { rule } from './fixtures';

const fetchedAt = '2026-11-16T03:00:00.000Z';
const snap = (rules = [rule('closed', ['x'])]): RouteRulesSnapshot => ({ facilityId: 'f', fetchedAt, serverTime: fetchedAt, rules });
const after = (minutes: number) => new Date(Date.parse(fetchedAt) + minutes * 60_000);

describe('assessRuleFreshness（経路規制情報の鮮度判定）', () => {
  it('15分以内は「正常」で通常案内', () => {
    const a = assessRuleFreshness(snap(), DEFAULT_FRESHNESS, after(10));
    expect(a).toMatchObject({ level: 'fresh', routing: 'allow', isReferenceOnly: false });
  });

  it('15分超〜6時間は「注意」。案内はするが参考案内として明示', () => {
    const a = assessRuleFreshness(snap(), DEFAULT_FRESHNESS, after(16));
    expect(a).toMatchObject({ level: 'stale', routing: 'allow', isReferenceOnly: true });
    expect(a.message).toContain('参考案内');
    expect(assessRuleFreshness(snap(), DEFAULT_FRESHNESS, after(360)).level).toBe('stale');
  });

  it('6時間超は「制限」。confirm 設定なら確認後の参考案内', () => {
    const a = assessRuleFreshness(snap(), DEFAULT_FRESHNESS, after(361));
    expect(a).toMatchObject({ level: 'restricted', routing: 'confirm', isReferenceOnly: true, reason: 'too_old' });
  });

  it('「制限」で block 設定なら経路案内を停止', () => {
    const settings: RuleFreshnessSettings = { ...DEFAULT_FRESHNESS, restrictMode: 'block' };
    const a = assessRuleFreshness(snap(), settings, after(400));
    expect(a.routing).toBe('block');
    expect(a.message).toContain('経路案内を停止');
  });

  it('安全上重要な規制（severity=high）を保存している場合は早く「制限」になる', () => {
    const high = snap([rule('closed', ['x'], { severity: 'high' })]);
    const a = assessRuleFreshness(high, DEFAULT_FRESHNESS, after(61));
    expect(a).toMatchObject({ level: 'restricted', reason: 'high_severity_or_event', restrictThresholdMinutes: 60 });
    // 通常の規制なら同じ経過時間でも「注意」
    expect(assessRuleFreshness(snap(), DEFAULT_FRESHNESS, after(61)).level).toBe('stale');
  });

  it('イベント中の施設も早く「制限」になる', () => {
    const a = assessRuleFreshness(snap(), { ...DEFAULT_FRESHNESS, eventMode: true }, after(61));
    expect(a.level).toBe('restricted');
  });

  it('しきい値は施設ごとに変更できる', () => {
    const custom: RuleFreshnessSettings = { ...DEFAULT_FRESHNESS, freshMinutes: 5, restrictMinutes: 30 };
    expect(assessRuleFreshness(snap(), custom, after(6)).level).toBe('stale');
    expect(assessRuleFreshness(snap(), custom, after(31)).level).toBe('restricted');
  });

  it('一度も取得できていない場合は「制限」', () => {
    const a = assessRuleFreshness(null, DEFAULT_FRESHNESS, after(0));
    expect(a).toMatchObject({ level: 'restricted', reason: 'never_fetched', routing: 'confirm' });
    expect(assessRuleFreshness(null, { ...DEFAULT_FRESHNESS, restrictMode: 'block' }, after(0)).routing).toBe('block');
  });

  it('端末の時計が巻き戻っている場合は「正常」扱いにしない', () => {
    const a = assessRuleFreshness(snap(), DEFAULT_FRESHNESS, after(-120));
    expect(a).toMatchObject({ level: 'stale', isReferenceOnly: true, reason: 'clock_went_back' });
  });
});

describe('effectiveFreshnessSettings', () => {
  it('規制情報に同梱された設定（管理画面で変更された最新値）を優先する', async () => {
    const { effectiveFreshnessSettings } = await import('../src');
    const custom = { ...DEFAULT_FRESHNESS, restrictMode: 'block' as const };
    expect(effectiveFreshnessSettings({ ...snap(), freshness: custom }, DEFAULT_FRESHNESS)).toBe(custom);
    expect(effectiveFreshnessSettings(snap(), DEFAULT_FRESHNESS)).toBe(DEFAULT_FRESHNESS);
    expect(effectiveFreshnessSettings(null, DEFAULT_FRESHNESS)).toBe(DEFAULT_FRESHNESS);
  });
});
