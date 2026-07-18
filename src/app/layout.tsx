import type { Metadata } from 'next';
import '../index.css';

export const metadata: Metadata = {
  title: 'Midnight Drop',
  description: 'A Cryptographic Whistleblower Platform Powered by Zero-Knowledge Proofs',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
