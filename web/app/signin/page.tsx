'use client';

import { Authenticator } from '@aws-amplify/ui-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function SignInPage() {
  const router = useRouter();
  return (
    <Authenticator>
      {({ user }) => {
        // After sign-in, jump to /generate
        useEffect(() => {
          if (user) router.replace('/generate');
        }, [user]);
        return <p className="muted">Redirecting…</p>;
      }}
    </Authenticator>
  );
}
