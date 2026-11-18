/** 画面全体の色・余白（地図アプリ風のデザイン） */
export const colors = {
  primary: '#1A73E8',
  primaryDark: '#1557B0',
  text: '#202124',
  textSub: '#5F6368',
  textMuted: '#80868B',
  border: '#DADCE0',
  surface: '#FFFFFF',
  surfaceAlt: '#F1F3F4',
  ok: '#188038',
  okBg: '#E6F4EA',
  warn: '#B06000',
  warnBg: '#FEF7E0',
  danger: '#C5221F',
  dangerBg: '#FCE8E6',
  route: '#1A73E8',
  // 屋内地図
  building: '#FFFFFF',
  buildingStroke: '#9AA0A6',
  corridor: '#F4F5F7',
  wall: '#7A828C',
  amenity: '#E8EAED',
  atrium: '#DCE6F2',
  parking: '#E9ECEF',
} as const;

export const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.16,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 4,
} as const;

export const radius = { s: 8, m: 12, l: 20, pill: 999 } as const;
