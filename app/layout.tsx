import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '21 · Black Hole',
  description: '21 格黑洞数字策略游戏：挑战计算机辅助证明的先手必胜策略。',
  metadataBase: new URL('https://21.skr.moe'),
  openGraph: {
    title: '21 · Black Hole',
    description: '挑战计算机辅助证明的先手必胜策略。',
    url: 'https://21.skr.moe',
    siteName: '21 · Black Hole',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: '21 · Black Hole 极简红蓝棋盘' }],
    locale: 'zh_CN',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: '21 · Black Hole',
    description: '挑战计算机辅助证明的先手必胜策略。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
