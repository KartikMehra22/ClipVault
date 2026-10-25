import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ClipVault',
  description: 'Privacy-first, local-first desktop clipboard manager',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self';"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
