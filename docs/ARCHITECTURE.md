# Arsitektur Ruang

## Batas aplikasi

Satu pengguna, satu komputer Windows, akses browser melalui loopback. Bukan layanan jaringan atau aplikasi multiuser. Backend tidak menyediakan endpoint untuk membuka sembarang path filesystem atau menjalankan perintah shell.

## Modular monolith

Satu repository berisi frontend React/TypeScript dan backend Django. Frontend tidak mengimpor implementasi Python. Kontrak JSON bertipe memisahkan UI dan API. Django Ninja melakukan validasi input, sementara service backend mengelola transaksi dan model.

Registry eksplisit di `backend/workspace/registry.py` berisi ID, kategori, nama, deskripsi, dan lokasi eksekusi tools. Penambahan tools dilakukan lewat kode yang ditinjau, bukan memuat plugin atau kode pihak ketiga secara dinamis.

Tools ringan berjalan di browser: perbandingan teks, CSV/JSON, pengolah teks, generator, checksum, dan editor gambar. Backend menyimpan catatan, tugas harian, pustaka snippet, preferensi, favorit, serta metadata aktivitas; PDF dan Capture Studio menggunakan service backend lokal. Model tugas dan snippet memiliki migrasi tersendiri; koleksinya diambil saat panel dibuka, bukan dibawa dalam bootstrap workspace.

## Alur request

1. Browser memuat hasil build React dari server lokal.
2. `GET /api/bootstrap` mengambil registry dan data workspace serta menerbitkan token CSRF.
3. Mutasi mengirim cookie same-origin dan header `X-CSRFToken`.
4. Middleware memeriksa host, alamat loopback, Origin/CSRF, dan batas API.
5. API memvalidasi payload; service menulis SQLite dengan transaksi pendek.

Mode development mem-proxy `/api` melalui Vite. Mode harian menggunakan Waitress dan WhiteNoise untuk aset build, tanpa server Node.

## Data dan pekerjaan background

SQLite menyimpan metadata dan teks catatan. WAL serta transaksi pendek membantu UI dan worker berbagi data dengan beban kecil; ini tidak menghilangkan batas satu writer SQLite. PostgreSQL dipertimbangkan jika penulisan paralel mulai menjadi kebutuhan nyata.

Huey dikonfigurasi dengan database antrean SQLite terpisah dan belum digunakan oleh 17 tools saat ini. PDF dan Capture Studio memakai proses helper khusus dengan status JSON persisten; keduanya tidak membutuhkan `run_huey`. Worker Huey opsional tetap dapat dijalankan dengan `backend/.venv/Scripts/python.exe backend/manage.py run_huey` untuk adapter pekerjaan mendatang.

Folder `data/outputs/pdf/<uuid>/` dan `data/outputs/captures/<uuid>/` memisahkan pekerjaan/sesi. API menerima ID UUID yang divalidasi, bukan path dari browser, dan memeriksa containment saat mengakses hasil. Metadata dan hasil DOCX memakai file sementara lalu atomic replace. Backup menyertakan `data/files/` dan `data/outputs/`; hentikan pekerjaan/sesi terlebih dahulu untuk snapshot berkas yang stabil.

## PDF ke DOCX

`pdf_conversion_api.py` menerima multipart melalui `POST /api/pdf/convert`, mengembalikan job 202, menyediakan `GET /api/pdf/jobs/{id}` untuk status dan `GET /api/pdf/download/{id}` untuk hasil selesai. Hanya mode `editable` tersedia, dengan `ocr_mode` auto/off/force serta `ocr_language` eng+ind/eng/ind. Batasnya 25 MB, 100 halaman, satu pekerjaan aktif, dan timeout 300 detik.

Service meluncurkan modul Python tetap `workspace.pdf_conversion_worker` tanpa shell. PyMuPDF memeriksa struktur/teks/gambar. Untuk scan, `pdf_ocr.py` menjalankan Tesseract bawaan PyMuPDF dengan model lokal `tessdata_best` dan menyiapkan teks terlihat untuk konversi. Mode otomatis mempertahankan halaman digital; force membaca ulang halaman. pdf2docx menyusun DOCX melalui python-docx, lalu worker memverifikasi ZIP, struktur Word, serta keberadaan teks editable sebelum menerbitkan hasil. Status menampilkan tahap OCR dan halaman yang dibaca. PDF kosong, bersandi, dan input terlalu kompleks ditolak. Tidak ada konversi cloud maupun fallback gambar halaman; hasil OCR dan kesetiaan layout tetap memerlukan pemeriksaan.

Pada Windows, Job Object membatasi memori proses ke 1,5 GiB dan menghentikan child ketika backend keluar. Worker menunggu gate setelah berhasil terikat ke Job Object sebelum membaca PDF. Supervisor menangani timeout/kegagalan; job yang tertinggal setelah restart ditandai gagal setelah deadline. Sumber, hasil, status, dan log berada di folder job sampai dihapus manual. Tool ini tidak membutuhkan instalasi Microsoft Word, LibreOffice, atau executable OCR sistem. Model bahasa dipasang sekali oleh `setup-ocr.ps1`, dengan commit/hash di `ocr-models.json`; konversi tidak mengunduh model.

## Capture Studio Windows

`capture_api.py` menyediakan `/api/capture/status`, `/start`, `/take`, `/stop`, `/sessions`, dan `/download/{id}`. Semua start/stop/take menggunakan POST dengan CSRF. Import module, bootstrap, serta pembacaan status tidak menangkap layar.

`capture_service.py` mengelola satu proses screenshot per backend, meluncurkan modul milik aplikasi menggunakan interpreter tetap, stdin untuk stop/perintah, dan watchdog handle proses induk. Tidak ada executable atau path bebas dari payload. Helper berhenti pada stop, stdin tertutup, atau backend keluar; sesi tidak diaktifkan ulang saat startup.

Screenshot memakai `RegisterHotKey` untuk Ctrl+Shift+S atau Ctrl+Alt+S, tanpa hook keyboard umum. Pillow menangkap layar utama setelah hotkey/tombol eksplisit; python-docx membangun ulang laporan landscape dengan gambar berasio tetap, nomor, dan waktu. Setiap keberhasilan mengganti DOCX secara atomik. Batas sesi: 200 gambar, 40 MP/gambar, total PNG 256 MB; antrean tangkapan dikoaleskan saat sibuk.

Pengujian service, CSRF, state, path, dan penulisan DOCX menggunakan proses/native API mock serta gambar buatan. Pengujian tersebut tidak mengambil screenshot desktop pengguna.

## UI

React SPA dengan komponen kecil, state lokal, Tailwind v4, serta primitives shadcn yang disesuaikan. Geist dan Geist Mono dibundel lokal. Satu aksen emerald, layout asimetris yang runtuh menjadi satu kolom di mobile, navigasi keyboard, dan dukungan reduced motion. Motion intensif dipisahkan ke leaf component agar tidak memicu render ulang seluruh workspace.

Panel tools memakai dynamic import terpisah. Monaco Diff Editor dibundel lokal bersama worker, menyediakan dua model editable dengan deteksi perubahan otomatis, merge blok, pencarian, dan undo. Berkas teks dibatasi 4 MB/2 juta karakter per editor, dengan decode UTF-8 atau UTF-16 BOM; kontennya tidak dikirim ke backend.

Editor gambar memakai canvas dengan model anotasi serta riwayat undo/redo di browser. Bentuk, tulisan, skew, dan blur dirasterisasi ke hasil ekspor setelah resize. Pratinjau memakai URL blob lokal dengan izin CSP pada `img-src`; worker editor juga berasal dari aset build lokal. Script dan koneksi tetap dibatasi ke origin aplikasi.

## Ekstensi

Urutan menambah tool: daftarkan metadata, implementasikan panel UI, tambahkan service/API hanya jika dibutuhkan, uji validasi dan alur pengguna. Tambahkan dependensi sesuai kebutuhan nyata. Desktop wrapper dan backend Node terpisah baru dipertimbangkan jika integrasi OS atau pustaka khusus membutuhkannya.
