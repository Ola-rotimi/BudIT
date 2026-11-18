import { router, type Href } from 'expo-router';
import { ProBadge } from '@/components/ProLock';
import { AppText, Card, Divider, ListRow, Screen } from '@/components/ui';
import type { IconName } from '@/db/types';
import { usePro } from '@/lib/pro';
import { N_, tr } from '@/i18n';

type Item = { icon: IconName; color: string; title: string; subtitle: string; href: Href; pro?: boolean };

const SECTIONS: { title: string; items: Item[] }[] = [
  {
    title: N_('Plan'),
    items: [
      { icon: 'list', color: '#0F766E', title: N_('Activity'), subtitle: N_('All your income and expenses'), href: '/transactions' },
      { icon: 'wallet', color: '#0EA5E9', title: N_('Accounts'), subtitle: N_('Cash, bank and mobile money balances'), href: '/accounts' },
      { icon: 'repeat', color: '#8B5CF6', title: N_('Recurring'), subtitle: N_('Salary, rent and subscriptions added for you'), href: '/recurring' },
      { icon: 'download', color: '#14B8A6', title: N_('Import statement'), subtitle: N_('Add transactions from a bank or mobile-money CSV'), href: '/import', pro: true },
      { icon: 'stats-chart', color: '#6366F1', title: N_('Insights'), subtitle: N_('Spending by category and trends'), href: '/insights' },
      { icon: 'sparkles', color: '#0F766E', title: N_('Smart budget'), subtitle: N_('A full budget built from your income'), href: '/smart-budget', pro: true },
      { icon: 'flag', color: '#10B981', title: N_('Savings goals'), subtitle: N_('Save towards the things that matter'), href: '/goals' },
      { icon: 'calendar', color: '#F97316', title: N_('Bills & subscriptions'), subtitle: N_('Recurring payments and due dates'), href: '/bills' },
      { icon: 'people', color: '#D97706', title: N_('Savings groups'), subtitle: N_('Ajo, esusu, susu, chama and stokvel'), href: '/groups' },
      { icon: 'trending-down', color: '#EF4444', title: N_('Debt payoff'), subtitle: N_('Avalanche or snowball, and your debt-free date'), href: '/debts', pro: true },
    ],
  },
  {
    title: N_('Financial tools'),
    items: [
      { icon: 'home', color: '#EF4444', title: N_('Loan & mortgage'), subtitle: N_('Repayments, interest and overpayments'), href: '/tools/loan', pro: true },
      { icon: 'trending-up', color: '#F59E0B', title: N_('Savings growth'), subtitle: N_('See compound interest at work'), href: '/tools/savings', pro: true },
      { icon: 'document-text', color: '#0F766E', title: N_('Annual summary'), subtitle: N_('Your year and estimated tax, as a PDF'), href: '/tax-summary', pro: true },
      { icon: 'swap-horizontal', color: '#10B981', title: N_('Currency converter'), subtitle: N_('Official central bank exchange rates'), href: '/tools/convert', pro: true },
    ],
  },
  {
    title: N_('App'),
    items: [
      { icon: 'pricetags', color: '#EC4899', title: N_('Categories'), subtitle: N_('Add, edit or archive categories'), href: '/categories' },
      { icon: 'settings', color: '#64748B', title: N_('Settings'), subtitle: N_('Currency, export and data'), href: '/settings' },
    ],
  },
];

export default function MoreScreen() {
  return (
    <Screen>
      {SECTIONS.map((section) => (
        <Card key={section.title} style={{ gap: 6 }}>
          <AppText variant="label">{tr(section.title).toUpperCase()}</AppText>
          {section.items.map((item, i) => (
            <ListRowWithDivider key={item.title} item={item} first={i === 0} />
          ))}
        </Card>
      ))}
    </Screen>
  );
}

function ListRowWithDivider({ item, first }: { item: Item; first: boolean }) {
  const { isPro } = usePro();
  return (
    <>
      {!first && <Divider />}
      <ListRow
        icon={item.icon}
        iconColor={item.color}
        title={tr(item.title)}
        subtitle={tr(item.subtitle)}
        right={item.pro && !isPro ? <ProBadge /> : undefined}
        onPress={() => router.push(item.href)}
      />
    </>
  );
}
