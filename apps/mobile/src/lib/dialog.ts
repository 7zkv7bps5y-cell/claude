import { Alert, Platform } from 'react-native';

/** 確認ダイアログ（iPhone/Android は標準ダイアログ、Web はブラウザの確認画面） */
export function confirmAsync(title: string, message: string, okLabel: string, cancelLabel = 'やめる'): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' ? window.confirm(`${title}\n\n${message}`) : false);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, onPress: () => resolve(true) },
    ]);
  });
}

export function notify(title: string, message: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}
