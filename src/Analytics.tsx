import { Analytics } from '@vercel/analytics/react';
import isElectron from 'is-electron';

export function NextAnalytics() {
  if (isElectron()) {
    return null;
  }

  return <Analytics />;
}
