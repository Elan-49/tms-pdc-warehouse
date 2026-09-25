/* ==========================================================================
   KONFIGURASI LOGIN — TMWA PDC WAREHOUSE
   File ini boleh diedit sendiri tanpa perlu paham coding.
   Lihat AUTH-SETUP.md untuk panduan lengkap langkah demi langkah.
   ========================================================================== */

/* ------------------------------------------------------------------------
   MODE 1 — PASSCODE LOKAL
   true  = aktif → aplikasi mengizinkan login menggunakan passcode lokal.
   false = nonaktif → aplikasi hanya menggunakan autentikasi Supabase.
   Untuk production, gunakan false agar aplikasi tidak memiliki fallback
   ke satu passcode bersama.
   ------------------------------------------------------------------------ */
const LOCAL_ACCESS_CODE = 'tmwa-demo';

// Set true untuk mengaktifkan mode passcode lokal.
// Set false untuk menonaktifkan mode passcode lokal.
const ALLOW_LOCAL_MODE = false;

/* ------------------------------------------------------------------------
   MODE 2 — SUPABASE (akun & password sungguhan per orang, tersimpan di cloud)
   Isi kedua nilai ini SETELAH mengikuti panduan
   di AUTH-SETUP.md kalau sudah siap memakai akun Supabase sungguhan:
   ------------------------------------------------------------------------ */
const SUPABASE_URL = 'https://cakfxhtnakqicphvaiss.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tE7rJ0xcnW4hc1DNtVvU9g_E-byR1yv';