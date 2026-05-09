'use client';

import { Authenticator } from '@aws-amplify/ui-react';
import { Nav } from '@/components/Nav';
import { JobProgress } from '@/components/JobProgress';

export default function JobDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <Authenticator>
      <Nav />
      <JobProgress id={params.id} />
    </Authenticator>
  );
}
