import type { Metadata } from 'next';
import './globals.css';
import { PreferencesProvider } from './i18n';

export const metadata: Metadata = {
  title: '21 · Black Hole',
  description: 'A bilingual implementation of the 21-cell Black Hole strategy game with a reproducible computer-assisted first-player win proof.',
  metadataBase: new URL('https://21.skr.moe'),
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
  },
  openGraph: {
    title: '21 · Black Hole',
    description: 'Play the 21-cell Black Hole strategy game and inspect its reproducible computer-assisted proof.',
    url: 'https://21.skr.moe',
    siteName: '21 · Black Hole',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: '21 · Black Hole red and blue triangular board' }],
    locale: 'en_US',
    alternateLocale: ['zh_CN'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: '21 · Black Hole',
    description: 'Play the game and inspect its reproducible computer-assisted proof.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body><PreferencesProvider>{children}</PreferencesProvider></body>
    </html>
  );
}
