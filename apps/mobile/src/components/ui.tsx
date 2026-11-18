import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, shadow } from '../theme';

type IconName = keyof typeof Ionicons.glyphMap;

export function RoundButton({
  icon,
  label,
  onPress,
  active,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  testID?: string;
}) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={[styles.round, active && styles.roundActive]} testID={testID}>
      <Ionicons name={icon} size={20} color={active ? '#fff' : colors.textSub} />
    </Pressable>
  );
}

export function Chip({
  label,
  icon,
  color,
  selected,
  onPress,
}: {
  label: string;
  icon?: IconName;
  color?: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={[styles.chip, selected && { backgroundColor: color ?? colors.primary, borderColor: color ?? colors.primary }]}>
      {icon && <Ionicons name={icon} size={14} color={selected ? '#fff' : (color ?? colors.textSub)} />}
      <Text style={[styles.chipText, selected && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export function PrimaryButton({ label, icon, onPress, testID, kind = 'primary' }: { label: string; icon?: IconName; onPress: () => void; testID?: string; kind?: 'primary' | 'secondary' }) {
  const primary = kind === 'primary';
  return (
    <Pressable onPress={onPress} style={[styles.btn, primary ? styles.btnPrimary : styles.btnSecondary]} testID={testID}>
      {icon && <Ionicons name={icon} size={18} color={primary ? '#fff' : colors.primary} />}
      <Text style={[styles.btnText, { color: primary ? '#fff' : colors.primary }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View style={[styles.card, style]} testID={testID}>
      {children}
    </View>
  );
}

export function Badge({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow },
  roundActive: { backgroundColor: colors.primary },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow,
    shadowOpacity: 0.08,
  },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '500' },
  btn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', height: 44, borderRadius: radius.pill },
  btnPrimary: { backgroundColor: colors.primary },
  btnSecondary: { backgroundColor: '#E8F0FE' },
  btnText: { fontSize: 15, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderRadius: radius.l, padding: 16, ...shadow },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
});
