import './globals.css';
import { Shell } from '@/components/Shell';

export const metadata = { title: 'ระบบบัญชี', description: 'ระบบบัญชีสำหรับธุรกิจไทย' };
export const dynamic = 'force-dynamic';

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap" />
      </head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
