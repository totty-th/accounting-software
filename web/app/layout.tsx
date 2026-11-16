import './globals.css';
import { Shell } from '@/components/Shell';
import { currentUser } from '@/lib/auth';
import { enabledModules } from '@/lib/modules';

export const metadata = { title: 'ระบบบัญชี', description: 'ระบบบัญชีสำหรับธุรกิจไทย' };
export const dynamic = 'force-dynamic';

export default async function Root({ children }: { children: React.ReactNode }) {
  const u = await currentUser();
  const modules = u ? await enabledModules() : [];
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap" />
      </head>
      <body>
        <Shell user={u ? { name: u.displayName, role: u.role } : null} modules={modules}>{children}</Shell>
      </body>
    </html>
  );
}
