import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform, Pressable, StyleSheet, useColorScheme, View } from 'react-native';
import { fromISODate, shortDate, toISODate } from '@/lib/dates';
import { useTheme } from '@/lib/theme';
import { AppText } from './ui';

/** A labelled date input. iOS shows the native compact picker; Android opens the system dialog. */
export function DateField({
  label,
  value,
  onChange,
  minimumDate,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  minimumDate?: Date;
}) {
  const t = useTheme();
  const scheme = useColorScheme();
  const date = fromISODate(value);

  if (Platform.OS === 'ios') {
    return (
      <View style={[styles.row, { backgroundColor: t.inputBg, borderColor: t.border }]}>
        <AppText variant="label" style={{ flex: 1 }}>
          {label}
        </AppText>
        <DateTimePicker
          value={date}
          mode="date"
          display="compact"
          accentColor={t.primary}
          themeVariant={scheme === 'dark' ? 'dark' : 'light'}
          minimumDate={minimumDate}
          onValueChange={(_, d) => onChange(toISODate(d))}
        />
      </View>
    );
  }

  const open = () =>
    DateTimePickerAndroid.open({
      value: date,
      mode: 'date',
      minimumDate,
      onValueChange: (_, d) => onChange(toISODate(d)),
    });

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${shortDate(value)}`}
      style={({ pressed }) => [styles.row, { backgroundColor: t.inputBg, borderColor: t.border }, pressed && { opacity: 0.6 }]}>
      <AppText variant="label" style={{ flex: 1 }}>
        {label}
      </AppText>
      <AppText weight="600">{shortDate(value)}</AppText>
      <Ionicons name="calendar-outline" size={18} color={t.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
});

/** "HH:MM" (24-hour, as stored) to a Date today at that time. */
function timeToDate(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateToTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** A labelled time input ("HH:MM"), shown in the phone's 12- or 24-hour style. */
export function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (hhmm: string) => void }) {
  const t = useTheme();
  const scheme = useColorScheme();
  const date = timeToDate(value);

  if (Platform.OS === 'ios') {
    return (
      <View style={[styles.row, { backgroundColor: t.inputBg, borderColor: t.border }]}>
        <AppText variant="label" style={{ flex: 1 }}>
          {label}
        </AppText>
        <DateTimePicker
          value={date}
          mode="time"
          display="compact"
          accentColor={t.primary}
          themeVariant={scheme === 'dark' ? 'dark' : 'light'}
          onValueChange={(_, d) => onChange(dateToTime(d))}
        />
      </View>
    );
  }

  const shown = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const open = () => DateTimePickerAndroid.open({ value: date, mode: 'time', onValueChange: (_, d) => onChange(dateToTime(d)) });

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${shown}`}
      style={({ pressed }) => [styles.row, { backgroundColor: t.inputBg, borderColor: t.border }, pressed && { opacity: 0.6 }]}>
      <AppText variant="label" style={{ flex: 1 }}>
        {label}
      </AppText>
      <AppText weight="600">{shown}</AppText>
      <Ionicons name="time-outline" size={18} color={t.primary} />
    </Pressable>
  );
}
