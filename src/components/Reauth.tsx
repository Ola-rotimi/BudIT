import * as LocalAuthentication from 'expo-local-authentication';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tr } from '@/i18n';
import { useSecurity } from '@/lib/security';
import { useTheme } from '@/lib/theme';
import { PinPad } from './PinPad';
import { AppText } from './ui';

type Confirm = (reason: string) => Promise<boolean>;

const ReauthContext = createContext<Confirm | null>(null);

/**
 * Asks the user to prove it's them before a sensitive action (exporting data, erasing it, showing
 * hidden amounts, turning protections off), since anyone holding an unlocked phone could otherwise
 * do these. With app lock: Face ID / fingerprint if enabled, else the BudIT PIN. Without app lock:
 * the phone's own passcode or biometrics, if it has any.
 */
export function ReauthProvider({ children }: { children: ReactNode }) {
  const security = useSecurity();
  const [request, setRequest] = useState<{ reason: string; resolve: (ok: boolean) => void } | null>(null);

  const confirm = useCallback<Confirm>(
    async (reason) => {
      if (security.config.enabled) {
        // In safe mode, no biometrics: they could be forced. The PIN pad takes the real or panic PIN.
        if (!security.safeMode && security.config.biometrics && security.biometricKind) {
          const res = await LocalAuthentication.authenticateAsync({
            promptMessage: reason,
            cancelLabel: tr('Use PIN'),
            fallbackLabel: '',
            disableDeviceFallback: true,
          });
          if (res.success) return true;
        }
        return new Promise<boolean>((resolve) => setRequest({ reason, resolve }));
      }
      try {
        if ((await LocalAuthentication.getEnrolledLevelAsync()) === LocalAuthentication.SecurityLevel.NONE) return true;
        return (await LocalAuthentication.authenticateAsync({ promptMessage: reason })).success;
      } catch {
        // No local authentication on this platform (e.g. web): nothing to check against.
        return true;
      }
    },
    [security.config.enabled, security.config.biometrics, security.biometricKind, security.safeMode],
  );

  const finish = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };

  return (
    <ReauthContext.Provider value={confirm}>
      {children}
      <Modal visible={!!request} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => finish(false)}>
        {request && <PinCheck reason={request.reason} onDone={finish} />}
      </Modal>
    </ReauthContext.Provider>
  );
}

function PinCheck({ reason, onDone }: { reason: string; onDone: (ok: boolean) => void }) {
  const t = useTheme();
  const { config, lockedUntil, checkReauthPin } = useSecurity();
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const waiting = lockedUntil > now;
  const done = useRef(false);

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
    const result = await checkReauthPin(pin);
    if (result.ok) {
      if (!done.current) {
        done.current = true;
        onDone(true);
      }
      return true;
    }
    setMessage(result.lockedUntil > Date.now() ? tr('Too many attempts. Try again later.') : tr('Wrong PIN. {0} attempts left.', [result.attemptsLeft]));
    return false;
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Pressable onPress={() => onDone(false)} hitSlop={10} accessibilityRole="button" style={styles.side}>
          <AppText weight="600" color={t.primary}>
            {tr('Cancel')}
          </AppText>
        </Pressable>
        <AppText weight="700" style={styles.title} numberOfLines={1}>
          {tr('Confirm it’s you')}
        </AppText>
        <View style={styles.side} />
      </View>
      <View style={styles.body}>
        <View style={{ gap: 10, alignItems: 'center' }}>
          <AppText variant="heading" style={{ textAlign: 'center' }}>
            {reason}
          </AppText>
          <AppText variant="caption" color={message || waiting ? t.expense : t.muted} style={{ textAlign: 'center' }}>
            {waiting ? tr('Too many attempts. Try again later.') : (message ?? tr('Enter your BudIT PIN'))}
          </AppText>
        </View>
        <PinPad key={config.pinLength} length={config.pinLength} onComplete={submit} disabled={waiting} />
      </View>
    </SafeAreaView>
  );
}

/** `await confirm(reason)` before a sensitive action; false if the user cancelled or failed. */
export function useReauth() {
  const ctx = useContext(ReauthContext);
  if (!ctx) throw new Error('useReauth must be used within ReauthProvider');
  return ctx;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  side: { minWidth: 64 },
  title: { flex: 1, textAlign: 'center' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'space-evenly', padding: 16 },
});
