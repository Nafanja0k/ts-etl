import type {Metadata} from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nobl9-Inspired Serverless Telemetry ETL Engine',
  description: 'Stateless, pull-based Telemetry ETL & Backfill Engine with S3 distributed locking, monotonic watermarks, push-down downsampling, and Prometheus Remote-Write.',
  openGraph: {
    title: 'Nobl9-Inspired Serverless Telemetry ETL Engine',
    description: 'Stateless, pull-based Telemetry ETL & Backfill Engine with S3 distributed locking, monotonic watermarks, push-down downsampling, and Prometheus Remote-Write.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Nobl9-Inspired Serverless Telemetry ETL Engine',
    description: 'Stateless, pull-based Telemetry ETL & Backfill Engine with S3 distributed locking, monotonic watermarks, push-down downsampling, and Prometheus Remote-Write.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className="bg-slate-950 text-slate-100 antialiased selection:bg-cyan-500/20 selection:text-cyan-300 min-h-screen">
        {children}
      </body>
    </html>
  );
}
