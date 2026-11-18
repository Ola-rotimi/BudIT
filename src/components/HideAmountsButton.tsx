import { tr } from '@/i18n';
import { useSecurity } from '@/lib/security';
import { useSettings } from '@/lib/settings';
import { useReauth } from './Reauth';
import { HeaderButton } from './ui';

/**
 * Hides or shows amounts everywhere. Hiding is instant; showing them again asks for the PIN (or
 * Face ID), so someone holding the phone can't simply tap the eye.
 */
export function useAmountsToggle() {
  const { hideAmounts, setHideAmounts } = useSettings();
  const { safeMode } = useSecurity();
  const confirm = useReauth();
  const hidden = hideAmounts || safeMode;
  const toggle = async () => {
    if (!hidden) return setHideAmounts(true);
    if (await confirm(tr('Show your amounts'))) await setHideAmounts(false);
  };
  return { hidden, toggle };
}

/** Eye button for screen headers: hides or shows your balances and amounts everywhere at once. */
export function HideAmountsButton() {
  const { hidden, toggle } = useAmountsToggle();
  return <HeaderButton icon={hidden ? 'eye-off-outline' : 'eye-outline'} label={hidden ? tr('Show amounts') : tr('Hide amounts')} onPress={toggle} />;
}
