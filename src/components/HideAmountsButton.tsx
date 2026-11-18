import { tr } from '@/i18n';
import { useSettings } from '@/lib/settings';
import { HeaderButton } from './ui';

/** Eye button for screen headers: hides or shows your balances and amounts everywhere at once. */
export function HideAmountsButton() {
  const { hideAmounts, setHideAmounts } = useSettings();
  return (
    <HeaderButton
      icon={hideAmounts ? 'eye-off-outline' : 'eye-outline'}
      label={hideAmounts ? tr('Show amounts') : tr('Hide amounts')}
      onPress={() => setHideAmounts(!hideAmounts)}
    />
  );
}
