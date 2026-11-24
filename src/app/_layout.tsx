import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, useColorScheme } from 'react-native';
import { BackgroundJobs } from '@/components/BackgroundJobs';
import { KeyboardProvider } from '@/components/Keyboard';
import { LockScreen } from '@/components/LockScreen';
import { ReauthProvider } from '@/components/Reauth';
import { SecurityChecks } from '@/components/SecurityChecks';
import { ScreenshotNotice } from '@/components/ScreenshotNotice';
import { DECOY_DB, prepareDecoy } from '@/db/decoy';
import { keyStatement, PLAIN_DB, prepareDatabase, type PreparedDatabase } from '@/db/encryption';
import { migrateDbIfNeeded } from '@/db/schema';
import { ProProvider } from '@/lib/pro';
import { SecurityProvider, useSecurity } from '@/lib/security';
import { SettingsProvider, useSettings } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { tr } from '@/i18n';

/**
 * Home sits beneath any screen opened at launch (a dev reload or a link restoring e.g. /bill), so
 * closing it always lands somewhere. Safe because no screens are behind guards.
 */
export const unstable_settings = { anchor: '(tabs)' };

/** Form screens presented as modals over the current screen. */
const MODALS = ['transaction', 'budget', 'goal', 'contribute', 'bill', 'category', 'country', 'paywall', 'account', 'transfer', 'debt', 'group-form', 'iou', 'challenge'];

export default function RootLayout() {
  const t = useTheme();
  const base = useColorScheme() === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, primary: t.primary, background: t.bg, card: t.card, text: t.text, border: t.border },
  };

  return (
    <KeyboardProvider>
      <SecurityProvider>
        <DatabaseGate>
          <SettingsProvider>
            <ProProvider>
              <LanguageRoot>
                <ThemeProvider value={navTheme}>
                  <ReauthProvider>
                    <StatusBar style="auto" />
                    <BackgroundJobs />
                    <SecurityChecks />
                    <RootStack />
                    <ScreenshotNotice />
                  </ReauthProvider>
                </ThemeProvider>
              </LanguageRoot>
            </ProProvider>
          </SettingsProvider>
        </DatabaseGate>
        <LockScreen />
      </SecurityProvider>
    </KeyboardProvider>
  );
}

/** Re-mounts the app when the language changes, so every screen re-renders with the new strings. */
function LanguageRoot({ children }: { children: ReactNode }) {
  const { language } = useSettings();
  return <Fragment key={language}>{children}</Fragment>;
}

/**
 * Opens the (encrypted, where the build supports it) database before anything reads from it. After
 * an unlock with the panic PIN it opens the decoy instead (db/decoy.ts); the lock screen covers the
 * switch, and the whole app remounts on the other database.
 */
function DatabaseGate({ children }: { children: ReactNode }) {
  const [prepared, setPrepared] = useState<PreparedDatabase>();
  const { safeMode } = useSecurity();

  useEffect(() => {
    prepareDatabase().then(setPrepared, (e) => {
      console.warn('Database preparation failed', e);
      setPrepared({ name: PLAIN_DB, key: null });
    });
  }, []);

  useEffect(() => {
    if (!prepared?.unreadable) return;
    Alert.alert(
      tr('Your earlier data couldn’t be opened'),
      tr('This can happen after moving BudIT to a new phone, because its encryption key stays on the old one. You can restore your data from a BudIT backup in Settings.'),
    );
  }, [prepared?.unreadable]);

  const onInit = useCallback(
    async (db: SQLiteDatabase) => {
      if (!prepared) return;
      if (safeMode) {
        await migrateDbIfNeeded(db);
        await prepareDecoy(db, prepared);
        return;
      }
      if (prepared.key) await db.execAsync(keyStatement(prepared.key));
      await migrateDbIfNeeded(db);
    },
    [prepared, safeMode],
  );

  if (!prepared) return null;
  const name = safeMode ? DECOY_DB : prepared.name;
  return (
    <SQLiteProvider key={name} databaseName={name} onInit={onInit}>
      {children}
    </SQLiteProvider>
  );
}

/**
 * Every screen is always registered. The walkthrough is enforced by the tabs layout (it redirects
 * to /welcome until onboarding is done), not by guards, so a screen restored at launch can't make
 * the navigator redirect in a loop.
 */
function RootStack() {
  const t = useTheme();
  return (
    <Stack screenOptions={{ headerShadowVisible: false, headerTintColor: t.primary, headerTitleStyle: { color: t.text } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false, title: tr('Home') }} />
      <Stack.Screen name="welcome" options={{ headerShown: false, animation: 'fade', gestureEnabled: false }} />
      <Stack.Screen name="smart-budget" options={{ title: tr('Smart budget') }} />
      {MODALS.map((name) => (
        <Stack.Screen key={name} name={name} options={{ presentation: 'modal' }} />
      ))}
    </Stack>
  );
}
