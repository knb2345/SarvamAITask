import './globals.css';
import type { Metadata } from 'next';
import Rail from './Rail';

export const metadata: Metadata = {
  title: 'Kivi — what it knows',
  description: 'Voice-first computing with a memory you can read.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <Rail />
          <div className="main">{children}</div>
        </div>
      </body>
    </html>
  );
}
