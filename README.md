# TMWA PDC Warehouse

**Time and Motion Study & Waste Analysis** untuk pengelolaan pengukuran waktu kerja dan analisis waste di Parts Warehouse.

## Struktur penelitian

Aplikasi mempertahankan struktur sederhana:

```text
Process → Activity → Element Kerja
```

- **Process** = kelompok proses besar, misalnya Inbound, Storage, atau Outbound.
- **Activity** = pekerjaan utama, misalnya Receiving, QI/QC, atau Binning.
- **Element Kerja** = rincian pekerjaan di dalam Activity.
- **Standard Time** dapat dihitung pada level Element dan Activity. Process dapat ditampilkan sebagai agregasi Standard Time Activity yang membentuk process tersebut.
- **Video hanya menjadi sumber rekaman.** Satu video boleh berisi banyak aktivitas dan tidak harus dianalisis seluruh durasinya. Pengguna memilih rentang waktu yang relevan untuk setiap observasi.

Tidak ada master data atau filter tambahan bernama **Activity Cycle**. Istilah **Cycle Time** hanya digunakan sebagai istilah pengukuran waktu dalam time study, bukan sebagai level data baru.

## Fitur utama

- **Dashboard** — KPI Normal Time, Standard Time, waste, Pareto, dan filter Process / Activity / Element / Kategori.
- **Data Waktu / Observasi** — pencatatan waktu dari video atau input manual.
- **Master Data** — Process, Activity, Element Kerja, klasifikasi, waste, metode, peralatan, dan frekuensi per kategori.
- **Rating Factor** — Westinghouse pada konteks **PIC + Activity**.
- **Validasi Data Waktu** — uji keseragaman, uji kecukupan, dan parameter penelitian.
- **Standard Time** — Normal Time dan Standard Time dengan allowance.
- **Analisis LEAN** — delapan jenis waste dan Estimated Waste Time / Day.
- **TSKK / SWCT** — analisis Standard Work Combination berdasarkan data observasi yang dipilih.
- **Print & Export** — keluaran laporan dan ekspor data.
- **Authentication & Role** — akses berdasarkan role pengguna.
- **Supabase Cloud Sync** — sinkronisasi cloud jika konfigurasi tersedia.
- **Local Storage** — data lokal tetap dapat digunakan saat cloud tidak tersedia.

## Aturan observasi

1. Satu video boleh digunakan untuk banyak observasi.
2. Video tidak harus dianalisis dari awal sampai akhir.
3. Pengguna cukup memilih rentang waktu pekerjaan yang ingin diukur.
4. Jika pekerjaan berpindah dari Receiving ke QI/QC, cukup simpan sebagai observasi berbeda. Tidak perlu membuat level data baru.
5. Element merupakan breakdown pekerjaan yang dipilih dari Activity.
6. PIC, Activity, dan kategori dapat berbeda antarobservasi dalam video yang sama.
7. Satu observasi menyimpan waktu aktual dalam detik; waktu tersebut menjadi dasar perhitungan time study.

## Rating Factor Westinghouse

Rating ditetapkan pada **PIC + Activity** karena satu Activity dapat dikerjakan oleh beberapa PIC dengan penilaian performa yang berbeda.

```text
RF = 1 + Skill + Effort + Condition + Consistency
```

Saat observasi disimpan, nilai RF yang digunakan disimpan sebagai **RF Snapshot** pada record observasi.

Snapshot berarti **salinan nilai RF pada saat observasi dilakukan**. Pengguna tidak perlu mengisi snapshot secara manual. Jika rating PIC + Activity berubah di kemudian hari, observasi lama tetap menggunakan RF yang tersimpan saat observasi tersebut dibuat.

Normal Time per observasi:

```text
NT_i = Observed Time_i × RF Snapshot_i
```

Normal Time kelompok data:

```text
NT = Σ(Observed Timeᵢ × RF Snapshotᵢ) / Nᵥ
```

## Validasi data waktu

### Uji keseragaman

```text
x̄ = ΣX / N
s = sample standard deviation
BKA = x̄ + 3s
BKB = max(0, x̄ − 3s)
```

±3 SD merupakan metode keseragaman yang dipilih dalam penelitian ini. BKB dibatasi minimum 0 karena waktu tidak dapat bernilai negatif.

### Uji kecukupan

```text
N′ = [ (Z / p) × √(NΣX² − (ΣX)²) / ΣX ]²
```

Confidence level menentukan Z secara otomatis. Precision `p`, confidence, dan N₀ merupakan parameter penelitian; rumus tidak diubah melalui UI.

Standard Time hanya ditetapkan apabila data memenuhi aturan validasi yang digunakan aplikasi: jumlah observasi awal memenuhi minimum, data seragam, dan Nᵥ memenuhi N′.


## Notasi Statistik Utama

| Notasi | Keterangan |
|---|---|
| **N (Jumlah Pengamatan)** | Seluruh data hasil pengamatan yang tersedia |
| **Nᵥ (Jumlah Data dalam Batas Kendali)** | Data yang berada di antara BKA dan BKB |
| **N′ (Jumlah Pengamatan yang Diperlukan)** | Jumlah pengamatan teoritis yang diperlukan berdasarkan uji kecukupan |
| **N₀ (Jumlah Pengamatan Awal Minimum)** | Batas minimum pengamatan awal yang ditetapkan penelitian |
| **x̄ (Rata-Rata)** | Rata-rata waktu pengamatan |
| **s (St Dev)** | Standar deviasi waktu pengamatan |
| **BKA** | Batas Kontrol Atas |
| **BKB** | Batas Kontrol Bawah |

## Standard Time

```text
ST = NT / (1 − A)
```

Aplikasi menggunakan konvensi allowance tersebut secara konsisten. Nilai allowance harus memiliki dasar acuan dan kondisi kerja penelitian.

### Kategori ukuran

Small, Medium, dan Big dihitung terpisah.

**All / Tanpa Dimensi** adalah pooled calculation pada kombinasi Process + Activity + Element yang sama. All bukan penjumlahan Small + Medium + Big dan bukan rata-rata ketiga hasil tersebut. Hasil pooled hanya digunakan apabila data gabungan memenuhi validasi.

### Process Standard Time

Process tidak dianggap sebagai hasil stopwatch langsung apabila penelitian tidak melakukan pengukuran langsung pada Process. Nilai Process dapat ditampilkan sebagai **agregasi Standard Time Activity** yang memang membentuk Process tersebut.

## LEAN / Waste

Aplikasi menggunakan:

1. Defects
2. Overproduction
3. Waiting
4. Non-Utilized Talent
5. Transportation
6. Inventory
7. Motion
8. Extra Processing

Estimated Waste Time / Day dihitung berdasarkan:

```text
Standard Time kategori × Frequency kategori / hari
```

Istilah **Estimated** digunakan agar hasil tidak disalahartikan sebagai pengukuran langsung durasi pure waste.

## TSKK / SWCT

TSKK menggunakan data observasi yang dipilih dan mempertahankan hubungan dengan Process, Activity, PIC, Element, dan kategori yang sudah ada. TSKK tidak membuat level master baru.

Cycle Time pada TSKK adalah istilah pengukuran, bukan entitas atau filter baru pada aplikasi.

## Penyimpanan dan sinkronisasi

- Data lokal disimpan terlebih dahulu.
- Jika Supabase tersedia dan pengguna memiliki hak tulis, data disinkronkan ke cloud.
- Edit menggunakan ID record yang sama sehingga memperbarui record, bukan membuat duplikasi.
- Schema canonical berada pada `supabase/schema.sql`.

## Struktur file production

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
├── README.md
├── supabase/
│   └── schema.sql
└── assets/
    ├── ut-logo-2.png
    ├── ut-logo-bulat.png
    ├── ut-logo.png
    ├── ut-motto.png
    └── login-building-bg.webp
```

## Local dan production

Untuk pengujian lokal gunakan localhost / Live Server. Untuk production, gunakan Supabase Auth dan project Supabase yang sama dengan konfigurasi aplikasi.

Jangan menjalankan SQL reset dummy setelah data penelitian aktual mulai digunakan.
