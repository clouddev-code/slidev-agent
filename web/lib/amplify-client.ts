'use client';

import { Amplify } from 'aws-amplify';
import outputs from '@/amplify_outputs.json';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';

let configured = false;

export function configureAmplify(): void {
  if (configured) return;
  Amplify.configure(outputs, { ssr: true });
  configured = true;
}

configureAmplify();

export const client = generateClient<Schema>();
