# Panduan Login — TMS PDC WAREHOUSE

Aplikasi sekarang punya halaman login (gradasi + foto gedung UT di bagian
atas) sebelum masuk ke dashboard. Semua pengaturan login ada di **satu
file**: `auth-config.js`. Anda tidak perlu paham coding untuk mengubahnya —
cukup buka file itu dengan Notepad/Text Editor apa pun.

---

## MODE 1 — Passcode Lokal (AKTIF SEKARANG, tidak perlu setup apa pun)

Ini mode default. Semua orang yang tahu satu "kata sandi bersama" bisa
masuk. Kolom "Email / Nama Pengguna" boleh diisi bebas (hanya catatan siapa
yang login), yang benar-benar dicek cuma Password/Passcode-nya.

**Cara ganti passcode:**
1. Buka `auth-config.js`.
2. Cari baris: `const LOCAL_ACCESS_CODE = 'utpdc2026';`
3. Ganti tulisan di antara tanda kutip dengan passcode baru, misalnya:
   `const LOCAL_ACCESS_CODE = 'PDC-Warehouse-2026';`
4. Simpan file, lalu upload ulang / redeploy.

**Catatan jujur soal keamanan:** mode ini cuma "gerbang sopan-santun" —
cukup untuk mencegah orang iseng, TAPI passcode-nya bisa dilihat orang yang
paham cara buka DevTools browser. Kalau data Anda sensitif atau perlu tahu
persis siapa yang login (per-orang, bukan kata sandi bersama), pakai
**MODE 2 (Supabase)** di bawah.

---

## MODE 2 — Supabase (akun & password sungguhan, per orang, di cloud)

Supabase itu tempat menyimpan daftar akun (email + password) secara aman,
gratis untuk skala kecil-menengah. Aplikasi ini **otomatis** pindah ke mode
ini begitu Anda mengisi 2 baris konfigurasi — tidak perlu ubah kode lain.

### Langkah 1 — Buat project Supabase
1. Buka https://supabase.com → **Start your project** → daftar/login.
2. Klik **New Project**, isi nama project, buat password database (simpan
   baik-baik), pilih region terdekat (Singapore paling dekat ke Indonesia).
3. Tunggu 1–2 menit sampai project selesai dibuat.

### Langkah 2 — Aktifkan login Email/Password
1. Di sidebar project, buka **Authentication → Providers**.
2. Pastikan **Email** berstatus aktif (biasanya sudah aktif secara default).
3. Non-aktifkan "Confirm email" dulu (Authentication → Settings) kalau Anda
   ingin bisa langsung login tanpa proses verifikasi email — cocok untuk
   pemakaian internal kantor.

### Langkah 3 — Buat akun untuk tiap pengguna
1. Buka **Authentication → Users → Add user**.
2. Isi email dan password untuk tiap orang yang boleh login (misalnya
   `andi@pdc.local` / password bebas). Ulangi untuk setiap PIC/analis.
3. Tidak ada halaman "daftar sendiri" di aplikasi ini — sengaja, supaya
   hanya admin yang bisa menambah pengguna baru lewat dashboard Supabase.

### Langkah 4 — Ambil Project URL & anon key
1. Buka **Project Settings → API**.
2. Salin **Project URL** (bentuknya `https://xxxxx.supabase.co`).
3. Salin **anon public key** (kunci panjang, aman ditaruh di frontend,
   BUKAN yang "service_role" — jangan pernah pakai service_role di sini).

### Langkah 5 — Tempel ke aplikasi
1. Buka `auth-config.js`.
2. Isi:
   ```js
   const SUPABASE_URL = 'https://xxxxx.supabase.co';
   const SUPABASE_ANON_KEY = 'isi-anon-key-di-sini';
   ```
3. Simpan, lalu redeploy. Halaman login sekarang otomatis memakai akun
   Supabase — passcode lokal tidak lagi dipakai selama 2 baris ini terisi.

### (Opsional) Langkah 6 — Jalankan schema data
Kalau Anda juga ingin data (Master, Observasi, dst) tersimpan di Supabase
—bukan cuma login-nya— ikuti `BACKEND-SETUP.md` untuk menjalankan
`supabase/schema.sql`. Ini terpisah dari fitur login dan **belum**
otomatis tersambung ke tabel observasi di ZIP ini; kabari saya kalau mau
saya sambungkan sekalian.

---

## Soal SharePoint / Login Akun Microsoft Kantor

SharePoint sendiri **bukan** penyedia login (bukan seperti Supabase) — dia
cuma tempat penyimpanan dokumen/situs. Kalau maksud Anda adalah "biar
karyawan bisa login pakai akun Microsoft/Office 365 kantor (yang sama
dengan buka email atau SharePoint)", itu namanya **Single Sign-On (SSO)**
lewat **Microsoft Entra ID** (dulu disebut Azure AD) — beda layanan dari
SharePoint itu sendiri.

Ini **butuh akses admin IT/Azure di kantor Anda**, karena harus didaftarkan
sebagai aplikasi resmi di tenant Microsoft perusahaan. Saya tidak bisa
menyiapkannya membabi buta karena butuh detail yang hanya admin IT punya:

- **Tenant ID** (ID perusahaan di Microsoft 365)
- **Client ID / Application ID** (didapat setelah IT mendaftarkan aplikasi
  ini di portal Azure → *App registrations*)
- **Redirect URI** yang disetujui (alamat web aplikasi Anda setelah
  deploy, misalnya `https://tms-pdc.vercel.app`)

**Kalau Anda bisa minta 3 hal di atas dari tim IT**, kabari saya — saya
bisa pasangkan login Microsoft (pakai library resmi MSAL.js) ke halaman
login yang sudah ada ini, jadi Anda tinggal pilih salah satu: passcode
lokal, Supabase, atau "Masuk dengan akun Microsoft".

---

## Ringkasan

| Mode | Setup | Cocok untuk |
|---|---|---|
| Passcode Lokal | Sudah aktif, tinggal pakai | Tim kecil, akses cepat, tidak perlu tahu siapa login |
| Supabase | ~15 menit, ikuti langkah di atas | Perlu akun per-orang, password masing-masing, gratis |
| Microsoft/Azure AD SSO | Butuh tim IT kantor | Perusahaan besar, mau pakai akun email kantor langsung |
