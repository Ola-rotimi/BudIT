import { router } from 'expo-router';

/**
 * Closes the current screen. If there's nothing to go back to (e.g. the screen was opened from a
 * link, or the navigator was just reset), goes Home instead of raising an unhandled GO_BACK.
 */
export function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

