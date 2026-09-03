# TMS PDC Warehouse V2.9.7 Fullstack

Versi ini sudah berisi frontend statis dan backend/database schema Supabase.

## Update V2.9.7
- Ditambahkan **halaman Login** sebelum masuk ke dashboard: background gradasi biru navy (warna UT) dengan foto gedung United Tractors di bagian atas.
- Login mendukung 2 mode yang otomatis dipilih tergantung konfigurasi: **Passcode Lokal** (aktif secara default, tanpa setup) atau **Supabase** (akun & password sungguhan per orang). Panduan lengkap ada di `AUTH-SETUP.md`.
- Tombol **Keluar** ditambahkan di footer aplikasi untuk logout.
- Perbaikan mobile: input tanggal & form lain tidak lagi memicu auto-zoom Safari di iPhone (font kontrol dinaikkan ke 16px khusus di layar HP).
- Tombol Fullscreen video sekarang mem-fullscreen-kan video itu sendiri (bukan bingkainya), sehingga video portrait langsung tampil benar tanpa perlu klik dua kali.

## Update V2.8.8

- Revisi vertical spacing Dashboard: jarak filter → KPI → Time Classification/Pareto dibuat konsisten dan seimbang atas-bawah.
- KPI tidak lagi menempel pada card filter di atas atau terlihat memiliki ruang bawah yang berlebihan.
- Video observasi dapat dibuka dalam mode **fullscreen**.
- Ditambahkan **seek/timeline bar** yang dapat ditarik dengan mouse/kursor untuk maju atau mundur ke detik mana pun.
- Kontrol Mundur/Maju 5 Detik dan keyboard tetap tersedia.
- Setelah **Set End** dan **Simpan Observasi**, video **tetap aktif** dan tidak perlu di-upload ulang. Satu video dapat digunakan untuk menyimpan banyak segmen observasi.
- Ditambahkan tombol **×** di area video untuk menutup/menghapus video dari sesi observasi setelah selesai digunakan. Data observasi yang sudah tersimpan tetap aman.

## Update V2.8.4
- Tampilan video sekarang membaca rasio asli file setelah metadata dimuat. Video portrait, landscape, dan square ditampilkan tanpa crop/zoom paksa.
- Penjelasan bantuan di bawah kontrol video dan input manual dihapus agar halaman lebih ringkas.
- Deskripsi panjang di Master Process & Lean dihapus.
- Form Tambah PIC diberi ruang dan posisi yang lebih nyaman dari tabel rating di bawahnya.

## Update V2.8.3
- **Set End** sekarang otomatis menjeda/pause video.
- **Set Start** menyimpan titik awal lalu otomatis menjalankan/play video kembali.
- Tampilan waktu video dan input manual menggunakan **2 angka di belakang koma**, bukan 3 digit.
- Frontend dirapikan: ukuran font, tinggi kontrol, tombol, tabel, kartu, dan alignment dibuat lebih konsisten serta responsif.

## Update V2.8.2
- Sidebar/taskbar kiri default tersembunyi.
- Klik tombol garis tiga di header kiri atas untuk membuka navigasi.
- Saat memilih Dashboard, Observation, atau halaman lain, sidebar otomatis tersembunyi kembali.
- Klik area gelap di luar sidebar atau tekan `Esc` untuk menutup menu.

## Backend/database
Folder `supabase/schema.sql` berisi schema database untuk deployment backend. Lihat `BACKEND-SETUP.md` dan `DEPLOY.md`.

## Jalankan lokal
Buka `index.html` untuk mode frontend lokal. Data prototype tetap menggunakan localStorage sampai integrasi Supabase diaktifkan.


## V3.0 Cloud Realtime
Tambahan `cloud-sync.js` menghubungkan aplikasi ke Supabase jika URL dan anon key diisi. Jika kosong, aplikasi tetap berjalan local-first. Lihat `SUPABASE-SETUP.md`.


## V3.0.5 Fix
- Cloud backend tidak lagi dijalankan sebelum login Supabase selesai.
- Menghapus pengecekan sesi yang menyebabkan error `Sesi Supabase belum siap`.
- Perbaikan blank pada dropdown Westinghouse untuk PIC pertama/baris paling atas: nilai 0 sekarang dinormalisasi ke format 0.00 agar otomatis memilih D (0.00).
- Menghapus seluruh simbol ikon teks pada taskbar/sidebar: Dashboard, Observation, Data Waktu, Master Process & Lean, Data Quality, Uji Keseragaman, Uji Kecukupan, Rating Factor, dan Standard Time.
- Perbaikan Rating PIC dan penghapusan Reset Data Lokal dari V3.0.2 tetap dipertahankan.

## V3.0.6 Fix
- Realtime Supabase tidak lagi me-render ulang halaman Observation saat menyimpan observasi, sehingga video lokal tetap terbuka dan dapat dipakai untuk banyak segmentasi.
