import { Column, Text } from '@expo/ui/jetpack-compose';
import { background, fillMaxSize, paddingAll } from '@expo/ui/jetpack-compose/modifiers';
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
    <Column verticalArrangement="center" modifiers={[fillMaxSize(), background(dark ? '#0B1F1C' : '#F0FDFA'), paddingAll(14)]}>
      <Text color={dark ? '#5EEAD4' : '#0F766E'} maxLines={1} style={{ fontSize: 12, fontWeight: '600' }}>
        {props.title}
      </Text>
      <Text color={props.negative ? '#DC2626' : dark ? '#ECF5F3' : '#0F172A'} maxLines={1} style={{ fontSize: 24, fontWeight: 'bold' }}>
        {props.amount}
      </Text>
      <Text color={dark ? '#9FB8B3' : '#64748B'} maxLines={2} style={{ fontSize: 12 }}>
        {props.detail}
      </Text>
    </Column>
  );
};

export default createWidget<WidgetProps>('SafeToSpend', SafeToSpendWidget, { title: 'BudIT', amount: '—', detail: 'Open BudIT to update', negative: false });
