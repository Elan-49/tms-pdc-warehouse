/* ==========================================================================
   KONFIGURASI LOGIN — TMS PDC WAREHOUSE
   File ini boleh diedit sendiri tanpa perlu paham coding.
   Lihat AUTH-SETUP.md untuk panduan lengkap langkah demi langkah.
   ========================================================================== */

/* ------------------------------------------------------------------------
   MODE 1 — PASSCODE LOKAL
   Sengaja dinonaktifkan untuk build produksi agar deployment tidak pernah
   fallback ke satu passcode bersama. Development lokal juga sebaiknya memakai
   akun Supabase.
   ------------------------------------------------------------------------ */
const LOCAL_ACCESS_CODE = '';

// Production safety: local passcode mode is blocked.
const ALLOW_LOCAL_MODE = false;

/* ------------------------------------------------------------------------
   MODE 2 — SUPABASE (akun & password sungguhan per orang, tersimpan di cloud)
   Kosongkan (biarkan '') jika belum ingin memakai ini — aplikasi otomatis
   memakai MODE 1 di atas. Isi kedua nilai ini SETELAH mengikuti panduan
   di AUTH-SETUP.md kalau sudah siap memakai akun Supabase sungguhan:
   ------------------------------------------------------------------------ */
const SUPABASE_URL = 'https://cakfxhtnakqicphvaiss.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tE7rJ0xcnW4hc1DNtVvU9g_E-byR1yv';