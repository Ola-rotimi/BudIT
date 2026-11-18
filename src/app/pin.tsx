import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { PinPad } from '@/components/PinPad';
import { AppText, Segmented } from '@/components/ui';
import { biometricLabel, useSecurity } from '@/lib/security';
import { useTheme } from '@/lib/theme';

type Mode = 'set' | 'change' | 'disable';
type Step = 'current' | 'new' | 'confirm';

const TITLES: Record<Mode, string> = { set: 'Set up app lock', change: 'Change PIN', disable: 'Turn off app lock' };

/** `mode=set` turns the lock on, `change` replaces the PIN, `disable` turns it off. The last two ask for the current PIN first. */
export default function PinScreen() {
  const t = useTheme();
  const { mode = 'set' } = useLocalSearchParams<{ mode?: Mode }>();
  const security = useSecurity();
  const [step, setStep] = useState<Step>(mode === 'set' ? 'new' : 'current');
  const [length, setLength] = useState<4 | 6>(security.config.pinLength);
  const [first, setFirst] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const onCurrent = async (pin: string) => {
    const result = await security.checkPin(pin);
    if (!result.ok) {
      setMessage(result.lockedUntil ? 'Too many attempts. Try again later.' : `Wrong PIN. ${result.attemptsLeft} attempts left.`);
      return false;
    }
    if (mode === 'disable') {
      await security.disableLock();
      router.back();
      return;
    }
    setMessage(null);
    setStep('new');
  };

  const onNew = (pin: string) => {
    if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
      setMessage('That PIN is too easy to guess. Avoid repeated or sequential digits.');
      return false;
    }
    setFirst(pin);
    setMessage(null);
    setStep('confirm');
  };

  const onConfirm = async (pin: string) => {
    if (pin !== first) {
      setMessage('The PINs didn’t match. Start again.');
      setStep('new');
      return false;
    }
    await (mode === 'set' ? security.enableLock(pin, length) : security.changePin(pin, length));
    router.back();
  };

  const prompt =
    step === 'current' ? 'Enter your current PIN' : step === 'new' ? `Choose a ${length}-digit PIN` : 'Enter the same PIN again';

  return (
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
      <Stack.Screen options={{ title: TITLES[mode] }} />
      <View style={{ gap: 10, alignItems: 'center' }}>
        <AppText variant="heading">{prompt}</AppText>
        <AppText variant="caption" color={message ? t.expense : t.muted} style={{ textAlign: 'center' }}>
          {message ??
            (step === 'new' && mode === 'set'
              ? `You’ll need it to open BudT${security.biometricKind ? `, unless you use ${biometricLabel(security.biometricKind)}` : ''}.`
              : ' ')}
        </AppText>
        {step === 'new' && (
          <View style={{ width: 220 }}>
            <Segmented<'4' | '6'>
              value={String(length) as '4' | '6'}
              onChange={(v) => setLength(Number(v) as 4 | 6)}
              options={[
                { value: '4', label: '4 digits' },
                { value: '6', label: '6 digits' },
              ]}
            />
          </View>
        )}
      </View>
      <PinPad
        key={`${step}-${step === 'current' ? security.config.pinLength : length}`}
        length={step === 'current' ? security.config.pinLength : length}
        onComplete={step === 'current' ? onCurrent : step === 'new' ? onNew : onConfirm}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'space-evenly', padding: 16 },
});
