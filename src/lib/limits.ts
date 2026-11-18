/**
 * Free-plan allowances. Free users can try goals, bills and savings groups; Pro removes the limits.
 * Existing items always stay usable (e.g. after a subscription lapses); only adding more is gated.
 */
import { router, type Href } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Alert } from 'react-native';
import { useQuery } from '@/hooks/useQuery';
import { usePro } from './pro';

export const FREE_LIMITS = { goals: 1, bills: 3, groups: 1 } as const;
export type LimitedFeature = keyof typeof FREE_LIMITS;

export const LIMIT_COPY: Record<LimitedFeature, { noun: (n: number) => string; title: string; message: string }> = {
  goals: {
    noun: (n) => (n === 1 ? 'savings goal' : 'savings goals'),
    title: 'Save for everything at once',
    message: 'BudT Pro gives you unlimited savings goals, each with its own target date and monthly amount.',
  },
  bills: {
    noun: (n) => (n === 1 ? 'bill' : 'bills'),
    title: 'Never miss a bill',
    message: 'BudT Pro tracks unlimited bills and subscriptions and reminds you the day before each one is due.',
  },
  groups: {
    noun: (n) => (n === 1 ? 'savings group' : 'savings groups'),
    title: 'Track every group you’re in',
    message: 'BudT Pro tracks unlimited ajo, esusu, susu, chama and stokvel groups, with every contribution and payout.',
  },
};

const COUNT_SQL: Record<LimitedFeature, string> = {
  goals: 'SELECT count(*) AS n FROM goals',
  bills: 'SELECT count(*) AS n FROM bills WHERE active = 1',
  groups: 'SELECT count(*) AS n FROM savings_groups WHERE active = 1',
};

async function countOf(db: SQLiteDatabase, feature: LimitedFeature) {
  return (await db.getFirstAsync<{ n: number }>(COUNT_SQL[feature]))?.n ?? 0;
}

/**
 * Whether the user may add another item, and an `add` handler that opens the form or, at the
 * free limit, explains it and offers Pro. `canAdd` is undefined until the count has loaded.
 */
export function useFreeLimit(feature: LimitedFeature) {
  const { isPro } = usePro();
  const used = useQuery(`limit:${feature}`, (db) => countOf(db, feature));
  const limit = FREE_LIMITS[feature];
  const canAdd = used === undefined ? undefined : isPro || used < limit;

  const add = (href: Href) => {
    if (canAdd !== false) return router.push(href);
    const copy = LIMIT_COPY[feature];
    Alert.alert(
      'Free plan limit reached',
      `The free plan includes ${limit} ${copy.noun(limit)}. ${copy.message}`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'See BudT Pro', onPress: () => router.push('/paywall') },
      ],
    );
  };

  return { isPro, used, limit, canAdd, add };
}
