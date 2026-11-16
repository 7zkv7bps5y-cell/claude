import type { FacilityBundle } from '@facility-nav/core';
import raw from './sample-facility.json';

/**
 * 【サンプル】架空の施設データ（開発・テスト専用）。
 * 実在の施設・店舗ではありません。facility.isSample = true。
 */
export const sampleFacility = raw as unknown as FacilityBundle;
export const SAMPLE_FACILITY_ID = sampleFacility.facility.id;
