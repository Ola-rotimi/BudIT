import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { router, Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { TimeField } from '@/components/DateField';
import { LanguagePicker } from '@/components/LanguagePicker';
import { PasswordPrompt } from '@/components/PasswordPrompt';
import { useAmountsToggle } from '@/components/HideAmountsButton';
import { PinSetup, type PinMode } from '@/components/PinSetup';
import { useReauth } from '@/components/Reauth';
import { useDeviceLooksRooted } from '@/components/SecurityChecks';
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
import { shortDate, toISODate } from '@/lib/dates';
import { PRIVACY_POLICY_URL } from '@/lib/links';
import { ensurePermission, readReminderSettings, saveReminderSetting } from '@/lib/reminders';
import { usePro } from '@/lib/pro';
import { CURRENCIES, formatMoney } from '@/lib/money';
import { biometricLabel, useSecurity } from '@/lib/security';
import { useSettings } from '@/lib/settings';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { tr, N_ } from '@/i18n';

const showError = (title: string, e: unknown) =>
  Alert.alert(title, e instanceof BackupError ? e.message : tr('Something went wrong. Please try again.'));

/** Lets a closing modal finish animating before the next sheet or alert is presented (iOS presents one at a time). */
const afterModal = (fn: () => void) => setTimeout(fn, 400);

type Prompt = { mode: 'create' } | { mode: 'enter'; envelope: EncryptedEnvelope };

const LOCK_AFTER: { value: string; label: string }[] = [
  { value: '0', label: N_('Immediately') },
  { value: '60', label: N_('1 min') },
  { value: '300', label: N_('5 min') },
];

export default function SettingsScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const { currency, currencyChosen, setCurrency, country, theme, setTheme, reload, setOnboarded, hideAmounts, monthStartDay, setMonthStartDay } =
    useSettings();
  const security = useSecurity();
  const confirm = useReauth();
  const rooted = useDeviceLooksRooted();
  const amounts = useAmountsToggle();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [pinMode, setPinMode] = useState<PinMode | null>(null);
  // Days since the last backup (null if never); undefined while loading.
  const backupAge = useQuery('settings:lastBackup', async (d) => {
    const last = await getSetting(d, LAST_BACKUP_KEY);
    return last ? Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000) : null;
  });
  const backupDue = backupAge === null || (backupAge !== undefined && backupAge >= BACKUP_REMINDER_DAYS);
  const reminders = useQuery('settings:reminders', readReminderSettings);

  const setReminder = async (key: 'bills' | 'daily' | 'backup', value: string) => {
    if (value && value !== '0' && !(await ensurePermission())) {
      return Alert.alert(tr('Notifications are off'), tr('Allow notifications for BudIT in your phone’s Settings to get reminders.'), [
        { text: tr('Not now'), style: 'cancel' },
        { text: tr('Open Settings'), onPress: () => Linking.openSettings() },
      ]);
    }
    await saveReminderSetting(db, key, value);
  };

  // Back to the tabs first; with onboarding reset, the tabs layout then redirects to the walkthrough.
  const replayTour = () => {
    if (router.canDismiss()) router.dismissAll();
    setOnboarded(false);
  };
  const homeCountry = getCountry(country);
  const pro = usePro();

  const restorePro = async () => {
    try {
      const restored = await pro.restore();
      Alert.alert(restored ? tr('Purchases restored') : tr('Nothing to restore'), restored ? tr('BudIT Pro is active.') : tr('No BudIT Pro purchase was found for this store account.'));
    } catch {
      Alert.alert(tr('Restore failed'), tr('Couldn’t reach the store. Check your connection and try again.'));
    }
  };

  const share = async (password?: string) => {
    try {
      await shareBackupFile(db, await createBackupFile(db, password));
    } catch (e) {
      showError(tr('Backup failed'), e);
    }
  };

  // Backups are password-protected unless the user deliberately opts out.
  const backup = async () => {
    if (await confirm(tr('Back up your data'))) setPrompt({ mode: 'create' });
  };

  const backupWithoutPassword = () => {
    setPrompt(null);
    afterModal(() =>
      Alert.alert(
        tr('Save without a password?'),
        tr('Anyone who gets hold of the file, for example in your email or cloud drive, could read all your finances.'),
        [
          { text: tr('Use a password'), onPress: () => afterModal(() => setPrompt({ mode: 'create' })) },
          { text: tr('Save unprotected'), style: 'destructive', onPress: () => share() },
        ],
      ),
    );
  };

  const onPassword = async (password: string): Promise<string | null> => {
    if (!prompt) return null;
    if (prompt.mode === 'create') {
      try {
        const file = await createBackupFile(db, password);
        setPrompt(null);
        afterModal(() => shareBackupFile(db, file).catch((e) => showError(tr('Backup failed'), e)));
      } catch (e) {
        return e instanceof BackupError ? e.message : tr('Couldn’t create the backup. Please try again.');
      }
      return null;
    }
    try {
      const snapshot = await unlockBackup(prompt.envelope, password);
      setPrompt(null);
      afterModal(() => confirmRestore(snapshot));
      return null;
    } catch (e) {
      if (e instanceof WrongPasswordError) return tr('That password is incorrect.');
      return e instanceof BackupError ? e.message : tr('That file couldn’t be opened.');
    }
  };

  const restore = async () => {
    if (!(await confirm(tr('Restore a backup')))) return;
    try {
      const picked = await pickBackup();
      if (!picked) return;
      if (picked.kind === 'encrypted') setPrompt({ mode: 'enter', envelope: picked.envelope });
      else confirmRestore(picked.snapshot);
    } catch (e) {
      showError(tr('Couldn’t open backup'), e);
    }
  };

  const confirmRestore = (file: BackupFile) => {
    const count = file.tables.transactions.length;
    Alert.alert(
      tr('Restore this backup?'),
      tr('Backup from {0} with {1} transaction{2}. It replaces ALL data currently in BudIT.', [shortDate(file.exportedAt.slice(0, 10)), count, count === 1 ? '' : 's']),
      [
        { text: tr('Cancel'), style: 'cancel' },
        {
          text: tr('Replace my data'),
          style: 'destructive',
          onPress: async () => {
            try {
              await restoreBackup(db, file);
              await reload();
              Alert.alert(tr('Backup restored'), tr('Your data has been restored.'));
            } catch (e) {
              showError(tr('Restore failed'), e);
            }
          },
        },
      ],
    );
  };

  const exportCsv = async () => {
    const { csv, count } = await exportTransactionsCsv(db);
    if (!count) return Alert.alert(tr('Nothing to export'), tr('Add some transactions first.'));
    if (!(await confirm(tr('Export your transactions')))) return;
    await Share.share({ title: tr('BudIT transactions'), message: csv });
  };

  const reset = async () => {
    if (!(await confirm(tr('Erase all data')))) return;
    Alert.alert(tr('Erase all data?'), tr('Deletes every transaction, budget, goal and bill on this device. Categories and settings are kept.'), [
      { text: tr('Cancel'), style: 'cancel' },
      { text: tr('Erase everything'), style: 'destructive', onPress: () => resetAllData(db) },
    ]);
  };

  const setPrivacy = async (on: boolean) => {
    if (!on && !(await confirm(tr('Turn off the privacy screen')))) return;
    await security.update({ privacy: on });
  };

  const safePinOptions = () =>
    Alert.alert(tr('Panic PIN'), tr('Entering your panic PIN instead of your real one opens BudIT with a made-up budget, so anyone forcing you to open it sees ordinary figures. Your real records stay hidden and untouched until you unlock with your real PIN.'), [
      { text: tr('Cancel'), style: 'cancel' },
      { text: tr('Change panic PIN'), onPress: () => setPinMode('safe') },
      {
        text: tr('Remove panic PIN'),
        style: 'destructive',
        onPress: async () => {
          if (await confirm(tr('Remove your panic PIN'))) await security.removeSafePin();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Settings') }} />

      <Card style={{ gap: 6 }}>
        <ListRow
          icon="sparkles"
          iconColor={t.accent}
          title={pro.isPro ? tr('BudIT Pro is active') : tr('Upgrade to BudIT Pro')}
          subtitle={
            pro.trial
              ? tr('Free trial until {0}', [shortDate(toISODate(new Date(pro.trial.endsAt)))])
              : pro.isPro
                ? tr('Thanks for supporting BudIT')
                : tr('Goals, bills, tax & pension, and every financial tool')
          }
          onPress={() => router.push('/paywall')}
        />
        {pro.isPro && pro.managementUrl ? (
          <>
            <Divider />
            <ListRow icon="card-outline" iconColor={t.primary} title={tr('Manage subscription')} onPress={() => Linking.openURL(pro.managementUrl!)} />
          </>
        ) : null}
        {!pro.isPro && pro.available ? (
          <>
            <Divider />
            <ListRow icon="refresh" iconColor={t.primary} title={tr('Restore purchases')} onPress={restorePro} chevron={false} />
          </>
        ) : null}
        {__DEV__ && (
          <>
            <Divider />
            <View style={styles.devRow}>
              <AppText variant="caption" style={{ flex: 1 }}>{tr('Developer: simulate Pro (development builds only)')}</AppText>
              <Switch value={pro.devOverride} onValueChange={pro.setDevOverride} trackColor={{ true: t.primary }} />
            </View>
          </>
        )}
      </Card>

      <Card style={{ gap: 6 }}>
        <AppText variant="label">{tr('SECURITY & PRIVACY')}</AppText>
        <ToggleRow
          icon="lock-closed-outline"
          title={tr('App lock')}
          subtitle={
            security.config.enabled ? tr('{0}-digit PIN{1}', [security.config.pinLength, security.config.biometrics && security.biometricKind ? tr(' or {0}', [biometricLabel(security.biometricKind)]) : '']) : tr('Ask for a PIN whenever BudIT opens')
          }
          value={security.config.enabled}
          onChange={(on) => setPinMode(on ? 'set' : 'disable')}
        />
        {security.config.enabled && (
          <>
            {security.biometricKind && (
              <>
                <Divider />
                <ToggleRow
                  icon={security.biometricKind === 'face' ? 'scan-outline' : 'finger-print'}
                  title={tr('Unlock with {0}', [biometricLabel(security.biometricKind)])}
                  subtitle={tr('Your PIN still works as a backup')}
                  value={security.config.biometrics}
                  onChange={(on) => security.update({ biometrics: on })}
                />
              </>
            )}
            <Divider />
            <View style={{ gap: 8, paddingVertical: 4 }}>
              <AppText weight="600">{tr('Lock after leaving BudIT')}</AppText>
              <Segmented
                value={String(security.config.timeout)}
                onChange={(v) => security.update({ timeout: Number(v) })}
                options={LOCK_AFTER.map((o) => ({ ...o, label: tr(o.label) }))}
              />
            </View>
            <Divider />
            <ListRow icon="keypad-outline" iconColor={t.primary} title={tr('Change PIN')} onPress={() => setPinMode('change')} />
            {/* In safe mode the safe PIN is never mentioned, so nothing gives it away. */}
            {!security.safeMode && (
              <>
                <Divider />
                <ListRow
                  icon="shield-half-outline"
                  iconColor={t.primary}
                  title={tr('Panic PIN')}
                  subtitle={security.config.safePin ? tr('On. Opens BudIT with a made-up budget') : tr('A second PIN for when someone forces you to open BudIT')}
                  onPress={security.config.safePin ? safePinOptions : () => setPinMode('safe')}
                />
              </>
            )}
          </>
        )}
        <Divider />
        <ToggleRow
          icon="eye-off-outline"
          title={tr('Privacy screen')}
          subtitle={tr('Hide BudIT in recent apps and block screenshots')}
          value={security.config.privacy}
          onChange={setPrivacy}
        />
        <Divider />
        <ToggleRow
          icon="eye-outline"
          title={tr('Hide amounts')}
          subtitle={tr('Show •••••• instead of balances. Showing them again asks for your PIN.')}
          value={amounts.hidden}
          onChange={(on) => (on === amounts.hidden ? undefined : amounts.toggle())}
        />
        {rooted && (
          <>
            <Divider />
            <View style={styles.devRow}>
              <Ionicons name="warning-outline" size={20} color={t.warning} />
              <AppText variant="caption" style={{ flex: 1 }}>
                {tr('This phone may be rooted or jailbroken, which weakens BudIT’s encryption and app lock.')}
              </AppText>
            </View>
          </>
        )}
      </Card>

      {reminders && (
        <Card style={{ gap: 6 }}>
          <AppText variant="label">{tr('REMINDERS')}</AppText>
          <ToggleRow
            icon="calendar-outline"
            title={tr('Bill reminders')}
            subtitle={pro.isPro ? tr('A notification the day before each bill is due') : tr('BudIT Pro: get notified before bills are due')}
            value={reminders.bills && pro.isPro}
            onChange={(on) => (pro.isPro ? setReminder('bills', on ? '1' : '0') : router.push('/paywall'))}
          />
          <Divider />
          <ToggleRow
            icon="notifications-outline"
            title={tr('Daily reminder')}
            subtitle={tr('A gentle nudge to log the day’s spending')}
            value={!!reminders.daily}
            onChange={(on) => setReminder('daily', on ? '20:00' : '')}
          />
          {!!reminders.daily && <TimeField label={tr('Remind me at')} value={reminders.daily} onChange={(v) => setReminder('daily', v)} />}
          <Divider />
          <ToggleRow
            icon="cloud-upload-outline"
            title={tr('Backup reminders')}
            subtitle={tr('A notification when your last backup is {0} days old', [BACKUP_REMINDER_DAYS])}
            value={reminders.backup}
            onChange={(on) => setReminder('backup', on ? '1' : '0')}
          />
          {(security.config.enabled || hideAmounts) && (
            <AppText variant="caption">{tr('Amounts are left out of notifications while app lock or hide amounts is on.')}</AppText>
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
            <AppText weight="700">{homeCountry?.name ?? tr('Choose your country')}</AppText>
            <AppText variant="caption">{tr('Sets your currency and the tax & pension presets')}</AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.muted} />
        </Pressable>
      </Card>

      <Card>
        <AppText variant="heading">{tr('Language')}</AppText>
        <LanguagePicker />
        <AppText variant="caption">{tr('Hausa, Yoruba and Pidgin are first drafts. Suggestions from native speakers are welcome.')}</AppText>
      </Card>

      <Card>
        <AppText variant="heading">{tr('Appearance')}</AppText>
        <Segmented<ThemePreference>
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: tr('System') },
            { value: 'light', label: tr('Light') },
            { value: 'dark', label: tr('Dark') },
          ]}
        />
      </Card>

      <Card>
        <AppText variant="heading">{tr('Budget month')}</AppText>
        <AppText variant="caption">
          {monthStartDay === 1 ? tr('Budgets and totals follow calendar months. If you’re paid on a set day, start each month on payday instead.') : tr('Each budget month runs from day {0} to day {1} of the next month, payday to payday.', [monthStartDay, monthStartDay - 1])}
        </AppText>
        <View style={styles.stepper}>
          <Pressable
            onPress={() => setMonthStartDay(monthStartDay - 1)}
            disabled={monthStartDay <= 1}
            accessibilityRole="button"
            accessibilityLabel={tr('Earlier day')}
            hitSlop={8}
            style={[styles.stepButton, { borderColor: t.border, opacity: monthStartDay <= 1 ? 0.4 : 1 }]}>
            <Ionicons name="remove" size={20} color={t.primary} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <AppText weight="700">{monthStartDay === 1 ? tr('1st (calendar month)') : tr('Starts on day {0}', [monthStartDay])}</AppText>
          </View>
          <Pressable
            onPress={() => setMonthStartDay(monthStartDay + 1)}
            disabled={monthStartDay >= 28}
            accessibilityRole="button"
            accessibilityLabel={tr('Later day')}
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
        <AppText variant="heading">{tr('Currency')}</AppText>
        <AppText variant="caption">{tr('Example: {0}. Changing currency relabels amounts; it does not convert them.', [formatMoney(123456, currency)])}</AppText>
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
        <ListRow icon="pricetags" iconColor="#EC4899" title={tr('Categories')} subtitle={tr('Add, edit or archive')} onPress={() => router.push('/categories')} />
        <Divider />
        <ListRow icon="map-outline" iconColor="#0EA5E9" title={tr('Replay walkthrough')} subtitle={tr('The quick tour shown on first launch')} onPress={replayTour} />
      </Card>

      <Card style={{ gap: 6 }}>
        <AppText variant="label">{tr('YOUR DATA')}</AppText>
        <ListRow
          icon="cloud-upload-outline"
          iconColor={t.primary}
          title={tr('Back up data')}
          subtitle={
            backupAge === undefined ? tr('Save an encrypted backup to Files, Drive or email') : backupAge === null ? tr('Not backed up yet. Save an encrypted file to Files, Drive or email') : tr('Last backup {0}. Encrypted with your password', [backupAge === 0 ? tr('today') : tr('{0} day{1} ago', [backupAge, backupAge === 1 ? '' : 's'])])
          }
          right={backupDue ? <Ionicons name="alert-circle" size={20} color={t.warning} accessibilityLabel={tr('Backup due')} /> : undefined}
          onPress={backup}
        />
        <Divider />
        <ListRow
          icon="cloud-download-outline"
          iconColor={t.primary}
          title={tr('Restore from backup')}
          subtitle={tr('Replace this device’s data with a backup file')}
          onPress={restore}
        />
        <Divider />
        <ListRow icon="share-outline" iconColor="#3B82F6" title={tr('Export transactions')} subtitle={tr('Share all transactions as CSV')} onPress={exportCsv} />
        <Divider />
        <ListRow
          icon="trash-outline"
          iconColor={t.expense}
          title={tr('Erase all data')}
          subtitle={tr('Start over with a clean slate')}
          onPress={reset}
          chevron={false}
        />
      </Card>

      <Card style={{ gap: 6 }}>
        <ListRow
          icon="shield-checkmark-outline"
          iconColor={t.primary}
          title={tr('Privacy policy')}
          subtitle={tr('How BudIT handles your data')}
          onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
        />
      </Card>

      <View style={styles.about}>
        <Ionicons name="lock-closed-outline" size={16} color={t.muted} />
        <AppText variant="caption" style={{ textAlign: 'center' }}>{tr('Your data stays on this device, encrypted in store builds. Uninstalling BudIT deletes it, so back up regularly.')}</AppText>
        <AppText variant="caption">{tr('BudIT {0}', [Constants.expoConfig?.version ?? ''])}</AppText>
      </View>

      <PinSetup mode={pinMode} onClose={() => setPinMode(null)} />
      <PasswordPrompt
        visible={!!prompt}
        mode={prompt?.mode ?? 'enter'}
        title={prompt?.mode === 'create' ? tr('Set a backup password') : tr('This backup is locked')}
        message={
          prompt?.mode === 'create' ? tr('The backup file will be encrypted with this password. You’ll need it to restore.') : tr('Enter the password that was used when this backup was made.')
        }
        onSubmit={onPassword}
        onCancel={() => setPrompt(null)}
        secondary={prompt?.mode === 'create' ? { label: tr('Save without a password'), onPress: backupWithoutPassword } : undefined}
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
