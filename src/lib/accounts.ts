import type { AccountKind, IconName } from '@/db/types';

/** Wallet types, with examples familiar across Africa. */
export const ACCOUNT_KINDS: Record<AccountKind, { label: string; icon: IconName; example: string }> = {
  cash: { label: 'Cash', icon: 'cash', example: 'Wallet, cash at home' },
  bank: { label: 'Bank', icon: 'business', example: 'GTBank, Access, Equity, Ecobank…' },
  mobile: { label: 'Mobile', icon: 'phone-portrait', example: 'M-Pesa, MTN MoMo, OPay, PalmPay…' },
  card: { label: 'Card', icon: 'card', example: 'Credit card or overdraft' },
  savings: { label: 'Savings', icon: 'shield-checkmark', example: 'Savings account, PiggyVest, Cowrywise…' },
};
