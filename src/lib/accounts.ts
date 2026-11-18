import type { AccountKind, IconName } from '@/db/types';
import { N_ } from '@/i18n';

/** Wallet types, with examples familiar across Africa. */
export const ACCOUNT_KINDS: Record<AccountKind, { label: string; icon: IconName; example: string }> = {
  cash: { label: N_('Cash'), icon: 'cash', example: N_('Wallet, cash at home') },
  bank: { label: N_('Bank'), icon: 'business', example: N_('GTBank, Access, Equity, Ecobank…') },
  mobile: { label: N_('Mobile'), icon: 'phone-portrait', example: N_('M-Pesa, MTN MoMo, OPay, PalmPay…') },
  card: { label: N_('Card'), icon: 'card', example: N_('Credit card or overdraft') },
  savings: { label: N_('Savings'), icon: 'shield-checkmark', example: N_('Savings account, PiggyVest, Cowrywise…') },
};
