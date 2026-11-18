import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import type { IconName } from '@/db/types';
import { useTheme } from '@/lib/theme';
import { AppText } from './ui';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Number pad with PIN dots. Calls `onComplete` once `length` digits are entered; return false to
 * shake and clear (wrong PIN). `extraKey` sits bottom-left, e.g. a Face ID button.
 * Give it a `key` that changes with `length` so a half-typed PIN is cleared.
 */
export function PinPad({
  length,
  onComplete,
  disabled,
  extraKey,
}: {
  length: number;
  onComplete: (pin: string) => Promise<boolean | void> | boolean | void;
  disabled?: boolean;
  extraKey?: { icon: IconName; label: string; onPress: () => void };
}) {
  const t = useTheme();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake] = useState(() => new Animated.Value(0));

  const press = async (digit: string) => {
    if (busy || disabled || pin.length >= length) return;
    const next = pin + digit;
    setPin(next);
    if (next.length < length) return;
    setBusy(true);
    const ok = await onComplete(next);
    setBusy(false);
    setPin('');
    if (ok === false) {
      Animated.sequence(
        [10, -10, 8, -8, 0].map((toValue) => Animated.timing(shake, { toValue, duration: 50, useNativeDriver: true })),
      ).start();
    }
  };

  return (
    <View style={{ gap: 28, alignItems: 'center', opacity: disabled ? 0.4 : 1 }}>
      <Animated.View
        style={[styles.dots, { transform: [{ translateX: shake }] }]}
        accessible
        accessibilityLabel={`${pin.length} of ${length} digits entered`}>
        {Array.from({ length }, (_, i) => (
          <View key={i} style={[styles.dot, { borderColor: t.primary, backgroundColor: i < pin.length ? t.primary : 'transparent' }]} />
        ))}
      </Animated.View>
      <View style={styles.grid}>
        {KEYS.map((k) => (
          <Key key={k} onPress={() => press(k)} label={k} disabled={disabled}>
            <AppText variant="title">{k}</AppText>
          </Key>
        ))}
        {extraKey ? (
          <Key onPress={extraKey.onPress} label={extraKey.label} disabled={busy} plain>
            <Ionicons name={extraKey.icon} size={30} color={t.primary} />
          </Key>
        ) : (
          <View style={styles.key} />
        )}
        <Key onPress={() => press('0')} label="0" disabled={disabled}>
          <AppText variant="title">0</AppText>
        </Key>
        <Key onPress={() => setPin((p) => p.slice(0, -1))} label="Delete" disabled={!pin || busy} plain>
          <Ionicons name="backspace-outline" size={28} color={t.text} />
        </Key>
      </View>
    </View>
  );
}

function Key({ children, onPress, label, disabled, plain }: { children: ReactNode; onPress: () => void; label: string; disabled?: boolean; plain?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.key, !plain && { backgroundColor: pressed ? t.primarySoft : t.card, borderColor: t.border, borderWidth: StyleSheet.hairlineWidth }]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', gap: 16 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 3 * 76 + 2 * 20, gap: 20, justifyContent: 'center' },
  key: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
});
