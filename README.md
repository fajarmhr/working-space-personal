# Ruang

Workspace personal yang berjalan di komputer sendiri. Django menyimpan data lokal; React menyediakan antarmuka dan tools interaktif. Tidak membutuhkan akun, hosting, atau koneksi internet saat pemakaian normal.

## Menjalankan

Klik dua kali **`start.cmd`**, atau dari PowerShell:

```powershell
.\start.cmd
```

Workspace tersedia di **http://127.0.0.1:8000**. Tutup server dengan `Ctrl+C`. Runtime dan dependensi di komputer ini sudah disiapkan.

Jika proyek baru disalin atau dependensi perlu dipasang ulang:

```powershell
.\setup.cmd
```

Setup membutuhkan internet dan [uv](https://docs.astral.sh/uv/getting-started/installation/). Script mengambil Node 26 LTS dari situs resmi, memeriksa SHA-256 arsip, menyiapkan Python 3.14 serta pnpm lokal, memasang dependensi dari lockfile, menjalankan migrasi, dan membangun frontend. Instalasi Node/Python sistem tidak diubah. `setup.cmd -SkipBuild` melewati build frontend.

## Tools yang tersedia

- **JSON Formatter:** validasi, format, minify, salin hasil.
- **Ubah Teks:** kapitalisasi serta hitungan teks.
- **Base64:** encode/decode teks UTF-8.
- **Password Generator:** pengacakan kriptografis di browser.
- **Timer Fokus:** mulai, jeda, reset, dan pengaturan durasi.
- **Catatan Cepat:** autosave ke database lokal dengan status penyimpanan.
- **Tugas Harian:** prioritas, tenggat, detail, filter hari ini/terlambat/selesai, dan buka kembali tugas.
- **Pustaka Snippet:** simpan, cari, edit, dan salin template atau teks yang sering dipakai.
- **CSV & JSON:** impor berkas atau tempel teks, konversi dua arah, dan proteksi formula spreadsheet.
- **Bandingkan Teks:** dua editor, drag-and-drop berkas, simpan/tutup per sisi, sesi lokal, filter sama/berbeda/berpindah, dan panah salin tepat pada baris. [Panduan](docs/TEXT_COMPARE.md).
- **Tanggal & Waktu:** timestamp, ISO dengan offset, zona waktu, dan selisih tanggal.
- **URL Toolkit:** encode/decode komponen dan pemeriksaan parameter URL.
- **UUID Generator:** UUID v4 acak, tunggal atau sekaligus.
- **Checksum Berkas:** SHA-256 dan pencocokan checksum yang diharapkan.
- **Olah Gambar:** resize, ekspor JPG/PNG/WebP, anotasi kotak/bulat/panah/nomor/tulisan, rotasi/skew bentuk, dan blur area.
- **PDF ke Word:** konversi lokal ke DOCX editable, termasuk OCR scan Bahasa Indonesia/Inggris. Hasil perlu diperiksa; ejaan OCR dan layout tidak dijamin identik.
- **PDF ke Gambar:** render halaman 150/300/600 DPI ke PNG, JPEG, WebP, atau TIFF; tambah PDF/gambar/halaman kosong, susun ulang/hapus dengan undo/redo, lalu edit anotasi, blur, resize, dan rotasi hasil. Unduh halaman terpilih atau seluruh susunan sebagai ZIP.
- **Capture Studio:** screenshot ke satu DOCX dengan hotkey, dalam sesi Windows yang dimulai manual.

Workspace menyediakan 18 tools personal, pencarian global, favorit, riwayat aktivitas, tema terang/gelap/sistem, dan nama tampilan. Huawei workspace menambahkan alat khusus secara opsional. Tugas harian dapat dibuka langsung dari sidebar. Detail batas dan cara kerja ada di [docs/TOOLS.md](docs/TOOLS.md).

**Pencarian global:** tekan `Ctrl+K` untuk mencari alat serta isi catatan, judul/detail tugas (termasuk yang selesai), dan judul/isi/kategori snippet yang tersimpan. Minimal dua karakter untuk pencarian isi. Hasil konten dapat dibuka langsung ke catatan atau item tugas/snippet yang sesuai. Pencarian tidak mencakup isi berkas hasil konversi.

## Huawei workspace (opsional)

Aktifkan **Huawei personal** di Pengaturan, simpan, lalu pilih workspace Huawei di sidebar. Workspace ini mengelompokkan alat kerja UPF dan menyediakan **LLD Script Builder**. Catatan, tugas, snippet, serta favorit tetap menggunakan profil lokal yang sama.

Unggah LLD `.xlsx` dengan struktur sheet `5G Core Service IP Design` dan `Routing`, pilih node, isi nama interface serta parameter yang diperlukan, kemudian tinjau hasilnya. Builder menghasilkan dua script berurutan: **Static Routing + BFD**, lalu **BGP over Static Routing + BFD**. Masing-masing memiliki preparation, execution, verification, dan rollback. Pilih `.txt` atau `.ini`; keduanya berisi teks MML sesuai template, bukan format konfigurasi INI key-value. Unduh masing-masing atau paket ZIP dengan manifest checksum.

Generator ditujukan untuk konfigurasi **initial** UPF. Periksa kondisi awal dan jalankan satu bagian per tahap. Rollback dilakukan dari script BGP, lalu Static/BFD. Status global/port yang belum diketahui dan perintah cleanup BGP yang belum tercakup template ditampilkan sebagai langkah yang perlu dilengkapi. Baca [batas template](docs/HUAWEI_TEMPLATE.md).

LLD dan parameter diproses oleh backend lokal tanpa disimpan sebagai riwayat atau output permanen aplikasi. Password BGP ada di hasil script yang diunduh; simpan berkas tersebut sesuai kebutuhan kerjamu.

**KPI Reporting Studio** menyediakan kerangka reporting U2020: simpan draft sumber data, pemetaan KPI, rencana interval, serta profil tujuan email/Telegram. Draft selalu nonaktif. Login, navigasi U2020, ekspor, pembuatan grafik, scheduler, serta pengiriman nyata belum terhubung. Token/password tidak diterima dalam draft; gunakan nama referensi secret. Detail desain, batas pengujian, serta informasi yang perlu dilengkapi ada di [docs/HUAWEI_REPORTING.md](docs/HUAWEI_REPORTING.md).

Untuk screenshot, buka Capture Studio lalu mulai sesi. Default **Ctrl+Shift+S**, alternatif **Ctrl+Alt+S**; setiap tangkapan layar utama ditambahkan ke DOCX dan disimpan otomatis. Sesi tetap berjalan saat berpindah tool atau menutup tab sampai dihentikan, atau backend berhenti.

PDF ke Word menggunakan OCR otomatis untuk scan, dengan pilihan bahasa serta opsi membaca ulang seluruh halaman. Engine Tesseract bawaan PyMuPDF memakai model `tessdata_best` Indonesia/Inggris secara offline. Setup mengunduh model dari commit resmi yang dikunci dan memeriksa SHA-256. Untuk memasang ulang model saja, jalankan `powershell -ExecutionPolicy Bypass -File scripts/setup-ocr.ps1`. OCR mendekati font dan posisi sumber; periksa kembali angka, ejaan, tabel kompleks, dan scan yang buram.

PDF ke Gambar merender ulang PDF pada DPI yang dipilih ketika diimpor. Dimensi piksel dipertahankan saat membuka editor; PNG lossless menjadi format awal. Tambahkan PDF lain, gambar PNG/JPG/WebP, atau halaman kosong; susun ulang dan edit sebelum ekspor. Batas satu halaman 40 MP/sisi 8.192 px, total 100 halaman/1 gigapiksel. DPI tinggi tidak mengembalikan detail yang tidak ada pada scan sumber. Susunan dan undo/redo belum disimpan otomatis; unduh hasil sebelum berpindah alat atau menutup tab. Panduan lengkap: [docs/PDF_IMAGES.md](docs/PDF_IMAGES.md).

## Development dan pemeriksaan

```powershell
.\dev.cmd
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check.ps1
```

Development memakai Vite di `127.0.0.1:5173` dan Django di `127.0.0.1:8000`. Saat dipakai sehari-hari, Waitress menyajikan hasil build dan API pada satu alamat; Node dan Vite tidak perlu terus berjalan.

## Penyimpanan dan backup

Data disimpan di folder **`data/`**, terpisah dari source dan diabaikan Git:

| Lokasi                   | Isi                                                   |
| ------------------------ | ----------------------------------------------------- |
| `data/workspace.sqlite3` | Catatan, tugas, snippet, preferensi, favorit, riwayat |
| `data/.secret-key`       | Secret Django yang dibuat saat pertama berjalan       |
| `data/queue.sqlite3`     | Antrean worker, bila worker digunakan                 |
| `data/outputs/pdf/<uuid>/` | PDF sumber, DOCX hasil, status, dan log konversi     |
| `data/outputs/pdf-images/<uuid>/` | PDF sumber, halaman PNG/thumbnail, gambar tambahan/edit, ekspor gambar/ZIP, dan status |
| `data/outputs/captures/<uuid>/` | PNG tangkapan, DOCX sesi, dan status           |
| `data/backups/`          | Backup ZIP                                            |

Data dan backup belum dienkripsi; perlindungannya mengikuti akses akun dan disk Windows. Perbandingan teks, CSV/JSON, checksum, dan gambar memproses berkas di browser. PDF diunggah ke backend lokal; hasil konversi dan screenshot disimpan di folder `data/outputs/`. Hasil Password Generator tidak dikirim ke backend atau dicatat sebagai riwayat.

Buat snapshot database yang konsisten, termasuk ketika SQLite memakai WAL:

```powershell
.\backend\.venv\Scripts\python.exe .\backend\manage.py backup_workspace
```

Hentikan konversi/sesi native sebelum backup agar berkas hasil tidak berubah selama disalin. ZIP mencakup database, secret, serta isi `data/files/` dan `data/outputs/` jika ada; unduhan yang disimpan browser di luar folder tersebut tidak tercakup.

Untuk memulihkan, hentikan Ruang, simpan salinan folder `data/` saat ini, lalu ekstrak isi ZIP ke `data/`. Setelah server benar-benar berhenti, hapus file pendamping lama `workspace.sqlite3-wal` dan `workspace.sqlite3-shm` jika masih ada sebelum menyalakan kembali aplikasi. Jangan menimpa database ketika server masih berjalan. Backup tidak berisi dependensi atau antrean pekerjaan yang sedang berlangsung; sesi native tidak dimulai otomatis setelah pemulihan.

## Struktur

```text
backend/
  config/             konfigurasi Django dan routing
  workspace/          registry tools, model, API, service, test
  uv.lock             versi dan hash dependensi Python
frontend/
  src/components/     workspace shell, panels, UI primitives
  src/lib/            API client, types, logika tools
  pnpm-lock.yaml      versi dan integrity dependensi frontend
scripts/              setup, development, start, pemeriksaan
data/                 data pengguna (tidak dilacak Git)
.runtime/             Node, Python, pnpm lokal (tidak dilacak Git)
```

Detail keputusan ada di [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), dan catatan versi serta keamanan di [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md).
