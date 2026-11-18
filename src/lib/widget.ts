/**
 * Updates the home-screen widget. Widgets need a development or store build: in Expo Go (or on the
 * web) the native module is missing, so the widget code is never loaded and updates do nothing.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { WidgetProps } from '@/widgets/types';

type WidgetHandle = { updateSnapshot: (props: WidgetProps) => void };

let widget: WidgetHandle | null | undefined;

function load(): WidgetHandle | null {
  if (widget !== undefined) return widget;
  widget = null;
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  if (!requireOptionalNativeModule('ExpoWidgets')) return null;
  try {
    // Loaded lazily: importing it where the native module is missing would throw.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    widget = require('../widgets/SafeToSpendWidget').default as WidgetHandle | null;
  } catch (e) {
    console.warn('Widget unavailable', e);
  }
  return widget;
}

export function updateWidget(props: WidgetProps) {
  try {
    load()?.updateSnapshot(props);
  } catch (e) {
    console.warn('Widget update failed', e);
  }
}
