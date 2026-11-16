import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppDataProvider } from '../data/AppDataContext';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppDataProvider>
        <StatusBar style="dark" />
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="debug" options={{ title: '検証画面（Phase 1A）' }} />
        </Stack>
      </AppDataProvider>
    </SafeAreaProvider>
  );
}
