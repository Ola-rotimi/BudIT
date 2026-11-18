import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { ColorPicker, IconPicker } from '@/components/pickers';
import { AppText, Button, Field, HeaderDeleteButton, IconBadge, Screen, Segmented } from '@/components/ui';
import { archiveCategory, getCategory, saveCategory } from '@/db/queries';
import type { IconName, TxType } from '@/db/types';
import { tr } from '@/i18n';
import { goBack } from '@/lib/navigation';

export default function CategoryScreen() {
  const params = useLocalSearchParams<{ id?: string; type?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const db = useSQLiteContext();

  const [name, setName] = useState('');
  const [type, setType] = useState<TxType>(params.type === 'income' ? 'income' : 'expense');
  const [icon, setIcon] = useState<IconName>('pricetag');
  const [color, setColor] = useState('#6366F1');

  useEffect(() => {
    if (!id) return;
    getCategory(db, id).then((c) => {
      if (!c) return;
      setName(c.name);
      setType(c.type);
      setIcon(c.icon);
      setColor(c.color);
    });
  }, [db, id]);

  const save = async () => {
    if (!name.trim()) return Alert.alert(tr('Give the category a name'));
    await saveCategory(db, { id, name: name.trim(), type, icon, color });
    goBack();
  };

  const archive = () =>
    Alert.alert(tr('Archive category?'), tr('It will be hidden from pickers and its budget removed. Past transactions keep this category.'), [
      { text: tr('Cancel'), style: 'cancel' },
      {
        text: tr('Archive'),
        style: 'destructive',
        onPress: async () => {
          await archiveCategory(db, id!);
          goBack();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: id ? tr('Edit category') : tr('New category'), headerRight: id ? () => <HeaderDeleteButton label={tr('Archive category')} icon="archive-outline" onPress={archive} /> : undefined }} />
      <View style={{ alignItems: 'center', gap: 8 }}>
        <IconBadge icon={icon} color={color} size={64} />
        <AppText variant="heading">{name || tr('Category name')}</AppText>
      </View>
      {!id && (
        <Segmented<TxType>
          value={type}
          onChange={setType}
          options={[
            { value: 'expense', label: tr('Expense') },
            { value: 'income', label: tr('Income') },
          ]}
        />
      )}
      <Field label={tr('Name')} value={name} onChangeText={setName} placeholder={tr('e.g. Coffee')} autoFocus={!id} />
      <ColorPicker value={color} onChange={setColor} />
      <IconPicker value={icon} color={color} onChange={setIcon} />
      <Button title={id ? tr('Save changes') : tr('Create category')} icon="checkmark" onPress={save} />
    </Screen>
  );
}
