'use client';

import { Authenticator } from '@aws-amplify/ui-react';
import { Nav } from '@/components/Nav';
import { SlideForm } from '@/components/SlideForm';

export default function GeneratePage() {
  return (
    <Authenticator>
      <Nav />
      <h2>新しいスライドを生成</h2>
      <SlideForm />
    </Authenticator>
  );
}
