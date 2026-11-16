# PDF ke Gambar

Alat ini merender halaman PDF menjadi gambar, lalu menyediakan koleksi halaman untuk dihapus dari pilihan, ditambah dengan PDF/gambar lain, disusun ulang, dan diedit menggunakan editor gambar. PDF sumber tidak ditimpa. Penyuntingan bekerja pada piksel halaman hasil render; teks tambahan dan anotasi digabung ke gambar saat diterapkan.

## Resolusi dan format

Pilihan awal 150, 300, dan 600 DPI menentukan jumlah piksel render, bukan sekadar mengganti metadata. API menerima bilangan bulat 75–600 DPI. Satu inci ukuran halaman menghasilkan sejumlah piksel sesuai DPI tersebut. Halaman yang memiliki rotasi bawaan mengikuti tampilan PDF. Hasil internal PNG lossless memakai latar putih dan mencakup anotasi PDF yang terlihat. Thumbnail dibuat terpisah, dengan sisi maksimum 320 piksel, sehingga daftar halaman tidak memuat semua raster penuh sekaligus.

Ekspor mendukung:

| Format | Perilaku |
| --- | --- |
| PNG | Lossless, transparansi gambar tambahan dipertahankan, metadata DPI ditulis. |
| JPEG | Kualitas 1–100; transparansi diratakan ke putih; metadata DPI ditulis. |
| WebP | Kualitas 1–100 atau lossless; dimensi piksel dipertahankan. Jangan mengandalkan metadata DPI untuk ukuran cetak WebP. |
| TIFF | Lossless dengan kompresi deflate, metadata DPI ditulis. Setiap halaman menjadi berkas terpisah. |

Unduhan satuan menghasilkan satu gambar dalam format yang dipilih. Unduhan ZIP berisi tepat halaman yang dipilih, dalam urutan koleksi, bernama `halaman-001`, `halaman-002`, dan seterusnya. Halaman yang dihapus dari koleksi tidak ikut ekspor; sumber immutable tetap tersedia untuk undo. Menambah gambar tidak menambah detail yang tidak ada pada sumber. Menaikkan DPI PDF membantu elemen vektor/teks; ketajaman scan tetap dibatasi kualitas scan asal.

Render menggunakan `Page.get_pixmap(dpi=...)`, yang menulis density pada hasil PNG. [Dokumentasi PyMuPDF](https://pymupdf.readthedocs.io/en/latest/recipes-images.html#how-to-increase-image-resolution). Penulisan format/density mengikuti opsi Pillow yang digunakan secara eksplisit. [Dokumentasi format Pillow](https://pillow.readthedocs.io/en/stable/handbook/image-file-formats.html).

## Batas pemrosesan

- PDF maksimal 25 MB dan 100 halaman; PDF bersandi, rusak, dan halaman tidak valid ditolak.
- Setiap halaman/gambar maksimal 40 megapiksel dan sisi 8.192 piksel. Bila DPI menghasilkan raster yang lebih besar, aplikasi meminta DPI lebih rendah; aplikasi tidak diam-diam menurunkan resolusi.
- Satu pekerjaan import/export maksimal 1 gigapiksel total dan 512 MB hasil. Pecah koleksi menjadi beberapa ekspor jika diperlukan.
- Gambar tambahan/hasil edit menerima PNG, JPEG, dan WebP maksimal 128 MB, dengan batas dimensi yang sama. EXIF orientation dinormalisasi, metadata sumber dihapus, dan aset disimpan ulang sebagai PNG.
- Hanya satu pekerjaan PDF-gambar aktif. Render PDF dan ekspor batch menggunakan proses terpisah dengan batas 300 detik. Windows Job Object membatasi worker pada 1,5 GiB dan menghentikannya ketika backend berhenti.

## Penyimpanan dan API

Sumber, raster, thumbnail, status, dan hasil ekspor disimpan lokal di `data/outputs/pdf-images/<uuid>/`. Lokasi ini mengikuti backup `data/outputs/` dan diabaikan Git. Menutup panel atau menghapus halaman dari koleksi tidak menghapus sumber di disk. Berkas berisi isi dokumen pengguna dan mengikuti perlindungan akun/disk Windows. Hentikan pekerjaan sebelum backup atau pembersihan manual ketika aplikasi berhenti.

API hanya menerima ID UUID, tidak menerima path filesystem. Seluruh mutasi mengikuti CSRF dan batas loopback aplikasi.

| Endpoint | Fungsi |
| --- | --- |
| `POST /api/pdf-images/import` | Multipart `file`, `dpi`; mengembalikan job 202. |
| `GET /api/pdf-images/jobs/{id}` | Status/progres dan daftar aset ketika import selesai. |
| `POST /api/pdf-images/assets` | Multipart gambar dan DPI; mengembalikan aset immutable. |
| `GET /api/pdf-images/assets/{job_id}/{asset_id}` | PNG resolusi penuh. |
| `GET /api/pdf-images/thumbnail/{job_id}/{asset_id}` | PNG thumbnail. |
| `POST /api/pdf-images/export` | JSON `pages:[{job_id,id}]`, `format`, `quality`, `bundle`, `webp_lossless`; mengembalikan job 202. `bundle:false` memerlukan tepat satu halaman. |
| `GET /api/pdf-images/download/{id}` | Unduh hasil export selesai secara native melalui link. |

Job lama yang terputus ketika server restart menjadi gagal setelah deadline, bukan dipantau tanpa akhir. Hasil parsial tidak diterbitkan sebagai koleksi selesai. Semua hasil ditulis di lokasi sementara lalu dipublikasikan melalui status atomic.

## Verifikasi pengembangan

`test_pdf_images.py` memakai PDF/gambar sintetis nyata: 300/600 DPI, rotasi halaman, warna piksel, thumbnail, normalisasi EXIF/alpha, PNG/JPEG/WebP/TIFF, metadata density, urutan ZIP dan penghapusan pilihan, penolakan input/path/ukuran, CSRF, deadline restart, launch failure, dan worker lokal yang disupervisi. Pengujian memakai direktori data sementara, tidak mengubah `data/` pengguna.
