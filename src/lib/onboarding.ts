import type { Href } from 'expo-router';

/**
 * Where to go once the walkthrough finishes. The tabs only mount after onboarding completes,
 * so Home picks this up on mount (e.g. to open Smart budget when the user asked for it).
 */
let pending: Href | null = null;

export function openAfterOnboarding(href: Href) {
  pending = href;
}

export function takePendingRoute() {
  const href = pending;
  pending = null;
  return href;
}
