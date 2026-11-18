import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { tr } from '@/i18n';
import { useTheme } from '@/lib/theme';
import { AppText } from './ui';

type Column = { label: string; color?: string };
type Row = { key: string | number; cells: string[] };

/**
 * Year-by-year schedule, e.g. interest vs principal on a loan. The first column is the period and
 * the rest are right-aligned figures. Long schedules start folded to the first few years.
 */
export function YearTable({ columns, rows, initial = 5 }: { columns: Column[]; rows: Row[]; initial?: number }) {
  const t = useTheme();
  // Folding away one or two rows saves nothing, so short schedules show in full.
  const foldable = rows.length > initial + 2;
  const [expanded, setExpanded] = useState(false);
  const shown = foldable && !expanded ? rows.slice(0, initial) : rows;

  return (
    <View>
      <View style={[styles.row, styles.header, { borderBottomColor: t.border }]}>
        {columns.map((c, i) => (
          <AppText key={c.label} variant="caption" weight="600" numberOfLines={2} style={[i === 0 ? styles.first : styles.cell]}>
            {c.label}
          </AppText>
        ))}
      </View>
      {shown.map((r) => (
        <View
          key={r.key}
          style={[styles.row, { borderBottomColor: t.border }]}
          accessible
          accessibilityLabel={columns.map((c, i) => `${c.label}: ${r.cells[i]}`).join(', ')}
        >
          {r.cells.map((cell, i) => (
            <AppText
              key={i}
              numberOfLines={1}
              adjustsFontSizeToFit
              color={i === 0 ? t.muted : columns[i]?.color}
              style={[styles.value, i === 0 ? styles.first : styles.cell]}
            >
              {cell}
            </AppText>
          ))}
        </View>
      ))}
      {foldable && (
        <Pressable onPress={() => setExpanded((e) => !e)} hitSlop={8} accessibilityRole="button" style={styles.toggle}>
          <AppText weight="600" color={t.primary}>
            {expanded ? tr('Show fewer years') : tr('Show all {0} years', [rows.length])}
          </AppText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth },
  header: { paddingTop: 0 },
  first: { flex: 0.6 },
  cell: { flex: 1, textAlign: 'right' },
  value: { fontSize: 13, fontVariant: ['tabular-nums'] },
  toggle: { alignSelf: 'center', paddingTop: 10 },
});
