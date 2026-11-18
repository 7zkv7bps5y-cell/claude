import { Alert, Linking, Platform } from 'react-native';

/**
 * 施設までの経路を、端末の地図アプリ（Apple マップ／Google マップ）で開く。
 * アプリ内での屋外経路案内は将来対応（費用と規約の確認が必要なため）。
 */
export function openDirections(lat: number, lng: number, name: string) {
  const apple = `http://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(name)}`;
  const google = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  if (Platform.OS === 'ios') {
    Alert.alert('経路を開く', `${name} までの経路を地図アプリで表示します`, [
      { text: 'Apple マップ', onPress: () => void Linking.openURL(apple) },
      { text: 'Google マップ', onPress: () => void Linking.openURL(google) },
      { text: 'キャンセル', style: 'cancel' },
    ]);
  } else {
    void Linking.openURL(google);
  }
}
