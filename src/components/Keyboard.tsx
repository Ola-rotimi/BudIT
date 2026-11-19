/**
 * Keeps the focused text field above the keyboard on every screen.
 *
 * Android draws edge to edge, so the window no longer shrinks for the keyboard and a field near the
 * bottom of a form ends up hidden behind it. react-native-keyboard-controller scrolls the focused
 * field into view on both platforms. It isn't part of Expo Go, so there we fall back to a plain
 * ScrollView (which on iOS still makes room for the keyboard).
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { ComponentType, ReactNode } from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';

type KeyboardScrollProps = ScrollViewProps & { bottomOffset?: number };

type Controller = {
  KeyboardProvider: ComponentType<{ children: ReactNode }>;
  KeyboardAwareScrollView: ComponentType<KeyboardScrollProps>;
};

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

function loadController(): Controller | null {
  if (inExpoGo) return null;
  try {
    // Required lazily so Expo Go never loads the missing native module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-keyboard-controller') as Controller;
  } catch (e) {
    console.warn('Keyboard controller unavailable', e);
    return null;
  }
}

const controller = loadController();

/** Wrap the app in this once, at the root. */
export function KeyboardProvider({ children }: { children: ReactNode }) {
  return controller ? <controller.KeyboardProvider>{children}</controller.KeyboardProvider> : <>{children}</>;
}

/** A ScrollView that scrolls the focused field clear of the keyboard, `bottomOffset` above it. */
export function KeyboardScrollView({ bottomOffset = 24, ...props }: KeyboardScrollProps) {
  if (controller) return <controller.KeyboardAwareScrollView bottomOffset={bottomOffset} {...props} />;
  return <ScrollView automaticallyAdjustKeyboardInsets {...props} />;
}
