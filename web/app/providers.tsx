'use client';

import type { ReactNode } from 'react';
import { configureAmplify } from '@/lib/amplify-client';

configureAmplify();

export function Providers({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
