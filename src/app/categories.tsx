import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Card, Divider, HeaderButton, ListRow, Loading, Screen, Segmented } from '@/components/ui';
import { listCategories } from '@/db/queries';
import type { IconName, TxType } from '@/db/types';
import { useQuery } from '@/hooks/useQuery';
import { tr } from '@/i18n';

export default function CategoriesScreen() {
  const [type, setType] = useState<TxType>('expense');
  const categories = useQuery(`categories:${type}`, (db) => listCategories(db, type));

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: tr('Categories'),
          headerRight: () => (
            <HeaderButton icon="add" label={tr('New category')} onPress={() => router.push({ pathname: '/category', params: { type } })} />
          ),
        }}
      />
      <Segmented<TxType>
        value={type}
        onChange={setType}
        options={[
          { value: 'expense', label: tr('Expense') },
          { value: 'income', label: tr('Income') },
        ]}
      />
      {!categories ? (
        <Loading />
      ) : (
        <Card style={{ gap: 4 }}>
          {categories.map((c, i) => (
            <CategoryItem key={c.id} first={i === 0} {...c} />
          ))}
        </Card>
      )}
    </Screen>
  );
}

function CategoryItem({ id, name, icon, color, first }: { id: number; name: string; icon: IconName; color: string; first: boolean }) {
  return (
    <>
      {!first && <Divider />}
      <ListRow icon={icon} iconColor={color} title={name} onPress={() => router.push({ pathname: '/category', params: { id: String(id) } })} />
    </>
  );
}
