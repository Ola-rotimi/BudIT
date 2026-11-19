import * as Device from 'expo-device';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { getSetting, setSetting } from '@/db/queries';
import { tr } from '@/i18n';

const ROOT_WARNED_KEY = 'rootWarnedAt';

let rootCheck: Promise<boolean> | null = null;

/**
 * Whether the phone appears to be rooted (Android) or jailbroken (iOS). On such a phone other apps
 * can read BudIT's files and keychain, so its encryption and app lock protect much less. The check
 * is a best guess (it can be fooled either way), so it only ever warns. Simulators are skipped.
 */
export function deviceLooksRooted() {
  rootCheck ??= Device.isDevice ? Device.isRootedExperimentalAsync().catch(() => false) : Promise.resolve(false);
  return rootCheck;
}

export function useDeviceLooksRooted() {
  const [rooted, setRooted] = useState(false);
  useEffect(() => {
    deviceLooksRooted().then(setRooted);
  }, []);
  return rooted;
}

/** One-time warning on a rooted or jailbroken phone. */
export function SecurityChecks() {
  const db = useSQLiteContext();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!(await deviceLooksRooted()) || cancelled) return;
      if (await getSetting(db, ROOT_WARNED_KEY)) return;
      await setSetting(db, ROOT_WARNED_KEY, new Date().toISOString());
      Alert.alert(
        tr('This phone may be rooted or jailbroken'),
        tr('On a rooted or jailbroken phone, other apps can get around the protections that keep your BudIT data private, including encryption and app lock. Use BudIT on a phone with the standard system software if you can.'),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);
  return null;
}
