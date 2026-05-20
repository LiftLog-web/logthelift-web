import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';

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
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-[#0f1117] text-white antialiased">
        {children}
      </body>
    </html>
  );
}
