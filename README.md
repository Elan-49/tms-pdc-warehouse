# TMWA PDC Warehouse

**Time and Motion Study & Waste Analysis** untuk pengelolaan data observasi aktivitas kerja di Parts Warehouse.

Aplikasi ini digunakan untuk mencatat waktu kerja, mengolah waktu normal dan waktu baku, melakukan analisis keseragaman serta kecukupan data, menerapkan Rating Factor Westinghouse dan allowance, serta mengidentifikasi waste berdasarkan pendekatan Lean.

## Fitur Utama

- **Dashboard** — ringkasan KPI, waktu normal, waktu baku, waste, dan informasi observasi.
- **Data Waktu / Observasi** — pencatatan dan pengelolaan data observasi berbasis elemen kerja.
- **Edit Observasi Lengkap** — Process, Activity, Element Kerja, PIC, tanggal, kategori, metode observasi, waktu, klasifikasi, waste, metode kerja, peralatan, dan catatan dapat diperbarui dalam satu popup.
- **Dropdown Master Data** — Process, Activity, dan Element Kerja menggunakan data master secara bertingkat.
- **PIC / Operator** — pilihan PIC berasal dari daftar operator pada Rating Factor.
- **Uji Keseragaman** — pengujian keseragaman data waktu observasi.
- **Uji Kecukupan** — perhitungan kebutuhan jumlah observasi.
- **Rating Factor** — pengelolaan faktor Skill, Effort, Condition, Consistency, rating factor, kebutuhan observasi awal, dan allowance.
- **Standard Time** — perhitungan waktu normal dan waktu baku berdasarkan allowance.
- **Analisis LEAN** — klasifikasi aktivitas dan identifikasi 8 jenis waste.
- **Master Data** — pengelolaan struktur Process, Activity, Element Kerja, serta atribut pendukung.
- **TSKK** — pengelolaan dan pencetakan tabel standar kerja terkait data yang tersedia pada aplikasi.
- **Print & Export** — pencetakan dan ekspor data sesuai modul yang tersedia.
- **Authentication & Role** — pengaturan akses berdasarkan akun dan role.
- **Supabase Cloud Sync** — sinkronisasi data ke cloud ketika konfigurasi dan koneksi tersedia.
- **Local Storage** — data aplikasi tetap dapat digunakan secara lokal ketika cloud tidak tersedia.

## Struktur Data Observasi

Data observasi menggunakan satu record untuk setiap pengamatan. Informasi yang dapat dikelola meliputi:

- Tanggal
- PIC / Operator
- Process
- Activity
- Element Kerja
- Kategori ukuran: Small / Medium / Big
- Metode observasi
- Waktu observasi
- Klasifikasi aktivitas
- Jenis waste
- Metode kerja
- Peralatan
- Catatan

Saat observasi diedit, record yang sama diperbarui berdasarkan **ID observasi** sehingga tidak membuat data observasi baru.

## Alur Pengolahan

```text
Master Data
    ↓
Data Observasi
    ↓
Uji Keseragaman & Uji Kecukupan
    ↓
Rating Factor + Allowance
    ↓
Waktu Normal
    ↓
Waktu Baku / Standard Time
    ↓
Dashboard & Analisis LEAN
```

## Analisis LEAN

Aplikasi menggunakan klasifikasi waste berikut:

1. Defects
2. Overproduction
3. Waiting
4. Non-Utilized Talent
5. Transportation
6. Inventory
7. Motion
8. Extra Processing

## Penyimpanan & Sinkronisasi

Aplikasi menggunakan penyimpanan lokal dan dapat terhubung ke Supabase.

- Perubahan disimpan pada perangkat terlebih dahulu.
- Jika koneksi dan konfigurasi Supabase tersedia, data disinkronkan ke cloud.
- Jika cloud tidak tersedia, data lokal tetap tersimpan.
- Sinkronisasi dapat dilanjutkan ketika koneksi cloud tersedia kembali.
- Pembaruan observasi menggunakan ID record yang sama sehingga data cloud diperbarui, bukan diduplikasi.

## Role & Akses

Akses menu mengikuti role akun yang digunakan. Fitur administrasi dan **User Management** dibatasi untuk role yang memiliki hak administrasi.

## Struktur File

```text
TMWA-PDC-WAREHOUSE/
├── index.html
├── app.js
├── styles.css
├── master-data.js
├── auth.js
├── auth-config.js
├── auth-middleware.js
├── cloud-sync.js
├── vercel.json
├── supabase/
│   └── schema.sql
├── ut-logo.png
├── ut-logo-2.png
├── ut-logo-bulat.png
├── ut-motto.png
└── login-building-bg.webp
```

## Menjalankan Secara Lokal

Karena aplikasi menggunakan JavaScript dan modul browser, jalankan melalui local web server, bukan dengan membuka `index.html` menggunakan `file://`.

Contoh dengan VS Code:

1. Buka folder aplikasi.
2. Jalankan menggunakan **Live Server** atau web server lokal lainnya.
3. Buka alamat localhost yang diberikan server.

## Konfigurasi Supabase

Konfigurasi koneksi berada pada:

```text
auth-config.js
cloud-sync.js
supabase/schema.sql
```

Gunakan schema yang tersedia pada folder `supabase` untuk menyiapkan struktur database. Pastikan URL project, anon key, tabel, policy, dan konfigurasi autentikasi sesuai dengan project Supabase yang digunakan.

## Deployment

Aplikasi dapat dideploy sebagai static web application pada layanan seperti Vercel atau platform hosting lain yang mendukung HTML, CSS, dan JavaScript.

Pastikan konfigurasi Supabase dan authentication sudah tersedia pada environment/project tujuan sebelum digunakan bersama.

## Catatan Penggunaan

- Gunakan **Master Data** sebagai sumber struktur Process → Activity → Element Kerja.
- Gunakan **Rating Factor** sebagai sumber daftar PIC/Operator dan parameter penilaian.
- Lakukan pemeriksaan keseragaman dan kecukupan sebelum menetapkan waktu baku.
- Pastikan allowance dan rating factor sudah sesuai dengan metode pengukuran yang digunakan.
- Lakukan sinkronisasi cloud secara berkala jika aplikasi digunakan pada lebih dari satu perangkat.

## Migrasi Data Lokal

Versi TMWA melakukan migrasi otomatis terhadap data lokal dari versi aplikasi sebelumnya saat pertama kali dibuka pada browser yang sama. Data dipindahkan ke namespace TMWA tanpa menghapus data sumber lama. Setelah migrasi berhasil, aplikasi menggunakan penyimpanan TMWA untuk penggunaan berikutnya.

Migrasi ini hanya berlaku untuk data yang tersimpan di browser/perangkat tersebut. Data Supabase tidak perlu dipindahkan karena tetap menggunakan project, tabel, Auth, dan konfigurasi backend yang sama.


## Perbaikan loader autentikasi

Build V4.5.74 memperbaiki kondisi ketika halaman produksi berhenti pada loader orbit. Loader sekarang otomatis dihentikan jika sesi tidak ada, sesi kedaluwarsa, atau pemeriksaan profil/auth gagal sehingga halaman login dapat tampil. Jika autentikasi berhasil, loader tetap menunggu render awal aplikasi selesai.
