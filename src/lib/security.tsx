/**
 * App lock (PIN + optional Face ID / fingerprint) and privacy screen.
 *
 * Everything here lives in the device keychain/keystore via expo-secure-store, never in the
 * database, so it isn't included in backups and a restored backup can't carry someone else's PIN.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as ScreenCapture from 'expo-screen-capture';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { hashPin, verifyPin, type PinHash } from './crypto';
import { tr } from '@/i18n';

export type LockConfig = {
  enabled: boolean;
  pinLength: 4 | 6;
  biometrics: boolean;
  /** Seconds in the background before the app locks again. 0 = immediately. */
  timeout: number;
  /** Hide the app in the app switcher and block screenshots. */
  privacy: boolean;
};

const DEFAULT_CONFIG: LockConfig = { enabled: false, pinLength: 4, biometrics: false, timeout: 60, privacy: false };

const KEYS = { config: 'budt.lock', pin: 'budt.pin', failures: 'budt.pinFailures' };
const STORE_OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/** Wrong PINs allowed before a lockout; each further miss doubles the wait. */
const FREE_ATTEMPTS = 5;
const BASE_LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 15 * 60_000;

type Failures = { count: number; until: number };

export type BiometricKind = 'face' | 'fingerprint' | 'biometrics';

export type PinResult = { ok: true } | { ok: false; lockedUntil: number; attemptsLeft: number };

type Security = {
  ready: boolean;
  config: LockConfig;
  locked: boolean;
  /** Set when the device can do biometric unlock (hardware present and enrolled). */
  biometricKind: BiometricKind | null;
  /** Until when (epoch ms) the PIN pad is disabled after too many wrong PINs. In the past when not locked out. */
  lockedUntil: number;
  enableLock: (pin: string, pinLength: 4 | 6) => Promise<void>;
  disableLock: () => Promise<void>;
  changePin: (pin: string, pinLength: 4 | 6) => Promise<void>;
  /** Checks a PIN without unlocking (e.g. before changing it). Counts towards lockouts. */
  checkPin: (pin: string) => Promise<PinResult>;
  unlockWithPin: (pin: string) => Promise<PinResult>;
  unlockWithBiometrics: () => Promise<boolean>;
  /** Unlocks with the phone's own passcode, for a forgotten PIN. */
  unlockWithDeviceCredentials: () => Promise<boolean>;
  update: (changes: Partial<Pick<LockConfig, 'biometrics' | 'timeout' | 'privacy'>>) => Promise<void>;
  /** True while the app isn't in the foreground and something should hide its content. */
  obscured: boolean;
  /** Time (epoch ms) of the last screenshot attempt while the privacy screen was on, or 0. */
  screenshotBlockedAt: number;
};

const SecurityContext = createContext<Security | null>(null);

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(key, STORE_OPTS);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

const writeJson = (key: string, value: unknown) => SecureStore.setItemAsync(key, JSON.stringify(value), STORE_OPTS);

async function detectBiometrics(): Promise<BiometricKind | null> {
  try {
    if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync())) return null;
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION) && Platform.OS === 'ios') return 'face';
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'fingerprint';
    return 'biometrics';
  } catch {
    return null;
  }
}

export function biometricLabel(kind: BiometricKind | null) {
  return kind === 'face' ? 'Face ID' : kind === 'fingerprint' ? tr('fingerprint') : tr('biometrics');
}

export function SecurityProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<LockConfig>(DEFAULT_CONFIG);
  const [locked, setLocked] = useState(false);
  const [biometricKind, setBiometricKind] = useState<BiometricKind | null>(null);
  const [failures, setFailures] = useState<Failures>({ count: 0, until: 0 });
  const [appState, setAppState] = useState(AppState.currentState);
  const [screenshotBlockedAt, setScreenshotBlockedAt] = useState(0);
  const backgroundAt = useRef<number | null>(null);
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    (async () => {
      const [stored, fails, kind] = await Promise.all([readJson<LockConfig>(KEYS.config), readJson<Failures>(KEYS.failures), detectBiometrics()]);
      const cfg = { ...DEFAULT_CONFIG, ...stored };
      setConfig(cfg);
      setLocked(cfg.enabled);
      if (fails) setFailures(fails);
      setBiometricKind(kind);
      setReady(true);
    })();
  }, []);

  // Re-lock after the app has been in the background for longer than the timeout.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      setAppState(next);
      if (next === 'background') backgroundAt.current = Date.now();
      if (next === 'active') {
        const cfg = configRef.current;
        const away = backgroundAt.current === null ? 0 : Date.now() - backgroundAt.current;
        if (cfg.enabled && backgroundAt.current !== null && away >= cfg.timeout * 1000) setLocked(true);
        backgroundAt.current = null;
        // Biometrics may have been added or removed in system settings meanwhile.
        detectBiometrics().then(setBiometricKind);
      }
    });
    return () => sub.remove();
  }, []);

  // Privacy screen: blur in the iOS app switcher; FLAG_SECURE on Android (hides recents and blocks screenshots).
  useEffect(() => {
    if (!ready) return;
    (async () => {
      try {
        if (config.privacy) {
          if (Platform.OS === 'ios') await ScreenCapture.enableAppSwitcherProtectionAsync(0.9);
          await ScreenCapture.preventScreenCaptureAsync('privacy');
        } else {
          if (Platform.OS === 'ios') await ScreenCapture.disableAppSwitcherProtectionAsync();
          await ScreenCapture.allowScreenCaptureAsync('privacy');
        }
      } catch (e) {
        console.warn('Privacy screen unavailable', e);
      }
    })();
  }, [ready, config.privacy]);

  // Tell the user when a screenshot was blocked. iOS always reports it (the image comes out blank);
  // Android 14+ may, and also shows its own system message.
  useEffect(() => {
    if (!ready || !config.privacy) return;
    let sub: { remove: () => void } | undefined;
    try {
      sub = ScreenCapture.addScreenshotListener(() => setScreenshotBlockedAt(Date.now()));
    } catch (e) {
      console.warn('Screenshot listener unavailable', e);
    }
    return () => sub?.remove();
  }, [ready, config.privacy]);

  const saveConfig = useCallback(async (next: LockConfig) => {
    await writeJson(KEYS.config, next);
    setConfig(next);
  }, []);

  const recordAttempt = useCallback(async (ok: boolean): Promise<PinResult> => {
    if (ok) {
      const cleared = { count: 0, until: 0 };
      setFailures(cleared);
      await writeJson(KEYS.failures, cleared);
      return { ok: true };
    }
    const count = failures.count + 1;
    const over = count - FREE_ATTEMPTS;
    const until = over >= 0 ? Date.now() + Math.min(MAX_LOCKOUT_MS, BASE_LOCKOUT_MS * 2 ** over) : 0;
    const next = { count, until };
    setFailures(next);
    await writeJson(KEYS.failures, next);
    return { ok: false, lockedUntil: until, attemptsLeft: Math.max(0, FREE_ATTEMPTS - count) };
  }, [failures.count]);

  const checkPin = useCallback(
    async (pin: string): Promise<PinResult> => {
      if (failures.until > Date.now()) return { ok: false, lockedUntil: failures.until, attemptsLeft: 0 };
      const stored = await readJson<PinHash>(KEYS.pin);
      return recordAttempt(!!stored && (await verifyPin(pin, stored)));
    },
    [failures.until, recordAttempt],
  );

  const value = useMemo<Security>(() => {
    const setPin = async (pin: string) => {
      await writeJson(KEYS.pin, await hashPin(pin));
      await writeJson(KEYS.failures, { count: 0, until: 0 });
      setFailures({ count: 0, until: 0 });
    };
    const unlockAfter = (ok: boolean) => {
      if (ok) {
        setLocked(false);
        recordAttempt(true);
      }
      return ok;
    };
    return {
      ready,
      config,
      locked: ready && locked,
      biometricKind,
      lockedUntil: failures.until,
      enableLock: async (pin, pinLength) => {
        await setPin(pin);
        await saveConfig({ ...config, enabled: true, pinLength, biometrics: !!biometricKind });
      },
      disableLock: async () => {
        await SecureStore.deleteItemAsync(KEYS.pin, STORE_OPTS);
        await saveConfig({ ...config, enabled: false, biometrics: false });
      },
      changePin: async (pin, pinLength) => {
        await setPin(pin);
        await saveConfig({ ...config, pinLength });
      },
      checkPin,
      unlockWithPin: async (pin) => {
        const result = await checkPin(pin);
        if (result.ok) setLocked(false);
        return result;
      },
      unlockWithBiometrics: async () => {
        if (!config.biometrics || !biometricKind) return false;
        const res = await LocalAuthentication.authenticateAsync({
          promptMessage: tr('Unlock BudT'),
          cancelLabel: tr('Use PIN'),
          fallbackLabel: '',
          disableDeviceFallback: true,
        });
        return unlockAfter(res.success);
      },
      unlockWithDeviceCredentials: async () => {
        const res = await LocalAuthentication.authenticateAsync({ promptMessage: tr('Unlock BudT with your phone’s passcode') });
        return unlockAfter(res.success);
      },
      update: (changes) => saveConfig({ ...config, ...changes }),
      obscured: ready && (config.enabled || config.privacy) && appState !== 'active',
      screenshotBlockedAt,
    };
  }, [ready, config, locked, biometricKind, failures.until, appState, screenshotBlockedAt, saveConfig, checkPin, recordAttempt]);

  // Render nothing until the lock state is known, so a locked app never flashes its content.
  if (!ready) return null;
  return <SecurityContext.Provider value={value}>{children}</SecurityContext.Provider>;
}

export function useSecurity() {
  const ctx = useContext(SecurityContext);
  if (!ctx) throw new Error('useSecurity must be used within SecurityProvider');
  return ctx;
}
