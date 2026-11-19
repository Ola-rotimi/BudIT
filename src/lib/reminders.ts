/**
 * Local notifications: bill reminders (the day before, at 9am) and an optional daily nudge to log
 * spending. Everything is scheduled on the device; nothing goes through a server.
 *
 * Reminders are rebuilt from the database whenever data changes, so they always match the bills.
 */
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';
import { getSetting, listBills, setSetting, transactionCount } from '@/db/queries';
import { BACKUP_REMINDER_DAYS, LAST_BACKUP_KEY } from './backup';
import { addDays, fromISODate, todayISO } from './dates';
import { formatMoney } from './money';
import { tr } from '@/i18n';

const CHANNEL = 'reminders';
const PREFIX = 'budit-';
/** Prefix used before the app was renamed BudIT, so old reminders are cleared too. */
const LEGACY_PREFIX = 'budt-';
/** iOS keeps at most 64 pending notifications per app; stay well under it. */
const MAX_BILL_REMINDERS = 40;
const BILL_HOUR = 9;

export const REMINDER_KEYS = { bills: 'remindBills', daily: 'remindDaily', backup: 'remindBackup' } as const;

/** Backup reminders wait until there's enough data worth losing. */
const BACKUP_MIN_TRANSACTIONS = 20;
const BACKUP_HOUR = 10;

/** Daily reminder time as "HH:MM" (24-hour), or '' when off. */
export type DailyTime = string;

const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/** Asks for permission (once) and sets up the Android channel. Returns whether notifications are allowed. */
export async function ensurePermission() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: tr('Reminders'), importance: AndroidImportance.DEFAULT });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

export async function readReminderSettings(db: SQLiteDatabase) {
  const [bills, daily, backup] = await Promise.all([
    getSetting(db, REMINDER_KEYS.bills),
    getSetting(db, REMINDER_KEYS.daily),
    getSetting(db, REMINDER_KEYS.backup),
  ]);
  // Backup reminders are on unless turned off.
  return { bills: bills === '1', daily: daily && isTime(daily) ? daily : '', backup: backup !== '0' };
}

export async function saveReminderSetting(db: SQLiteDatabase, key: keyof typeof REMINDER_KEYS, value: string) {
  await setSetting(db, REMINDER_KEYS[key], value);
}

/**
 * Replaces all of BudIT's scheduled notifications with ones matching current data.
 * `showAmounts` is false when amounts are hidden or the app is locked, so lock-screen previews
 * never reveal figures.
 */
export async function syncReminders(db: SQLiteDatabase, opts: { isPro: boolean; showAmounts: boolean; currency: string }) {
  const settings = await readReminderSettings(db);
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(scheduled.filter((n) => n.identifier.startsWith(PREFIX) || n.identifier.startsWith(LEGACY_PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));

  if (!settings.bills && !settings.daily && !settings.backup) return;
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  const channelId = Platform.OS === 'android' ? CHANNEL : undefined;

  if (settings.backup) {
    const [last, count] = await Promise.all([getSetting(db, LAST_BACKUP_KEY), transactionCount(db)]);
    if (count >= BACKUP_MIN_TRANSACTIONS) {
      // BACKUP_REMINDER_DAYS after the last backup; never backed up: tomorrow morning.
      const when = last ? addDays(new Date(last), BACKUP_REMINDER_DAYS) : addDays(new Date(), 1);
      when.setHours(BACKUP_HOUR, 0, 0, 0);
      if (when.getTime() <= Date.now()) when.setTime(addDays(new Date(), 1).setHours(BACKUP_HOUR, 0, 0, 0));
      await Notifications.scheduleNotificationAsync({
        identifier: `${PREFIX}backup`,
        content: {
          title: tr('Time to back up BudIT'),
          body: last ? tr('It’s been {0} days since your last backup. Your records only live on this phone.', [BACKUP_REMINDER_DAYS]) : tr('You haven’t backed up yet. Your records only live on this phone.'),
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId },
      });
    }
  }

  if (settings.daily) {
    const [hour, minute] = settings.daily.split(':').map(Number);
    await Notifications.scheduleNotificationAsync({
      identifier: `${PREFIX}daily`,
      content: { title: tr('Anything to add to BudIT?'), body: tr('Take 30 seconds to log today’s spending and stay on budget.') },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId },
    });
  }

  // Bills are a Pro feature, so their reminders are too.
  if (settings.bills && opts.isPro) {
    const now = Date.now();
    const today = todayISO();
    const bills = (await listBills(db)).filter((b) => b.due_date >= today).slice(0, MAX_BILL_REMINDERS);
    for (const b of bills) {
      const due = fromISODate(b.due_date);
      let when = addDays(due, -1);
      when.setHours(BILL_HOUR, 0, 0, 0);
      let label = tr('due tomorrow');
      if (when.getTime() <= now) {
        // Too late for the day-before reminder: remind on the day instead, if that's still ahead.
        when = new Date(due);
        when.setHours(BILL_HOUR, 0, 0, 0);
        label = tr('due today');
        if (when.getTime() <= now) continue;
      }
      const amount = opts.showAmounts ? ` (${formatMoney(b.amount, opts.currency)})` : '';
      await Notifications.scheduleNotificationAsync({
        identifier: `${PREFIX}bill-${b.id}`,
        content: { title: tr('{0} is {1}', [b.name, label]), body: tr('Your {0} payment{1} is {2}. Mark it paid in BudIT once it’s done.', [b.name, amount, label]) },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId },
      });
    }
  }
}
