/** What the Safe to spend widget shows. Everything is formatted (and translated) by the app. */
export type WidgetProps = {
  title: string;
  amount: string;
  detail: string;
  /** Show the amount in red (short before payday). */
  negative: boolean;
};
