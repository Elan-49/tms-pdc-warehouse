# Panduan Deploy TMS PDC Warehouse V2.8.5

## A. Test lokal
1. Extract ZIP.
2. Masuk ke folder hasil extract.
3. Double-click `index.html`.
4. Pastikan Dashboard, pie chart, Pareto, dan tabel berjalan.

## B. GitHub
1. Login GitHub.
2. Buat repository baru, misalnya `tms-pdc-warehouse`.
3. Pilih **Add file > Upload files**.
4. Upload **isi folder hasil extract**, bukan folder ZIP-nya saja.
5. Pastikan `index.html`, `app.js`, `styles.css`, `master-data.js`, dan folder `supabase` berada di repository.
6. Klik **Commit changes**.

## C. Vercel
1. Login Vercel.
2. Klik **Add New > Project**.
3. Pilih repository GitHub tadi.
4. Framework Preset: **Other**.
5. Build Command: kosong.
6. Output Directory: kosong.
7. Klik **Deploy**.
8. Setelah status **Ready**, klik **Visit**.

## D. Cloudflare Pages
1. Login Cloudflare.
2. Workers & Pages > Create > Pages > Connect to Git.
3. Pilih repository GitHub.
4. Framework preset: **None**.
5. Jangan isi build command.
6. Deploy sebagai static site dari repository root.

## E. Backend Supabase (opsional untuk tahap cloud)
1. Buat project Supabase.
2. Buka SQL Editor.
3. Jalankan `supabase/schema.sql`.
4. Simpan Project URL dan anon key.
5. Tahap berikutnya adalah menghubungkan data service frontend ke Supabase agar data tersinkron antar perangkat.
