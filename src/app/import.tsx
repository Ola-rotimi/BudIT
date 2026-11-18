import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AccountPicker } from '@/components/pickers';
import { ProScreen } from '@/components/ProLock';
import { MissingRateError } from '@/db/currency';
import { AppText, Button, Card, Divider, Loading, Screen, Segmented } from '@/components/ui';
import { defaultAccountId, findDuplicates, importTransactions, listCategories, type ImportRow } from '@/db/queries';
import type { Category } from '@/db/types';
import { useQuery } from '@/hooks/useQuery';
import { shortDate } from '@/lib/dates';
import { usePro } from '@/lib/pro';
import { useMoney } from '@/lib/settings';
import {
  detectColumns,
  parseCsv,
  readRows,
  suggestCategory,
  type ColumnMap,
  type DateOrder,
  type ParsedStatement,
} from '@/lib/statementImport';
import { useTheme } from '@/lib/theme';
import { tr, N_ } from '@/i18n';
import { goBack } from '@/lib/navigation';

const PREVIEW_LIMIT = 200;

type Field = keyof ColumnMap;
const FIELD_LABELS: Record<Field, string> = {
  date: N_('Date'),
  description: N_('Description'),
  amount: N_('Amount (+/−)'),
  debit: N_('Money out'),
  credit: N_('Money in'),
};

/** Imports a bank or mobile-money statement exported as CSV. */
export default function ImportScreen() {
  const { isPro } = usePro();
  const t = useTheme();
  const db = useSQLiteContext();
  const categories = useQuery('categories:all', (d) => listCategories(d));
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [fileName, setFileName] = useState('');
  const [columns, setColumns] = useState<ColumnMap | null>(null);
  const [order, setOrder] = useState<DateOrder>('dmy');
  const [accountId, setAccountId] = useState<number | null>(null);

  useEffect(() => {
    defaultAccountId(db).then((id) => setAccountId((current) => current ?? id));
  }, [db]);

  if (!isPro) {
    return (
      <ProScreen
        screenTitle={tr('Import statement')}
        title={tr('Import your bank statements')}
        message={tr('BudT Pro reads CSV statements from your bank or mobile-money app, sorts each line into a category and skips anything already recorded.')}
      />
    );
  }

  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', '*/*'], copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const file = new File(res.assets[0].uri);
    try {
      const text = await file.text();
      const detected = detectColumns(parseCsv(text));
      if (!detected) {
        return Alert.alert(
          tr('Couldn’t read that statement'),
          tr('BudT needs a CSV file with a date column and an amount (or money in / money out) column. If your bank gives a PDF or Excel file, open it in a spreadsheet app and save it as CSV.'),
        );
      }
      setParsed(detected);
      setColumns(detected.columns);
      setFileName(res.assets[0].name);
    } catch {
      Alert.alert(tr('Couldn’t open the file'), tr('Please try again, or export the statement again from your bank.'));
    } finally {
      if (file.exists) file.delete();
    }
  };

  if (!categories) return <Loading />;
  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Import statement') }} />
      {!parsed || !columns ? (
        <Card style={{ gap: 12 }}>
          <Ionicons name="document-text-outline" size={36} color={t.primary} />
          <AppText variant="heading">{tr('Import a bank or mobile-money statement')}</AppText>
          <AppText variant="caption">{tr('1. In your bank or mobile-money app (or internet banking), download your statement as CSV. For Excel files, open them and “Save as” CSV.\n2. Pick the file here. BudT finds the dates and amounts, suggests categories and skips anything you’ve already recorded.\n3. Check the preview and import. The file is read on your phone and never uploaded.')}</AppText>
          <Button title={tr('Choose CSV file')} icon="folder-open-outline" onPress={pick} />
        </Card>
      ) : (
        <Preview
          parsed={parsed}
          fileName={fileName}
          columns={columns}
          setColumns={setColumns}
          order={order}
          setOrder={setOrder}
          accountId={accountId}
          setAccountId={setAccountId}
          categories={categories}
          onReset={() => setParsed(null)}
        />
      )}
    </Screen>
  );
}

function Preview({
  parsed,
  fileName,
  columns,
  setColumns,
  order,
  setOrder,
  accountId,
  setAccountId,
  categories,
  onReset,
}: {
  parsed: ParsedStatement;
  fileName: string;
  columns: ColumnMap;
  setColumns: (c: ColumnMap) => void;
  order: DateOrder;
  setOrder: (o: DateOrder) => void;
  accountId: number | null;
  setAccountId: (id: number) => void;
  categories: Category[];
  onReset: () => void;
}) {
  const t = useTheme();
  const db = useSQLiteContext();
  const { money } = useMoney();
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const { rows, skipped } = useMemo(() => readRows(parsed, columns, order), [parsed, columns, order]);

  // Suggested category for each line, falling back to the "Other" categories.
  const withCategories = useMemo(() => {
    const byName = new Map(categories.map((c) => [`${c.type}:${c.name.toLowerCase()}`, c]));
    const fallback = (type: string) => byName.get(`${type}:${type === 'income' ? 'other income' : 'other'}`) ?? categories.find((c) => c.type === type);
    return rows.map((r) => {
      const name = suggestCategory(r.description, r.type);
      const category = (name && byName.get(`${r.type}:${name.toLowerCase()}`)) || fallback(r.type);
      return { ...r, category };
    });
  }, [rows, categories]);

  const duplicates = useQuery(`import:dups:${accountId}:${rows.length}:${order}:${JSON.stringify(columns)}`, (d) =>
    accountId ? findDuplicates(d, accountId, rows) : Promise.resolve(rows.map(() => false)),
  );

  const chosen = withCategories.filter((r, i) => !excluded.has(r.line) && !duplicates?.[i] && r.category);
  const dupCount = duplicates?.filter(Boolean).length ?? 0;

  const toggle = (line: number) =>
    setExcluded((s) => {
      const next = new Set(s);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });

  const run = async () => {
    if (!accountId || !chosen.length) return;
    setBusy(true);
    try {
      const toImport: ImportRow[] = chosen.map((r) => ({ date: r.date, amount: r.amount, type: r.type, note: r.description, category_id: r.category!.id }));
      await importTransactions(db, accountId, toImport);
      Alert.alert(tr('Statement imported'), tr('{0} transaction{1} added.{2}', [toImport.length, toImport.length === 1 ? '' : 's', dupCount ? tr(' {0} already in BudT were skipped.', [dupCount]) : '']));
      goBack();
    } catch (e) {
      if (e instanceof MissingRateError) Alert.alert(tr('No exchange rate yet'), tr('Connect to the internet once so BudT can get the official rate, then try again.'));
      else Alert.alert(tr('Import failed'), tr('Nothing was imported. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <View style={styles.between}>
          <View style={{ flex: 1 }}>
            <AppText weight="700" numberOfLines={1}>
              {fileName}
            </AppText>
            <AppText variant="caption">{tr('{0} transaction{1} found{2}', [rows.length, rows.length === 1 ? '' : 's', skipped ? tr(' · {0} lines skipped (no date or amount)', [skipped]) : ''])}</AppText>
          </View>
          <Pressable onPress={onReset} hitSlop={8} accessibilityRole="button">
            <AppText weight="600" color={t.primary}>{tr('Change file')}</AppText>
          </Pressable>
        </View>
        <Divider />
        <AppText variant="label">{tr('Import into')}</AppText>
        <AccountPicker value={accountId} onChange={setAccountId} />
      </Card>

      <Card>
        <AppText variant="heading">{tr('Columns')}</AppText>
        <AppText variant="caption">{tr('BudT guessed these from the file. Tap to change if something looks wrong.')}</AppText>
        {(['date', 'description', ...(columns.amount !== -1 ? ['amount'] : ['debit', 'credit'])] as Field[]).map((field) => (
          <View key={field} style={{ gap: 6 }}>
            <AppText weight="600">{tr(FIELD_LABELS[field])}</AppText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {parsed.headers.map((h, idx) => {
                const active = columns[field] === idx;
                return (
                  <Pressable
                    key={idx}
                    onPress={() => setColumns({ ...columns, [field]: idx })}
                    style={[styles.chip, { borderColor: active ? t.primary : t.border, backgroundColor: active ? t.primarySoft : t.card }]}>
                    <AppText variant="caption" color={active ? t.primary : t.text}>
                      {h || `Column ${idx + 1}`}
                    </AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ))}
        <Segmented<DateOrder>
          value={order}
          onChange={setOrder}
          options={[
            { value: 'dmy', label: tr('Day/Month/Year') },
            { value: 'mdy', label: tr('Month/Day/Year') },
          ]}
        />
      </Card>

      <Card style={{ gap: 6 }}>
        <AppText variant="heading">{tr('Preview')}</AppText>
        {dupCount > 0 && <AppText variant="caption">{tr('{0} already recorded in this account will be skipped (shown faded).', [dupCount])}</AppText>}
        {withCategories.slice(0, PREVIEW_LIMIT).map((r, i) => {
          const dup = !!duplicates?.[i];
          const off = dup || excluded.has(r.line);
          return (
            <Pressable key={r.line} onPress={() => !dup && toggle(r.line)} style={[styles.row, off && { opacity: 0.4 }]} accessibilityRole="checkbox" accessibilityState={{ checked: !off }}>
              <Ionicons name={off ? 'square-outline' : 'checkbox'} size={20} color={off ? t.muted : t.primary} />
              <View style={{ flex: 1 }}>
                <AppText numberOfLines={1}>{r.description || tr('(no description)')}</AppText>
                <AppText variant="caption" numberOfLines={1}>
                  {shortDate(r.date)} · {r.category ? tr(r.category.name) : tr('Uncategorised')}
                  {dup ? tr(' · already in BudT') : ''}
                </AppText>
              </View>
              <AppText weight="700" color={r.type === 'income' ? t.income : undefined}>
                {r.type === 'income' ? '+' : '−'}
                {money(r.amount)}
              </AppText>
            </Pressable>
          );
        })}
        {withCategories.length > PREVIEW_LIMIT && (
          <AppText variant="caption">{tr('…and {0} more, which will also be imported.', [withCategories.length - PREVIEW_LIMIT])}</AppText>
        )}
      </Card>

      <Button
        title={busy ? tr('Importing…') : tr('Import {0} transaction{1}', [chosen.length, chosen.length === 1 ? '' : 's'])}
        icon="download-outline"
        onPress={run}
        disabled={busy || !chosen.length || !accountId}
      />
      <AppText variant="caption" style={{ textAlign: 'center' }}>{tr('You can change any category afterwards in Activity.')}</AppText>
    </>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
});
