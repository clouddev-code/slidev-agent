'use client';

import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

function RedirectAfterSignIn() {
  const { user } = useAuthenticator((context) => [context.user]);
  const router = useRouter();
  useEffect(() => {
    if (user) router.replace('/generate');
  }, [user, router]);
  return <p className="muted">Redirecting…</p>;
}

export default function SignInPage() {
  return (
    <Authenticator>
      <RedirectAfterSignIn />
    </Authenticator>
  );
}
