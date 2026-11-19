import type Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import type { Frequency } from '@/lib/dates';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export type TxType = 'income' | 'expense';

export type Category = {
  id: number;
  name: string;
  type: TxType;
  icon: IconName;
  color: string;
  archived: number;
};

export type Transaction = {
  id: number;
  type: TxType;
  /** Minor units (cents). Always positive; `type` carries the sign. */
  amount: number;
  category_id: number;
  account_id: number | null;
  /** Set when the transaction was created by a recurring rule. */
  recurring_id: number | null;
  date: string;
  note: string;
  /** For an account in another currency: the amount in that currency (`amount` is the home-currency value). */
  orig_amount: number | null;
  orig_currency: string | null;
  created_at: string;
};

export type AccountKind = 'cash' | 'bank' | 'mobile' | 'card' | 'savings';

/** A wallet: cash, a bank account, mobile money (M-Pesa, MoMo, OPay…), a card or savings. */
export type Account = {
  id: number;
  name: string;
  kind: AccountKind;
  icon: IconName;
  color: string;
  /** Balance before the first transaction recorded in BudIT, in cents. Can be negative (e.g. a card). */
  opening_balance: number;
  archived: number;
  /** Currency the account holds, e.g. 'USD' for a domiciliary account. Null = the home currency. */
  currency: string | null;
  created_at: string;
};

export type Transfer = {
  id: number;
  from_account: number;
  to_account: number;
  amount: number;
  /** The expense transaction recording the transfer fee, if any. */
  fee_tx_id: number | null;
  date: string;
  note: string;
  /** Set for savings-group contributions and payouts. */
  group_id: number | null;
  group_cycle: number | null;
  /** Amount received when the two accounts hold different currencies (null = same as `amount`). */
  to_amount: number | null;
  created_at: string;
};

export type IouDirection = 'owed_to_me' | 'i_owe';

/** Money lent to or borrowed from someone, or their share of a split bill. */
export type Iou = {
  id: number;
  person: string;
  direction: IouDirection;
  amount: number;
  /** How much has been paid back so far. */
  repaid: number;
  note: string;
  date: string;
  due_date: string | null;
  created_at: string;
};

export type ChallengeKind = 'no_spend' | 'category_cap' | 'spend_cap';

export type Challenge = {
  id: number;
  kind: ChallengeKind;
  /** For `category_cap`. */
  category_id: number | null;
  /** Spending limit for the whole challenge (caps only). */
  amount: number | null;
  start_date: string;
  /** Last day of the challenge (inclusive). */
  end_date: string;
  active: number;
  created_at: string;
};

export type Debt = {
  id: number;
  name: string;
  /** Amount still owed, in cents. */
  balance: number;
  /** Yearly interest rate, %. */
  apr: number;
  min_payment: number;
  created_at: string;
};

/** A rotating savings group: ajo, esusu, susu, chama, stokvel… */
export type SavingsGroup = {
  id: number;
  name: string;
  /** What each member puts in every cycle, in cents. */
  contribution: number;
  frequency: 'weekly' | 'monthly';
  start_date: string;
  members: number;
  /** The cycle (1-based) in which this user collects the pot. */
  my_turn: number;
  /** The user's account contributions come from and the payout goes to. */
  account_id: number;
  /** BudIT account tracking money in the group: contributions in, payout out. */
  pot_account_id: number;
  active: number;
  created_at: string;
};

export type Recurring = {
  id: number;
  type: TxType;
  amount: number;
  category_id: number;
  account_id: number | null;
  note: string;
  frequency: Exclude<Frequency, 'once'>;
  /** Date of the next transaction this rule will add. */
  next_date: string;
  /** Day of the month the schedule started on, so monthly dates don't drift after short months. */
  anchor_day: number | null;
  active: number;
};

export type Budget = { category_id: number; amount: number };

export type Goal = {
  id: number;
  name: string;
  target: number;
  saved: number;
  deadline: string | null;
  color: string;
  icon: IconName;
  created_at: string;
};

export type Bill = {
  id: number;
  name: string;
  amount: number;
  category_id: number;
  due_date: string;
  frequency: Frequency;
  active: number;
};
