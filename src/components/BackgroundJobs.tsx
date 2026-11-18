import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { subscribe } from '@/db/events';
import { processRecurring } from '@/db/queries';
import { usePro } from '@/lib/pro';
import { syncReminders } from '@/lib/reminders';
import { useSecurity } from '@/lib/security';
import { useSettings } from '@/lib/settings';

/** Wait for a burst of edits to settle before rebuilding notifications. */
const SYNC_DELAY_MS = 1500;

/** Housekeeping that runs on launch, whenever the app returns to the foreground, and after data changes. */
export function BackgroundJobs() {
  const db = useSQLiteContext();
  const { isPro } = usePro();
  const { hideAmounts, currency } = useSettings();
  const { config } = useSecurity();
  // Keep figures off the lock screen when the user has asked for privacy.
  const showAmounts = !hideAmounts && !config.enabled;

  // Recurring transactions: add anything that has come due.
  useEffect(() => {
    const run = () => {
      processRecurring(db).catch((e) => console.warn('Recurring transactions failed', e));
    };
    run();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => sub.remove();
  }, [db]);

  // Reminders: rebuild after any change (bills edited, paid, settings toggled…).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        syncReminders(db, { isPro, showAmounts, currency }).catch((e) => console.warn('Reminder sync failed', e));
      }, SYNC_DELAY_MS);
    };
    sync();
    const unsubscribe = subscribe(sync);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [db, isPro, showAmounts, currency]);

  return null;
}
