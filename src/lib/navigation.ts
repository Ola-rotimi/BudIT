import { router } from 'expo-router';

/**
 * Closes the current screen. If there's nothing to go back to (e.g. the screen was opened from a
 * link, or the navigator was just reset), goes Home instead of raising an unhandled GO_BACK.
 */
export function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** When the PIN screen was last opened on purpose. Module state, so it resets when the app reloads. */
let pinOpenedAt = 0;

/** Opens the PIN screen to set up, change or turn off the app lock. */
export function openPinScreen(mode: 'set' | 'change' | 'disable') {
  pinOpenedAt = Date.now();
  router.push({ pathname: '/pin', params: { mode } });
}

/**
 * False when the PIN screen appears without being opened from Settings, e.g. restored after a
 * reload or reached through a link. It then closes itself instead of greeting the user at launch.
 */
export function pinScreenRequested() {
  return Date.now() - pinOpenedAt < 10_000;
}
