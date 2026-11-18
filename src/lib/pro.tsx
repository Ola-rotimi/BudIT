/**
 * BudT Pro: subscription state via RevenueCat. Pro unlocks the Tax calculator, Pension planner
 * and currency converter. In Expo Go, RevenueCat runs in Preview API mode (no real charges).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import Purchases, {
  INTRO_ELIGIBILITY_STATUS,
  PACKAGE_TYPE,
  type CustomerInfo,
  type PurchasesError,
  type PurchasesPackage,
  type PurchasesStoreProduct,
} from 'react-native-purchases';
import { tr } from '@/i18n';

/** Entitlement identifier configured in the RevenueCat dashboard. */
export const PRO_ENTITLEMENT = 'pro';

/** Public SDK keys (safe to ship in the app). Set them in `.env`; see `.env.example`. */
const API_KEY = Platform.select({
  ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
  android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
});

type Pro = {
  isPro: boolean;
  /** False when no RevenueCat key is set, so purchases are unavailable. */
  available: boolean;
  /** Store management page for an active subscription, if any. */
  managementUrl: string | null;
  /** While Pro comes from a free trial: when the trial ends, and whether it then becomes paid. */
  trial: { endsAt: string; willRenew: boolean } | null;
  purchase: (pkg: PurchasesPackage) => Promise<'purchased' | 'cancelled'>;
  restore: () => Promise<boolean>;
  /** Development builds only: pretend to be Pro to test gated screens without buying. */
  devOverride: boolean;
  setDevOverride: (on: boolean) => void;
};

const ProContext = createContext<Pro | null>(null);

let configured = false;

function configureOnce() {
  if (configured || !API_KEY) return configured;
  // Signed responses: a tampered or intercepted CustomerInfo is flagged instead of trusted.
  Purchases.configure({ apiKey: API_KEY, entitlementVerificationMode: Purchases.ENTITLEMENT_VERIFICATION_MODE.INFORMATIONAL });
  configured = true;
  return true;
}

/** Active "pro" entitlement whose signature didn't fail verification (e.g. a patched or proxied response). */
const hasPro = (info: CustomerInfo | null) => {
  const entitlement = info?.entitlements.active[PRO_ENTITLEMENT];
  return !!entitlement && entitlement.verification !== Purchases.VERIFICATION_RESULT.FAILED;
};

function trialOfEntitlement(info: CustomerInfo | null): Pro['trial'] {
  const entitlement = info?.entitlements.active[PRO_ENTITLEMENT];
  if (!entitlement || !hasPro(info) || entitlement.periodType !== 'TRIAL' || !entitlement.expirationDate) return null;
  return { endsAt: entitlement.expirationDate, willRenew: entitlement.willRenew };
}

export function ProProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<CustomerInfo | null>(null);
  const [devOverride, setDevOverride] = useState(false);
  const available = !!API_KEY;

  useEffect(() => {
    if (!configureOnce()) return;
    Purchases.getCustomerInfo().then(setInfo, (e) => console.warn('RevenueCat getCustomerInfo failed', e));
    Purchases.addCustomerInfoUpdateListener(setInfo);
    return () => {
      Purchases.removeCustomerInfoUpdateListener(setInfo);
    };
  }, []);

  const purchase = useCallback(async (pkg: PurchasesPackage) => {
    try {
      const result = await Purchases.purchasePackage(pkg);
      setInfo(result.customerInfo);
      return 'purchased' as const;
    } catch (e) {
      if ((e as PurchasesError).code === Purchases.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return 'cancelled' as const;
      throw e;
    }
  }, []);

  const restore = useCallback(async () => {
    const restored = await Purchases.restorePurchases();
    setInfo(restored);
    return hasPro(restored);
  }, []);

  const value = useMemo<Pro>(
    () => ({
      isPro: hasPro(info) || (__DEV__ && devOverride),
      available,
      managementUrl: info?.managementURL ?? null,
      trial: trialOfEntitlement(info),
      purchase,
      restore,
      devOverride,
      setDevOverride,
    }),
    [info, available, purchase, restore, devOverride],
  );

  return <ProContext.Provider value={value}>{children}</ProContext.Provider>;
}

export function usePro() {
  const ctx = useContext(ProContext);
  if (!ctx) throw new Error('usePro must be used within ProProvider');
  return ctx;
}

export type PlanOption = {
  pkg: PurchasesPackage;
  kind: 'monthly' | 'annual' | 'lifetime';
  title: string;
  price: string;
  note?: string;
  /** Length of the free trial this user would get, e.g. "7 days". Unset when there's none or they've had it. */
  trial?: string;
};

/**
 * The free trial set up on a subscription in App Store Connect / Google Play (BudT uses 7 days).
 * The trial itself is configured in the stores, not here, so the paywall always shows what the
 * store will actually charge.
 */
function freeTrialOf(product: PurchasesStoreProduct): { unit: string; value: number } | null {
  if (Platform.OS === 'android') {
    // Google Play only offers a trial phase to users who are still eligible for it.
    const period = product.defaultOption?.freePhase?.billingPeriod;
    return period ? { unit: period.unit, value: period.value } : null;
  }
  const intro = product.introPrice;
  return intro && intro.price === 0 ? { unit: intro.periodUnit, value: intro.periodNumberOfUnits * Math.max(1, intro.cycles) } : null;
}

function trialLength({ unit, value }: { unit: string; value: number }) {
  switch (unit.toUpperCase()) {
    case 'DAY':
      return value === 1 ? tr('1 day') : tr('{0} days', [value]);
    case 'WEEK':
      return tr('{0} days', [value * 7]);
    case 'MONTH':
      return value === 1 ? tr('1 month') : tr('{0} months', [value]);
    case 'YEAR':
      return value === 1 ? tr('1 year') : tr('{0} years', [value]);
    default:
      return null;
  }
}

/**
 * Products whose trial this user can still get. iOS has to be asked; an unknown answer counts as
 * "no" so nobody is promised a free trial and then charged. Android's offers are already filtered.
 */
async function trialEligible(products: PurchasesStoreProduct[]): Promise<Set<string>> {
  if (Platform.OS === 'android') return new Set(products.map((p) => p.identifier));
  try {
    const result = await Purchases.checkTrialOrIntroductoryPriceEligibility(products.map((p) => p.identifier));
    return new Set(products.filter((p) => result[p.identifier]?.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE).map((p) => p.identifier));
  } catch (e) {
    console.warn('RevenueCat trial eligibility check failed', e);
    return new Set();
  }
}

/** Loads the current offering's monthly, yearly and lifetime packages for the paywall. */
export async function loadPlans(): Promise<PlanOption[]> {
  if (!configureOnce()) return [];
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  if (!current) return [];
  const monthly = current.availablePackages.find((p) => p.packageType === PACKAGE_TYPE.MONTHLY);
  const annual = current.availablePackages.find((p) => p.packageType === PACKAGE_TYPE.ANNUAL);
  const lifetime = current.availablePackages.find((p) => p.packageType === PACKAGE_TYPE.LIFETIME);

  const plans: PlanOption[] = [];
  if (annual) {
    const saving = monthly && monthly.product.price > 0 ? 1 - annual.product.price / (monthly.product.price * 12) : 0;
    plans.push({
      pkg: annual,
      kind: 'annual',
      title: tr('Yearly'),
      price: tr('{0} / year', [annual.product.priceString]),
      note: saving >= 0.05 ? tr('Save {0}%', [Math.round(saving * 100)]) : undefined,
    });
  }
  if (monthly) plans.push({ pkg: monthly, kind: 'monthly', title: tr('Monthly'), price: tr('{0} / month', [monthly.product.priceString]) });
  if (lifetime) plans.push({ pkg: lifetime, kind: 'lifetime', title: tr('Lifetime'), price: tr('{0} once', [lifetime.product.priceString]), note: tr('Pay once') });

  // Free trials apply to the subscriptions only.
  const withTrial = plans.filter((p) => p.kind !== 'lifetime' && freeTrialOf(p.pkg.product));
  const eligible = withTrial.length ? await trialEligible(withTrial.map((p) => p.pkg.product)) : new Set<string>();
  for (const p of withTrial) {
    if (!eligible.has(p.pkg.product.identifier)) continue;
    const length = trialLength(freeTrialOf(p.pkg.product)!);
    if (!length) continue;
    p.trial = length;
    p.price = tr('{0} free, then {1}', [length, p.price]);
  }
  return plans;
}
