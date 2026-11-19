import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { biometricLabel, useSecurity } from '@/lib/security';
import { useTheme } from '@/lib/theme';
import { PinPad } from './PinPad';
import { AppText } from './ui';
import { tr } from '@/i18n';

/**
 * Covers the whole app while it's locked, and hides it while it's in the background.
 * A native Modal is used so it also sits above screens presented as modals.
 */
export function LockScreen() {
  const security = useSecurity();
  const { locked, obscured } = security;
  return (
    <Modal visible={locked || obscured} animationType="fade" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={() => {}}>
      {locked ? <LockedView /> : <PrivacyCover />}
    </Modal>
  );
}

function PrivacyCover() {
  const t = useTheme();
  return (
    <View style={[styles.center, { backgroundColor: t.bg }]}>
      <Image source={require('../../assets/icon.png')} style={styles.icon} accessibilityIgnoresInvertColors />
    </View>
  );
}

function LockedView() {
  const t = useTheme();
  const { config, biometricKind, lockedUntil, unlockWithPin, unlockWithBiometrics, unlockWithDeviceCredentials } = useSecurity();
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const canBiometric = config.biometrics && !!biometricKind;
  const waiting = lockedUntil > now;

  // Offer biometrics once, straight away, each time the lock appears. (The prompt itself makes iOS
  // report the app as inactive, which re-renders this; the ref stops it prompting again.)
  const prompted = useRef(false);
  useEffect(() => {
    if (!canBiometric || prompted.current) return;
    prompted.current = true;
    unlockWithBiometrics();
  }, [canBiometric, unlockWithBiometrics]);

  // Tick while locked out so the countdown updates and the pad re-enables itself.
  useEffect(() => {
    if (!lockedUntil) return;
    const id = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= lockedUntil) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  const submit = async (pin: string) => {
    const result = await unlockWithPin(pin);
    if (result.ok) return true;
    setMessage(result.attemptsLeft > 0 ? tr('Wrong PIN. {0} attempt{1} left before a wait.', [result.attemptsLeft, result.attemptsLeft === 1 ? '' : 's']) : tr('Wrong PIN.'));
    return false;
  };

  const forgot = async () => {
    if (await unlockWithDeviceCredentials()) return;
    Alert.alert(
      tr('Can’t unlock'),
      tr('BudIT can be unlocked with your PIN, or with your phone’s own passcode or biometrics. If none of these work, reinstalling BudIT erases its data, and you can then restore a backup.'),
    );
  };

  const seconds = Math.ceil((lockedUntil - now) / 1000);

  return (
    <SafeAreaView style={[styles.locked, { backgroundColor: t.bg }]}>
      <View style={{ alignItems: 'center', gap: 10 }}>
        <Image source={require('../../assets/icon.png')} style={styles.iconSmall} accessibilityIgnoresInvertColors />
        <AppText variant="heading">{tr('Enter your BudIT PIN')}</AppText>
        <AppText variant="caption" color={waiting || message ? t.expense : t.muted} style={{ textAlign: 'center' }}>
          {waiting ? tr('Too many attempts. Try again in {0}.', [seconds >= 60 ? tr('{0} min', [Math.ceil(seconds / 60)]) : `${seconds}s`]) : (message ?? ' ')}
        </AppText>
      </View>
      <PinPad
        key={config.pinLength}
        length={config.pinLength}
        onComplete={submit}
        disabled={waiting}
        extraKey={
          canBiometric
            ? { icon: biometricKind === 'face' ? 'scan-outline' : 'finger-print', label: tr('Unlock with {0}', [biometricLabel(biometricKind)]), onPress: unlockWithBiometrics }
            : undefined
        }
      />
      <Pressable onPress={forgot} hitSlop={10} accessibilityRole="button">
        <AppText weight="600" color={t.primary}>{tr('Forgot PIN?')}</AppText>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 96, height: 96, borderRadius: 22 },
  iconSmall: { width: 64, height: 64, borderRadius: 16 },
  locked: { flex: 1, alignItems: 'center', justifyContent: 'space-evenly', paddingHorizontal: 16 },
});
