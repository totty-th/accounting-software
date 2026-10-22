import './globals.css';
import { Nav } from '@/components/Nav';

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
        <div className="shell">
          <aside className="side">
            <div className="brand"><span className="logo">฿</span>ระบบบัญชี</div>
            <Nav />
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
