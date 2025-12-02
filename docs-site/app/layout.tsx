import './global.css';
import { RootProvider } from 'fumadocs-ui/provider';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  metadataBase: new URL('https://mcpguard.dev'),
  title: {
    template: '%s | MCP Guard',
    default: 'MCP Guard - Zero-Trust MCP Security',
  },
  description:
    'Use local MCP servers securely with zero-trust isolation while reducing context window token usage by up to 98%.',
  icons: {
    icon: '/icon.png',
  },
  openGraph: {
    title: 'MCP Guard',
    description:
      'Use local MCP servers securely with zero-trust isolation while reducing context window token usage by up to 98%.',
    images: ['/icon.png'],
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}

