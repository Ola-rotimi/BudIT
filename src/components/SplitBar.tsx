import { StyleSheet, View } from 'react-native';
import { BUCKETS, type Bucket } from '@/lib/smartBudget';
import { AppText } from './ui';

const ORDER: Bucket[] = ['needs', 'wants', 'savings'];

/** A single bar split into needs / wants / savings, with a labelled legend underneath. */
export function SplitBar({ split, amounts }: { split: Record<Bucket, number>; amounts?: Record<Bucket, string> }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.bar} accessible accessibilityLabel={ORDER.map((b) => `${BUCKETS[b].label} ${split[b]}%`).join(', ')}>
        {ORDER.map((b) => (
          <View key={b} style={{ flex: split[b], backgroundColor: BUCKETS[b].color }} />
        ))}
      </View>
      <View style={styles.legend}>
        {ORDER.map((b) => (
          <View key={b} style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={styles.legendLabel}>
              <View style={[styles.dot, { backgroundColor: BUCKETS[b].color }]} />
              <AppText variant="caption" numberOfLines={1}>
                {BUCKETS[b].label} {split[b]}%
              </AppText>
            </View>
            {amounts ? (
              <AppText weight="700" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                {amounts[b]}
              </AppText>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', gap: 2 },
  legend: { flexDirection: 'row', gap: 10 },
  legendLabel: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
