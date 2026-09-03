/* ==========================================================================
   KONFIGURASI LOGIN — TMS PDC WAREHOUSE
   File ini boleh diedit sendiri tanpa perlu paham coding.
   Lihat AUTH-SETUP.md untuk panduan lengkap langkah demi langkah.
   ========================================================================== */

/* ------------------------------------------------------------------------
   MODE 1 — PASSCODE LOKAL (default, langsung bisa dipakai tanpa setup apa pun)
   Semua orang yang tahu passcode ini bisa masuk. Kolom "Email / Nama
   Pengguna" boleh diisi bebas (hanya untuk catatan siapa yang login),
   yang divalidasi hanya Password / Passcode-nya.
   Ganti nilai di bawah ini sesuai keinginan Anda:
   ------------------------------------------------------------------------ */
const LOCAL_ACCESS_CODE = 'utpdc2026';

/* ------------------------------------------------------------------------
   MODE 2 — SUPABASE (akun & password sungguhan per orang, tersimpan di cloud)
   Kosongkan (biarkan '') jika belum ingin memakai ini — aplikasi otomatis
   memakai MODE 1 di atas. Isi kedua nilai ini SETELAH mengikuti panduan
   di AUTH-SETUP.md kalau sudah siap memakai akun Supabase sungguhan:
   ------------------------------------------------------------------------ */
const SUPABASE_URL = 'https://cakfxhtnakqicphvaiss.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tE7rJ0xcnW4hc1DNtVvU9g_E-byR1yv';
