import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { PinPad } from '@/components/PinPad';
import { AppText, Segmented } from '@/components/ui';
import { biometricLabel, useSecurity } from '@/lib/security';
import { useTheme } from '@/lib/theme';
import { N_, tr } from '@/i18n';
import { goBack, pinScreenRequested } from '@/lib/navigation';

type Mode = 'set' | 'change' | 'disable';
type Step = 'current' | 'new' | 'confirm';

const TITLES: Record<Mode, string> = { set: N_('Set up app lock'), change: N_('Change PIN'), disable: N_('Turn off app lock') };

/** `mode=set` turns the lock on, `change` replaces the PIN, `disable` turns it off. The last two ask for the current PIN first. */
export default function PinScreen() {
  const t = useTheme();
  const { mode = 'set' } = useLocalSearchParams<{ mode?: Mode }>();
  const security = useSecurity();
  // Only show when opened from Settings just now, never as a screen restored at launch.
  const [requested] = useState(pinScreenRequested);
  useEffect(() => {
    if (!requested) goBack();
  }, [requested]);
  const [step, setStep] = useState<Step>(mode === 'set' ? 'new' : 'current');
  const [length, setLength] = useState<4 | 6>(security.config.pinLength);
  const [first, setFirst] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const onCurrent = async (pin: string) => {
    const result = await security.checkPin(pin);
    if (!result.ok) {
      setMessage(result.lockedUntil ? tr('Too many attempts. Try again later.') : tr('Wrong PIN. {0} attempts left.', [result.attemptsLeft]));
      return false;
    }
    if (mode === 'disable') {
      if (await attempt(() => security.disableLock())) goBack();
      return;
    }
    setMessage(null);
    setStep('new');
  };

  const onNew = (pin: string) => {
    if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
      setMessage(tr('That PIN is too easy to guess. Avoid repeated or sequential digits.'));
      return false;
    }
    setFirst(pin);
    setMessage(null);
    setStep('confirm');
  };

  const onConfirm = async (pin: string) => {
    if (pin !== first) {
      setMessage(tr('The PINs didn’t match. Start again.'));
      setStep('new');
      return false;
    }
    if (await attempt(() => (mode === 'set' ? security.enableLock(pin, length) : security.changePin(pin, length)))) goBack();
    else setStep('new');
  };

  /** Runs a keychain update, telling the user (instead of silently failing) if the phone refuses it. */
  const attempt = async (fn: () => Promise<void>) => {
    try {
      await fn();
      return true;
    } catch (e) {
      console.warn('App lock update failed', e);
      Alert.alert(tr('Couldn’t save your PIN'), tr('Your phone’s secure storage didn’t accept it: {0}. Nothing was changed.', [e instanceof Error ? e.message : String(e)]));
      return false;
    }
  };

  const prompt =
    step === 'current' ? tr('Enter your current PIN') : step === 'new' ? tr('Choose a {0}-digit PIN', [length]) : tr('Enter the same PIN again');

  if (!requested) return null;
  return (
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
      <Stack.Screen
        options={{
          title: tr(TITLES[mode]),
          // Leaving without finishing changes nothing: the lock stays as it was.
          headerLeft: () => (
            <Pressable onPress={() => goBack()} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr('Cancel')}>
              <AppText weight="600" color={t.primary}>{tr('Cancel')}</AppText>
            </Pressable>
          ),
        }}
      />
      <View style={{ gap: 10, alignItems: 'center' }}>
        <AppText variant="heading">{prompt}</AppText>
        <AppText variant="caption" color={message ? t.expense : t.muted} style={{ textAlign: 'center' }}>
          {message ?? (step === 'new' && mode === 'set' ? tr('You’ll need it to open BudT{0}.', [security.biometricKind ? tr(', unless you use {0}', [biometricLabel(security.biometricKind)]) : '']) : ' ')}
        </AppText>
        {step === 'new' && (
          <View style={{ width: 220 }}>
            <Segmented<'4' | '6'>
              value={String(length) as '4' | '6'}
              onChange={(v) => setLength(Number(v) as 4 | 6)}
              options={[
                { value: '4', label: tr('4 digits') },
                { value: '6', label: tr('6 digits') },
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
