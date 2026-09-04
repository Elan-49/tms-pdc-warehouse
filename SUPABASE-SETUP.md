# TMS PDC Warehouse — Setup Supabase Realtime

1. Authentication > Providers > Email: aktifkan Email.
2. SQL Editor > New query > paste seluruh `supabase/schema.sql` > Run. Ini mempertahankan data lama dan mengganti policy RLS ke model RBAC.
3. Settings > API: gunakan Project URL dan publishable/anon key pada `auth-config.js`. Jangan pernah memasukkan `service_role`.
4. Commit ke GitHub. Vercel akan redeploy otomatis.
5. Buat akun admin pertama melalui form Buat Akun. Akun baru otomatis berstatus `pending`.
6. Supabase Authentication > Users: salin UUID akun admin pertama. Jalankan bootstrap SQL pada `SECURITY-OPERATIONS.md` untuk menjadikannya `admin + approved`.
7. Login sebagai admin. Menu `User Management` dipakai untuk menyetujui pengguna lain dan menentukan role `viewer`, `analyst`, atau `admin`.
8. Jalankan seluruh checklist `SECURITY-TEST-PLAN.md` sebelum dipakai sebagai aplikasi produksi internal.

## Catatan

Build ini menggunakan mode produksi Supabase-only. Jangan kosongkan URL/key pada deployment publik.
- Project URL dan publishable/anon key boleh berada di frontend; `service_role` tidak boleh. Keamanan data ditentukan oleh RLS + RBAC.
- Reset/cache lokal tidak menghapus data cloud.
- Logout menghapus cache data lokal browser; data cloud tetap ada.
- Video tetap lokal di perangkat dan tidak di-upload ke database.
- Cloud realtime menyinkronkan Observations, Master Process, PIC, Rating Factor, dan Study Settings.
- Akun baru tidak langsung mendapat akses data: harus approved oleh admin.
