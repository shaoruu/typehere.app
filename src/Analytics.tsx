import { Analytics } from '@vercel/analytics/react';

export function NextAnalytics() {
  // @ts-expect-error sadly
  __START_REMOVE_FOR_ELECTRON__;
  return <Analytics />;
  // @ts-expect-error sadly
  __END_REMOVE_FOR_ELECTRON__;

  return null;
}
