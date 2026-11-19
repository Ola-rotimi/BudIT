import { Text, VStack } from '@expo/ui/swift-ui';
import { containerBackground, font, foregroundStyle, lineLimit, minimumScaleFactor, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';
import type { WidgetProps } from './types';

/**
 * Home-screen widget: safe to spend until payday. Runs in the widget's own runtime, so everything
 * it needs (colours included) is inside the function and all text arrives ready-formatted in props.
 */
const SafeToSpendWidget = (props: WidgetProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  return (
    <VStack
      alignment="leading"
      spacing={4}
      modifiers={[containerBackground(dark ? '#0B1F1C' : '#F0FDFA', 'widget'), widgetURL('budit://')]}>
      <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(dark ? '#5EEAD4' : '#0F766E'), lineLimit(1)]}>{props.title}</Text>
      <Text modifiers={[font({ size: 26, weight: 'bold', design: 'rounded' }), foregroundStyle(props.negative ? '#DC2626' : dark ? '#ECF5F3' : '#0F172A'), minimumScaleFactor(0.5), lineLimit(1)]}>
        {props.amount}
      </Text>
      <Text modifiers={[font({ size: 12 }), foregroundStyle({ type: 'hierarchical', style: 'secondary' }), lineLimit(2)]}>{props.detail}</Text>
    </VStack>
  );
};

export default createWidget<WidgetProps>('SafeToSpend', SafeToSpendWidget, { title: 'BudIT', amount: '—', detail: 'Open BudIT to update', negative: false });
