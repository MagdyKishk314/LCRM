import type { Metadata } from 'next';
import { Playfair_Display } from 'next/font/google';
import 'react-loading-skeleton/dist/skeleton.css';
import './globals.css';
import { InviteProvider } from '@/lib/invite/provider';

/**
 * Display face, matching landcaller.com.
 *
 * `next/font` self-hosts the files at build time, so there is no request to a font CDN
 * at runtime — which also means no flash of fallback text and one less third party.
 */
const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-playfair',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'LandCaller CRM',
  description: 'Modular multi-tenant CRM for land investing teams.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={playfair.variable}>
      {/*
        Extensions (Grammarly, ColorZilla, theme injectors) stamp attributes onto <body>
        before React hydrates, which otherwise reports a hydration mismatch that has
        nothing to do with the app. This suppresses the warning for this element's own
        attributes only — one level deep, so real mismatches inside the tree still surface.
      */}
      {/*
        Mounted at the root so an invite's one-time link renders above every page, and
        survives the revalidation the invite itself triggers. See lib/invite/provider.
      */}
      <body suppressHydrationWarning>
        <InviteProvider>{children}</InviteProvider>
      </body>
    </html>
  );
}
