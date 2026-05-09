'use client';

import Link from 'next/link';
import { useAuthenticator } from '@aws-amplify/ui-react';

export function Nav() {
  const { user, signOut } = useAuthenticator((c) => [c.user]);
  return (
    <header className="nav">
      <h1>
        <Link href="/">Slidev Agent</Link>
      </h1>
      <nav>
        <Link href="/generate">New</Link>
        <Link href="/dashboard">History</Link>
        {user ? (
          <a href="#" onClick={(e) => { e.preventDefault(); signOut(); }}>
            Sign out
          </a>
        ) : (
          <Link href="/signin">Sign in</Link>
        )}
      </nav>
    </header>
  );
}
