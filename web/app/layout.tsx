import './globals.css';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import type { ReactNode } from 'react';
import { Providers } from './providers';

export const metadata = {
  title: 'Slidev Agent',
  description: 'AI-powered Slidev presentation generator',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <Providers>
          <Authenticator.Provider>
            <main className="container">{children}</main>
          </Authenticator.Provider>
        </Providers>
      </body>
    </html>
  );
}
