import type { RouteRule, RouteRulesSnapshot, RuleFreshnessSettings } from './types';

/** 指定時刻に有効な規制だけを返す（オフラインでも期限切れ・開始を端末内で判断できる） */
export function activeRulesAt(rules: RouteRule[], now: Date): RouteRule[] {
  const t = now.getTime();
  return rules.filter((r) => {
    if (r.startsAt && Date.parse(r.startsAt) > t) return false;
    if (r.endsAt && Date.parse(r.endsAt) <= t) return false;
    return true;
  });
}

export type FreshnessLevel = 'fresh' | 'stale' | 'restricted';

export interface FreshnessAssessment {
  level: FreshnessLevel;
  /** 最終取得からの経過分（未取得なら null） */
  ageMinutes: number | null;
  /** 経路案内: allow=通常 / confirm=確認後に参考案内 / block=停止 */
  routing: 'allow' | 'confirm' | 'block';
  /** 保存済み情報に基づく「参考案内」として表示すべきか */
  isReferenceOnly: boolean;
  /** 「制限」判定に使ったしきい値（分） */
  restrictThresholdMinutes: number;
  /** 利用者向けの説明文 */
  message: string;
  /** 判定理由（ログ・画面のデバッグ表示用） */
  reason:
    | 'fresh'
    | 'stale'
    | 'too_old'
    | 'never_fetched'
    | 'clock_went_back'
    | 'high_severity_or_event';
}

/** 規制情報に同梱された最新の設定を優先し、なければ施設データの設定を使う */
export function effectiveFreshnessSettings(
  snapshot: RouteRulesSnapshot | null,
  fallback: RuleFreshnessSettings,
): RuleFreshnessSettings {
  return snapshot?.freshness ?? fallback;
}

export const DEFAULT_FRESHNESS: RuleFreshnessSettings = {
  freshMinutes: 15,
  restrictMinutes: 360,
  highSeverityRestrictMinutes: 60,
  restrictMode: 'confirm',
  eventMode: false,
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 経路規制情報の鮮度を3段階で判定する（設計書 4-5）。
 *
 * - 正常(fresh)：通常どおり案内
 * - 注意(stale)：参考案内として表示し、最終取得時刻を常時表示
 * - 制限(restricted)：restrictMode に従い、確認後の参考案内 または 案内停止
 *
 * 安全上重要な規制（severity=high）を保存している場合や、イベント中の施設では、
 * より短いしきい値（highSeverityRestrictMinutes）で「制限」に移行する。
 */
export function assessRuleFreshness(
  snapshot: RouteRulesSnapshot | null,
  settings: RuleFreshnessSettings,
  now: Date,
): FreshnessAssessment {
  const blockOrConfirm = settings.restrictMode === 'block' ? 'block' : 'confirm';
  const restrictedMsg =
    settings.restrictMode === 'block'
      ? '最新の通行規制情報を確認できないため、経路案内を停止しています。地図と店舗検索はご利用いただけます。'
      : '最新の通行規制情報を確認できません。案内は保存済み情報に基づく参考案内で、実際と異なる可能性があります。';

  if (!snapshot) {
    return {
      level: 'restricted',
      ageMinutes: null,
      routing: blockOrConfirm,
      isReferenceOnly: true,
      restrictThresholdMinutes: 0,
      message: `通行規制情報をまだ取得できていません。${restrictedMsg}`,
      reason: 'never_fetched',
    };
  }

  const hasHigh = snapshot.rules.some((r) => r.severity === 'high');
  const strict = hasHigh || settings.eventMode;
  const restrictThreshold = strict
    ? Math.min(settings.highSeverityRestrictMinutes, settings.restrictMinutes)
    : settings.restrictMinutes;

  const ageMs = now.getTime() - Date.parse(snapshot.fetchedAt);
  const ageMinutes = ageMs / 60_000;
  const at = fmtTime(snapshot.fetchedAt);

  // 端末の時計が巻き戻った等で経過時間が負になる場合は、鮮度を保証できないので「注意」以上として扱う
  if (ageMs < -60_000) {
    return {
      level: 'stale',
      ageMinutes,
      routing: 'allow',
      isReferenceOnly: true,
      restrictThresholdMinutes: restrictThreshold,
      message: `端末の時刻に問題がある可能性があります。通行規制情報は ${at} 時点のものです。現地の案内表示もご確認ください。`,
      reason: 'clock_went_back',
    };
  }

  if (ageMinutes > restrictThreshold) {
    return {
      level: 'restricted',
      ageMinutes,
      routing: blockOrConfirm,
      isReferenceOnly: true,
      restrictThresholdMinutes: restrictThreshold,
      message: `通行規制情報は ${at} 時点のものです。${restrictedMsg}`,
      reason: strict && ageMinutes <= settings.restrictMinutes ? 'high_severity_or_event' : 'too_old',
    };
  }

  if (ageMinutes > settings.freshMinutes) {
    return {
      level: 'stale',
      ageMinutes,
      routing: 'allow',
      isReferenceOnly: true,
      restrictThresholdMinutes: restrictThreshold,
      message: `通行規制情報は ${at} 時点のものです（保存済み情報に基づく参考案内）。現地の案内表示もご確認ください。`,
      reason: 'stale',
    };
  }

  return {
    level: 'fresh',
    ageMinutes,
    routing: 'allow',
    isReferenceOnly: false,
    restrictThresholdMinutes: restrictThreshold,
    message: `通行規制情報は最新です（${at} 取得）。`,
    reason: 'fresh',
  };
}
