# TMS PDC Warehouse — Setup Supabase Realtime

1. Buat project di Supabase.
2. Authentication > Providers > Email: aktifkan Email.
3. SQL Editor > New query > paste seluruh `supabase/schema.sql` > Run.
4. Authentication > Users > Add user: buat akun email/password untuk pengguna.
5. Settings > API: salin Project URL dan anon public key.
6. Isi `auth-config.js`:
   const SUPABASE_URL = '...';
   const SUPABASE_ANON_KEY = '...';
7. Commit ke GitHub. Vercel akan redeploy otomatis.
8. Login menggunakan email/password Supabase.

## Catatan
- URL dan anon key boleh berada di frontend Supabase; keamanan akses database tetap ditangani RLS.
- Reset Data Lokal tidak menghapus data cloud.
- Video tetap lokal di perangkat dan tidak di-upload ke database.
- Cloud realtime menyinkronkan Observations, Master Process, PIC, Rating Factor, dan Study Settings.
