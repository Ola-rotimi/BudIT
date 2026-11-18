import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { deviceLanguage, LANGUAGES, tr, type LanguagePreference } from '@/i18n';
import { useSettings } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { AppText } from './ui';

/** Language choices: follow the phone, or pick one. `compact` shows chips (for the walkthrough). */
export function LanguagePicker({ compact }: { compact?: boolean }) {
  const t = useTheme();
  const { language, setLanguage } = useSettings();
  const device = LANGUAGES.find((l) => l.code === deviceLanguage());

  if (compact) {
    return (
      <View style={styles.chips} accessibilityRole="radiogroup">
        {LANGUAGES.map((l) => {
          const active = language === l.code || (language === 'system' && device?.code === l.code);
          return (
            <Pressable
              key={l.code}
              onPress={() => setLanguage(l.code)}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              style={[styles.chip, { borderColor: active ? t.primary : t.border, backgroundColor: active ? t.primarySoft : t.card }]}>
              <AppText variant="caption" weight="700" color={active ? t.primary : t.text}>
                {l.name}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    );
  }

  const options: { value: LanguagePreference; label: string; note?: string }[] = [
    { value: 'system', label: tr('Phone language'), note: device ? device.name : 'English' },
    ...LANGUAGES.map((l) => ({ value: l.code as LanguagePreference, label: l.name, note: l.reviewed ? undefined : tr('Draft translation') })),
  ];
  return (
    <View style={{ gap: 2 }} accessibilityRole="radiogroup">
      {options.map((o) => {
        const active = language === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => setLanguage(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
            <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={20} color={active ? t.primary : t.muted} />
            <AppText style={{ flex: 1 }}>{o.label}</AppText>
            {o.note ? <AppText variant="caption">{o.note}</AppText> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  chip: { borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
});
