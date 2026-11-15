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
- **Bandingkan Teks:** dua editor Monaco yang dapat diedit, buka berkas teks/kode, deteksi perubahan langsung, dan salin blok dua arah.
- **Tanggal & Waktu:** timestamp, ISO dengan offset, zona waktu, dan selisih tanggal.
- **URL Toolkit:** encode/decode komponen dan pemeriksaan parameter URL.
- **UUID Generator:** UUID v4 acak, tunggal atau sekaligus.
- **Checksum Berkas:** SHA-256 dan pencocokan checksum yang diharapkan.
- **Olah Gambar:** resize, ekspor JPG/PNG/WebP, anotasi kotak/bulat/panah/nomor/tulisan, rotasi/skew bentuk, dan blur area.
- **PDF ke Word:** konversi lokal ke DOCX editable, termasuk OCR scan Bahasa Indonesia/Inggris. Hasil perlu diperiksa; ejaan OCR dan layout tidak dijamin identik.
- **Capture Studio:** screenshot ke satu DOCX dengan hotkey, dalam sesi Windows yang dimulai manual.

Workspace menyediakan 17 tools, pencarian alat, favorit, riwayat aktivitas, tema terang/gelap/sistem, dan nama tampilan. Tugas harian dapat dibuka langsung dari sidebar. Detail batas dan cara kerja ada di [docs/TOOLS.md](docs/TOOLS.md).

Untuk screenshot, buka Capture Studio lalu mulai sesi. Default **Ctrl+Shift+S**, alternatif **Ctrl+Alt+S**; setiap tangkapan layar utama ditambahkan ke DOCX dan disimpan otomatis. Sesi tetap berjalan saat berpindah tool atau menutup tab sampai dihentikan, atau backend berhenti.

PDF ke Word menggunakan OCR otomatis untuk scan, dengan pilihan bahasa serta opsi membaca ulang seluruh halaman. Engine Tesseract bawaan PyMuPDF memakai model `tessdata_best` Indonesia/Inggris secara offline. Setup mengunduh model dari commit resmi yang dikunci dan memeriksa SHA-256. Untuk memasang ulang model saja, jalankan `powershell -ExecutionPolicy Bypass -File scripts/setup-ocr.ps1`. OCR mendekati font dan posisi sumber; periksa kembali angka, ejaan, tabel kompleks, dan scan yang buram.

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
