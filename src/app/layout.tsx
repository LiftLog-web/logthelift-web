import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';
import NavShell from '@/components/NavShell';
import { ThemeProvider } from '@/lib/ThemeContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { NavGuardProvider } from '@/lib/NavGuardContext';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });

export const metadata: Metadata = {
  title: 'LiftLog — Track Your Fitness Journey',
  description: 'LiftLog helps patients and practitioners track workouts, monitor progress, and build personalized training plans together.',
  openGraph: {
    title: 'LiftLog',
    description: 'Track workouts. Monitor progress. Build better outcomes.',
    url: 'https://logthelift.ca',
    siteName: 'LiftLog',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full`} suppressHydrationWarning>
      <head>
        {/* Set data-theme before React hydrates to prevent flash of wrong theme */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}` }} />
      </head>
      <body className="min-h-full flex flex-col antialiased">
        <ThemeProvider>
          <NavGuardProvider>
            <NavShell />
            <ThemeToggle />
            {children}
          </NavGuardProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
