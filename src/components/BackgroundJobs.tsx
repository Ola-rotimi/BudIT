import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { homeCurrency } from '@/db/currency';
import { notifyChange, subscribe } from '@/db/events';
import { recordNetWorth, safeToSpendData } from '@/db/planning';
import { listAccounts, processRecurring } from '@/db/queries';
import { tr } from '@/i18n';
import { shortDate, todayISO } from '@/lib/dates';
import { getRate } from '@/lib/fx';
import { formatMoney } from '@/lib/money';
import { usePro } from '@/lib/pro';
import { syncReminders } from '@/lib/reminders';
import { safeToSpend } from '@/lib/safeToSpend';
import { useSecurity } from '@/lib/security';
import { useSettings } from '@/lib/settings';
import { updateWidget } from '@/lib/widget';

/** Wait for a burst of edits to settle before rebuilding notifications. */
const SYNC_DELAY_MS = 1500;

/** Housekeeping that runs on launch, whenever the app returns to the foreground, and after data changes. */
export function BackgroundJobs() {
  const db = useSQLiteContext();
  const { isPro } = usePro();
  const { hideAmounts, currency } = useSettings();
  const { config, safeMode } = useSecurity();
  // Keep figures off the lock screen and home screen when the user has asked for privacy.
  const showAmounts = !hideAmounts && !config.enabled && !safeMode;

  // On launch and on return to the app: add recurring transactions that have come due, and refresh
  // the official rates for accounts held in other currencies (cached, so totals work offline).
  useEffect(() => {
    const run = async () => {
      try {
        const accounts = await listAccounts(db);
        const home = await homeCurrency(db);
        const foreign = [...new Set(accounts.map((a) => a.currency).filter((c): c is string => !!c && c !== home))];
        if (foreign.length) {
          await Promise.allSettled([home, ...foreign].map((c) => getRate(db, c)));
          notifyChange();
        }
      } catch (e) {
        console.warn('Exchange rate refresh failed', e);
      }
      processRecurring(db).catch((e) => console.warn('Recurring transactions failed', e));
    };
    run();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => sub.remove();
  }, [db]);

  // After any change: rebuild reminders, refresh the widget and this month's net worth.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        syncReminders(db, { isPro, showAmounts, currency }).catch((e) => console.warn('Reminder sync failed', e));
        recordNetWorth(db).catch((e) => console.warn('Net worth snapshot failed', e));
        refreshWidget().catch((e) => console.warn('Widget refresh failed', e));
      }, SYNC_DELAY_MS);
    };
    const refreshWidget = async () => {
      if (!showAmounts) {
        updateWidget({ title: tr('Safe to spend'), amount: '•••••', detail: tr('Open BudIT to see your figures'), negative: false });
        return;
      }
      const today = todayISO();
      const s = safeToSpend({ today, ...(await safeToSpendData(db)) });
      updateWidget({
        // A fixed date, not "tomorrow": the widget may be looked at days later.
        title: tr('Safe to spend until {0}', [shortDate(s.payday)]),
        amount: s.safe < 0 ? `−${formatMoney(-s.safe, currency)}` : formatMoney(s.safe, currency),
        detail: s.safe < 0 ? tr('Short before payday') : tr('About {0} a day', [formatMoney(s.perDay, currency)]),
        negative: s.safe < 0,
      });
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
