# Versi dan keamanan dependensi

Snapshot versi manifest dan runtime lokal: **15 November 2026, Asia/Makassar**. Versi dikunci di manifest/lockfile; tanggal audit dibedakan dari tanggal pemasangan.

| Komponen          | Versi yang dipasang |
| ----------------- | ------------------- |
| Python            | 3.14.7              |
| Django            | 5.2.19 LTS          |
| Django Ninja      | 1.8.0               |
| Waitress          | 3.0.2               |
| WhiteNoise        | 6.12.0              |
| Huey              | 3.5.4               |
| Node.js           | 26.13.1 LTS         |
| pnpm              | 12.18.0             |
| React / React DOM | 19.3.1              |
| Vite              | 8.3.8               |
| TypeScript        | 7.0.2               |
| Tailwind CSS      | 4.3.5               |
| Framer Motion     | 14.14.0             |
| Monaco Editor     | 0.57.0              |
| DOMPurify override | 3.4.18             |
| pdf2docx          | 0.5.13              |
| PyMuPDF           | 2.1                 |
| python-docx       | 1.2.0               |
| Pillow            | 13.0.0              |

Django menggunakan seri 5.2 LTS dengan patch yang dipin di atas. Dependensi frontend diambil dari dist-tag `latest` stabil pada registry resmi saat pembangunan, lalu dipin ke versi persis. `backend/uv.lock` dan `frontend/pnpm-lock.yaml` mengunci dependensi transitif beserta hash/integrity. Pin tersebut menunjukkan versi yang dipasang, bukan jaminan bahwa tidak ada rilis atau advisori baru setelah snapshot.

pdf2docx membawa dependensi pemrosesan native seperti NumPy 2.5.4, OpenCV headless 5.0.0.93, serta lxml 6.1.3 dalam lockfile saat ini. PyMuPDF digunakan untuk inspeksi PDF, python-docx untuk hasil Word, dan Pillow untuk screenshot/laporan. Monaco beserta worker dibundel sebagai aset lokal; pemakaian normal tidak mengambil editor/font dari CDN. Integrasi hotkey screenshot memakai `ctypes`/Win32 dari standard library.

Pada 15 November 2026, audit penambahan Monaco menemukan advisori pada dependensi transitif DOMPurify 3.4.15. `frontend/pnpm-workspace.yaml` mengunci override tepat ke **3.4.18**, rilis patch keamanan yang tersedia di registry pada 14 November 2026; lockfile ikut diperbarui. Override ini mencegah pin transitif Monaco memasang versi yang terdampak.

## Hasil audit

- Audit 15 November 2026: pnpm memeriksa **138 dependensi frontend** dan melaporkan **0 advisori**, setelah override DOMPurify 3.4.18.
- Audit 15 November 2026: pip-audit memeriksa **33 paket backend** dan melaporkan **0 kerentanan yang diketahui**.
- Runtime Node portable menggantikan penggunaan Node 25 sistem yang sudah tidak didukung.

Audit adalah snapshot database advisori pada waktu pemeriksaan, bukan jaminan bebas celah. Perubahan dependensi memerlukan audit ulang.

## Kebutuhan runtime tool baru

Setup memasang wheel Python yang dikunci; tidak perlu Microsoft Word/LibreOffice untuk membuat DOCX. OCR memakai Tesseract yang sudah dibundel PyMuPDF dan model resmi `tessdata_best` berlisensi Apache-2.0 untuk `eng`/`ind`. Model disimpan di `.runtime/ocr/tessdata/`; revisi dan SHA-256 dikunci di `scripts/ocr-models.json` serta diverifikasi `scripts/setup-ocr.ps1`. Tidak ada instalasi executable OCR sistem atau unduhan saat konversi. Model yang hilang/rusak perlu dipasang ulang lewat script tersebut. [Dokumentasi model Tesseract](https://tesseract-ocr.github.io/tessdoc/Data-Files.html).

Sesi screenshot global memerlukan desktop Windows interaktif, izin aplikasi yang memadai, dan shortcut yang belum digunakan. Menjalankan server lokal saja tidak mengaktifkan screenshot.

## Instalasi

Setup normal memakai `--frozen-lockfile` dan lifecycle script dependensi frontend dimatikan. pnpm menetapkan jeda publikasi satu hari dalam mode strict. Versi persis `framer-motion@14.14.0` dan `motion-dom@14.14.0` memiliki pengecualian tercatat karena baru diterbitkan saat pembangunan. `dompurify@3.4.18` memiliki pengecualian versi persis untuk segera memakai patch keamanan. Pengecualian tidak berlaku untuk versi lain; semua paket tetap masuk audit lockfile.

Script `scripts/resolve-versions.mjs` adalah alat pemeliharaan untuk mengubah pin versi; tidak berjalan saat startup/setup normal. Setelah menggunakannya, perbarui lockfile dengan sengaja, periksa perubahan dan advisori, lalu jalankan build serta test. Jangan menjalankan pembaruan dependensi tanpa meninjau hasilnya.

## Batas keamanan lokal

- Server hanya bind ke `127.0.0.1`; host serta alamat koneksi diperiksa kembali oleh middleware.
- Seluruh mutasi API memakai pemeriksaan CSRF Django eksplisit, termasuk penolakan Origin asing.
- API tidak di-cache, dokumentasi API mati pada mode harian, dan CSP membatasi sumber aset ke aplikasi lokal.
- Tidak ada login multiuser. Pengguna/proses lain yang sudah memiliki akses komputer tetap berada dalam batas kepercayaan lokal.
- Secret dihasilkan lokal dan tidak dilacak Git. Data, antrean, runtime, dan backup juga diabaikan Git.
- PDF dan screenshot disimpan lokal tanpa enkripsi aplikasi di `data/outputs/` dan ikut backup. Tidak ada layanan konversi cloud.
- Worker PDF memiliki timeout, batas ukuran/halaman, dan pada Windows Job Object dengan batas memori 1,5 GiB. Worker screenshot memantau proses induk dan tidak auto-start.
- HTTP loopback digunakan untuk pemakaian lokal. Konfigurasi ini harus ditinjau ulang sebelum aplikasi diakses lewat LAN atau internet.

Sumber resmi: [Django releases](https://www.djangoproject.com/download/), [Node releases](https://nodejs.org/en/about/previous-releases), [Ninja CSRF](https://django-ninja.dev/guide/csrf/), [pnpm settings](https://pnpm.io/settings).
