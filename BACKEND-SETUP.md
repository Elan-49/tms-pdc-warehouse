# Setup Backend Supabase

## 1. Buat project Supabase
Buat project baru di Supabase dan simpan Project URL serta anon key.

## 2. Jalankan schema
Buka **SQL Editor** > **New query**, lalu copy seluruh isi `supabase/schema.sql` dan jalankan.

## 3. Verifikasi tabel
Pastikan muncul tabel:
- operators
- master_elements
- observations
- rating_factors
- study_settings

## 4. Keamanan
Untuk tahap awal gunakan project development dan atur Row Level Security (RLS) sebelum dipakai oleh banyak pengguna.

## Catatan
Frontend pada ZIP ini tetap local-first dan tidak akan gagal dibuka jika Supabase belum dikonfigurasi. Schema backend sudah tersedia untuk migrasi ke cloud/database.
