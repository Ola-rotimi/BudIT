import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { router, Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { TimeField } from '@/components/DateField';
import { PasswordPrompt } from '@/components/PasswordPrompt';
import { AppText, Card, Divider, ListRow, Screen, Segmented } from '@/components/ui';
import { exportTransactionsCsv, getSetting, resetAllData } from '@/db/queries';
import type { IconName } from '@/db/types';
import { useQuery } from '@/hooks/useQuery';
import {
  BACKUP_REMINDER_DAYS,
  BackupError,
  createBackupFile,
  LAST_BACKUP_KEY,
  pickBackup,
  restoreBackup,
  shareBackupFile,
  unlockBackup,
  type BackupFile,
  type EncryptedEnvelope,
} from '@/lib/backup';
import { getCountry } from '@/lib/countries';
import { WrongPasswordError } from '@/lib/crypto';
import { shortDate } from '@/lib/dates';
import { PRIVACY_POLICY_URL } from '@/lib/links';
import { ensurePermission, readReminderSettings, saveReminderSetting } from '@/lib/reminders';
import { usePro } from '@/lib/pro';
import { CURRENCIES, formatMoney } from '@/lib/money';
import { biometricLabel, useSecurity } from '@/lib/security';
import { useSettings } from '@/lib/settings';
import { useTheme, type ThemePreference } from '@/lib/theme';

const showError = (title: string, e: unknown) =>
  Alert.alert(title, e instanceof BackupError ? e.message : 'Something went wrong. Please try again.');

/** Lets a closing modal finish animating before the next sheet or alert is presented (iOS presents one at a time). */
const afterModal = (fn: () => void) => setTimeout(fn, 400);

type Prompt = { mode: 'create' } | { mode: 'enter'; envelope: EncryptedEnvelope };

const LOCK_AFTER: { value: string; label: string }[] = [
  { value: '0', label: 'Immediately' },
  { value: '60', label: '1 min' },
  { value: '300', label: '5 min' },
];

export default function SettingsScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const { currency, currencyChosen, setCurrency, country, theme, setTheme, reload, setOnboarded, hideAmounts, setHideAmounts, monthStartDay, setMonthStartDay } =
    useSettings();
  const security = useSecurity();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  // Days since the last backup (null if never); undefined while loading.
  const backupAge = useQuery('settings:lastBackup', async (d) => {
    const last = await getSetting(d, LAST_BACKUP_KEY);
    return last ? Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000) : null;
  });
  const backupDue = backupAge === null || (backupAge !== undefined && backupAge >= BACKUP_REMINDER_DAYS);
  const reminders = useQuery('settings:reminders', readReminderSettings);

  const setReminder = async (key: 'bills' | 'daily', value: string) => {
    if (value && value !== '0' && !(await ensurePermission())) {
      return Alert.alert('Notifications are off', 'Allow notifications for BudT in your phone’s Settings to get reminders.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
    }
    await saveReminderSetting(db, key, value);
  };

  // Back to the tabs first so the walkthrough (which replaces them) has nothing stacked above it.
  const replayTour = () => {
    router.dismissAll();
    setOnboarded(false);
  };
  const homeCountry = getCountry(country);
  const pro = usePro();

  const restorePro = async () => {
    try {
      const restored = await pro.restore();
      Alert.alert(restored ? 'Purchases restored' : 'Nothing to restore', restored ? 'BudT Pro is active.' : 'No BudT Pro purchase was found for this store account.');
    } catch {
      Alert.alert('Restore failed', 'Couldn’t reach the store. Check your connection and try again.');
    }
  };

  const share = async (password?: string) => {
    try {
      await shareBackupFile(db, await createBackupFile(db, password));
    } catch (e) {
      showError('Backup failed', e);
    }
  };

  const backup = () =>
    Alert.alert('Protect this backup with a password?', 'A password encrypts the file, so nobody who finds it can read your finances.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'No password', onPress: () => share() },
      { text: 'Add password', onPress: () => setPrompt({ mode: 'create' }) },
    ]);

  const onPassword = async (password: string): Promise<string | null> => {
    if (!prompt) return null;
    if (prompt.mode === 'create') {
      try {
        const file = await createBackupFile(db, password);
        setPrompt(null);
        afterModal(() => shareBackupFile(db, file).catch((e) => showError('Backup failed', e)));
      } catch (e) {
        return e instanceof BackupError ? e.message : 'Couldn’t create the backup. Please try again.';
      }
      return null;
    }
    try {
      const snapshot = await unlockBackup(prompt.envelope, password);
      setPrompt(null);
      afterModal(() => confirmRestore(snapshot));
      return null;
    } catch (e) {
      if (e instanceof WrongPasswordError) return 'That password is incorrect.';
      return e instanceof BackupError ? e.message : 'That file couldn’t be opened.';
    }
  };

  const restore = async () => {
    try {
      const picked = await pickBackup();
      if (!picked) return;
      if (picked.kind === 'encrypted') setPrompt({ mode: 'enter', envelope: picked.envelope });
      else confirmRestore(picked.snapshot);
    } catch (e) {
      showError('Couldn’t open backup', e);
    }
  };

  const confirmRestore = (file: BackupFile) => {
    const count = file.tables.transactions.length;
    Alert.alert(
      'Restore this backup?',
      `Backup from ${shortDate(file.exportedAt.slice(0, 10))} with ${count} transaction${count === 1 ? '' : 's'}. It replaces ALL data currently in BudT.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace my data',
          style: 'destructive',
          onPress: async () => {
            try {
              await restoreBackup(db, file);
              await reload();
              Alert.alert('Backup restored', 'Your data has been restored.');
            } catch (e) {
              showError('Restore failed', e);
            }
          },
        },
      ],
    );
  };

  const exportCsv = async () => {
    const { csv, count } = await exportTransactionsCsv(db);
    if (!count) return Alert.alert('Nothing to export', 'Add some transactions first.');
    await Share.share({ title: 'BudT transactions', message: csv });
  };

  const reset = () =>
    Alert.alert('Erase all data?', 'Deletes every transaction, budget, goal and bill on this device. Categories and settings are kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Erase everything', style: 'destructive', onPress: () => resetAllData(db) },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Settings' }} />

      <Card style={{ gap: 6 }}>
        <ListRow
          icon="sparkles"
          iconColor={t.accent}
          title={pro.isPro ? 'BudT Pro is active' : 'Upgrade to BudT Pro'}
          subtitle={pro.isPro ? 'Thanks for supporting BudT' : 'Goals, bills, tax & pension, and every financial tool'}
          onPress={() => router.push('/paywall')}
        />
        {pro.isPro && pro.managementUrl ? (
          <>
            <Divider />
            <ListRow icon="card-outline" iconColor={t.primary} title="Manage subscription" onPress={() => Linking.openURL(pro.managementUrl!)} />
          </>
        ) : null}
        {!pro.isPro && pro.available ? (
          <>
            <Divider />
            <ListRow icon="refresh" iconColor={t.primary} title="Restore purchases" onPress={restorePro} chevron={false} />
          </>
        ) : null}
        {__DEV__ && (
          <>
            <Divider />
            <View style={styles.devRow}>
              <AppText variant="caption" style={{ flex: 1 }}>
                Developer: simulate Pro (development builds only)
              </AppText>
              <Switch value={pro.devOverride} onValueChange={pro.setDevOverride} trackColor={{ true: t.primary }} />
            </View>
          </>
        )}
      </Card>

      <Card style={{ gap: 6 }}>
        <AppText variant="label">SECURITY & PRIVACY</AppText>
        <ToggleRow
          icon="lock-closed-outline"
          title="App lock"
          subtitle={
            security.config.enabled
              ? `${security.config.pinLength}-digit PIN${security.config.biometrics && security.biometricKind ? ` or ${biometricLabel(security.biometricKind)}` : ''}`
              : 'Ask for a PIN whenever BudT opens'
          }
          value={security.config.enabled}
          onChange={(on) => router.push({ pathname: '/pin', params: { mode: on ? 'set' : 'disable' } })}
        />
        {security.config.enabled && (
          <>
            {security.biometricKind && (
              <>
                <Divider />
                <ToggleRow
                  icon={security.biometricKind === 'face' ? 'scan-outline' : 'finger-print'}
                  title={`Unlock with ${biometricLabel(security.biometricKind)}`}
                  subtitle="Your PIN still works as a backup"
                  value={security.config.biometrics}
                  onChange={(on) => security.update({ biometrics: on })}
                />
              </>
            )}
            <Divider />
            <View style={{ gap: 8, paddingVertical: 4 }}>
              <AppText weight="600">Lock after leaving BudT</AppText>
              <Segmented
                value={String(security.config.timeout)}
                onChange={(v) => security.update({ timeout: Number(v) })}
                options={LOCK_AFTER}
              />
            </View>
            <Divider />
            <ListRow icon="keypad-outline" iconColor={t.primary} title="Change PIN" onPress={() => router.push({ pathname: '/pin', params: { mode: 'change' } })} />
          </>
        )}
        <Divider />
        <ToggleRow
          icon="eye-off-outline"
          title="Privacy screen"
          subtitle="Hide BudT in recent apps and block screenshots"
          value={security.config.privacy}
          onChange={(on) => security.update({ privacy: on })}
        />
        <Divider />
        <ToggleRow
          icon="eye-outline"
          title="Hide amounts"
          subtitle="Show •••••• instead of balances. Tap the eye on Home to switch."
          value={hideAmounts}
          onChange={setHideAmounts}
        />
      </Card>

      {reminders && (
        <Card style={{ gap: 6 }}>
          <AppText variant="label">REMINDERS</AppText>
          <ToggleRow
            icon="calendar-outline"
            title="Bill reminders"
            subtitle={pro.isPro ? 'A notification the day before each bill is due' : 'BudT Pro: get notified before bills are due'}
            value={reminders.bills && pro.isPro}
            onChange={(on) => (pro.isPro ? setReminder('bills', on ? '1' : '0') : router.push('/paywall'))}
          />
          <Divider />
          <ToggleRow
            icon="notifications-outline"
            title="Daily reminder"
            subtitle="A gentle nudge to log the day’s spending"
            value={!!reminders.daily}
            onChange={(on) => setReminder('daily', on ? '20:00' : '')}
          />
          {!!reminders.daily && <TimeField label="Remind me at" value={reminders.daily} onChange={(v) => setReminder('daily', v)} />}
          {(security.config.enabled || hideAmounts) && (
            <AppText variant="caption">Amounts are left out of notifications while app lock or hide amounts is on.</AppText>
          )}
        </Card>
      )}

      <Card style={{ gap: 6 }}>
        <Pressable
          onPress={() => router.push({ pathname: '/country', params: { purpose: 'home' } })}
          accessibilityRole="button"
          style={({ pressed }) => [styles.countryRow, pressed && { opacity: 0.6 }]}>
          <Text style={styles.flag}>{homeCountry?.flag ?? '🌍'}</Text>
          <View style={{ flex: 1 }}>
            <AppText weight="700">{homeCountry?.name ?? 'Choose your country'}</AppText>
            <AppText variant="caption">Sets your currency and the tax & pension presets</AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.muted} />
        </Pressable>
      </Card>

      <Card>
        <AppText variant="heading">Appearance</AppText>
        <Segmented<ThemePreference>
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Card>

      <Card>
        <AppText variant="heading">Budget month</AppText>
        <AppText variant="caption">
          {monthStartDay === 1
            ? 'Budgets and totals follow calendar months. If you’re paid on a set day, start each month on payday instead.'
            : `Each budget month runs from day ${monthStartDay} to day ${monthStartDay - 1} of the next month, payday to payday.`}
        </AppText>
        <View style={styles.stepper}>
          <Pressable
            onPress={() => setMonthStartDay(monthStartDay - 1)}
            disabled={monthStartDay <= 1}
            accessibilityRole="button"
            accessibilityLabel="Earlier day"
            hitSlop={8}
            style={[styles.stepButton, { borderColor: t.border, opacity: monthStartDay <= 1 ? 0.4 : 1 }]}>
            <Ionicons name="remove" size={20} color={t.primary} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <AppText weight="700">{monthStartDay === 1 ? '1st (calendar month)' : `Starts on day ${monthStartDay}`}</AppText>
          </View>
          <Pressable
            onPress={() => setMonthStartDay(monthStartDay + 1)}
            disabled={monthStartDay >= 28}
            accessibilityRole="button"
            accessibilityLabel="Later day"
            hitSlop={8}
            style={[styles.stepButton, { borderColor: t.border, opacity: monthStartDay >= 28 ? 0.4 : 1 }]}>
            <Ionicons name="add" size={20} color={t.primary} />
          </Pressable>
        </View>
        <View style={styles.grid}>
          {[1, 15, 20, 25, 28].map((day) => (
            <Pressable
              key={day}
              onPress={() => setMonthStartDay(day)}
              accessibilityRole="button"
              accessibilityState={{ selected: day === monthStartDay }}
              style={[styles.currency, { borderColor: day === monthStartDay ? t.primary : t.border, backgroundColor: day === monthStartDay ? t.primarySoft : t.inputBg }]}>
              <Text style={{ color: day === monthStartDay ? t.primary : t.text, fontWeight: '700' }}>{day}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card>
        <AppText variant="heading">Currency</AppText>
        <AppText variant="caption">
          Example: {formatMoney(123456, currency)}. Changing currency relabels amounts; it does not convert them.
        </AppText>
        <View style={styles.grid}>
          {CURRENCIES.map((code) => {
            const active = currencyChosen && code === currency;
            return (
              <Pressable
                key={code}
                onPress={() => setCurrency(code)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.currency, { borderColor: active ? t.primary : t.border, backgroundColor: active ? t.primarySoft : t.inputBg }]}>
                <Text style={{ color: active ? t.primary : t.text, fontWeight: '700' }}>{code}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card style={{ gap: 6 }}>
        <ListRow icon="pricetags" iconColor="#EC4899" title="Categories" subtitle="Add, edit or archive" onPress={() => router.push('/categories')} />
        <Divider />
        <ListRow icon="map-outline" iconColor="#0EA5E9" title="Replay walkthrough" subtitle="The quick tour shown on first launch" onPress={replayTour} />
      </Card>

      <Card style={{ gap: 6 }}>
        <AppText variant="label">YOUR DATA</AppText>
        <ListRow
          icon="cloud-upload-outline"
          iconColor={t.primary}
          title="Back up data"
          subtitle={
            backupAge === undefined
              ? 'Save a backup file to Files, Drive or email'
              : backupAge === null
              ? 'Not backed up yet. Save a file to Files, Drive or email'
              : `Last backup ${backupAge === 0 ? 'today' : `${backupAge} day${backupAge === 1 ? '' : 's'} ago`}. Password protection available`
          }
          right={backupDue ? <Ionicons name="alert-circle" size={20} color={t.warning} accessibilityLabel="Backup due" /> : undefined}
          onPress={backup}
        />
        <Divider />
        <ListRow
          icon="cloud-download-outline"
          iconColor={t.primary}
          title="Restore from backup"
          subtitle="Replace this device’s data with a backup file"
          onPress={restore}
        />
        <Divider />
        <ListRow icon="share-outline" iconColor="#3B82F6" title="Export transactions" subtitle="Share all transactions as CSV" onPress={exportCsv} />
        <Divider />
        <ListRow
          icon="trash-outline"
          iconColor={t.expense}
          title="Erase all data"
          subtitle="Start over with a clean slate"
          onPress={reset}
          chevron={false}
        />
      </Card>

      <Card style={{ gap: 6 }}>
        <ListRow
          icon="shield-checkmark-outline"
          iconColor={t.primary}
          title="Privacy policy"
          subtitle="How BudT handles your data"
          onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
        />
      </Card>

      <View style={styles.about}>
        <Ionicons name="lock-closed-outline" size={16} color={t.muted} />
        <AppText variant="caption" style={{ textAlign: 'center' }}>
          Your data stays on this device, encrypted in store builds. Uninstalling BudT deletes it, so back up regularly.
        </AppText>
        <AppText variant="caption">BudT {Constants.expoConfig?.version ?? ''}</AppText>
      </View>

      <PasswordPrompt
        visible={!!prompt}
        mode={prompt?.mode ?? 'enter'}
        title={prompt?.mode === 'create' ? 'Set a backup password' : 'This backup is locked'}
        message={
          prompt?.mode === 'create'
            ? 'The backup file will be encrypted with this password. You’ll need it to restore.'
            : 'Enter the password that was used when this backup was made.'
        }
        onSubmit={onPassword}
        onCancel={() => setPrompt(null)}
      />
    </Screen>
  );
}

function ToggleRow({
  icon,
  title,
  subtitle,
  value,
  onChange,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (on: boolean) => void;
}) {
  const t = useTheme();
  return (
    <ListRow
      icon={icon}
      iconColor={t.primary}
      title={title}
      subtitle={subtitle}
      right={<Switch value={value} onValueChange={onChange} trackColor={{ true: t.primary }} accessibilityLabel={title} />}
      onPress={() => onChange(!value)}
      chevron={false}
    />
  );
}

const styles = StyleSheet.create({
  devRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  countryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  flag: { fontSize: 30 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  currency: { width: 64, minHeight: 40, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  about: { alignItems: 'center', gap: 6, paddingHorizontal: 24 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepButton: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
