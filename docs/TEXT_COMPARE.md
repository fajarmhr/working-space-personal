# Bandingkan teks

Text Compare menyediakan dua editor teks/kode dengan perbandingan langsung. Alurnya mengacu pada Text Compare Beyond Compare 5: panel kiri/kanan, salin pada baris, filter hasil, penyimpanan berkas per sisi, dan sesi bernama. Fitur ini tidak mencakup seluruh kemampuan BC5.

## Membuka dan mengedit

- Gunakan **Buka** pada sisi kiri atau kanan, tempel teks, atau ketik langsung di tampilan **Semua**.
- Jatuhkan satu berkas ke panel tujuan. Jatuhkan dua berkas sekaligus untuk mengisi kiri lalu kanan sesuai urutan yang diberikan browser. Lebih dari dua berkas tidak diterima.
- Kedua editor dapat diedit; diff diperbarui otomatis. Tombol sebelumnya/berikutnya menavigasi blok perbedaan. Tersedia cari/ganti, bungkus baris, tampilkan whitespace, dan abaikan spasi tepi.
- Batas setiap berkas adalah 4 MB dan setiap editor 2 juta karakter. Format biner seperti PDF, gambar, arsip, dan dokumen Office ditolak.

## Menyalin dan menyamakan urutan

Panah kiri/kanan berada tepat pada baris perbedaan. Salin mengganti baris pasangan pada posisi alignment tersebut. Bila sisi tujuan tidak memiliki pasangan baris, teks dimasukkan pada celah yang sesuai; menyalin dari celah kosong menghapus pasangan baris tujuan. Gunakan `Ctrl+Z` di editor tujuan untuk membatalkan.

Penanda kuning menunjukkan pasangan teks identik yang ditemukan pada posisi berbeda. Daftar **Isi identik, posisi berbeda** mencantumkan rentang baris kiri dan kanan. **Samakan ke kanan** mengikuti posisi di kiri; **Samakan ke kiri** mengikuti posisi di kanan. Operasi memindahkan pasangan blok pada sisi tujuan, menghapusnya dari posisi lama sebelum menempatkannya pada posisi baru. Baris tujuan lain, termasuk edit yang tidak terkait, dipertahankan.

Deteksi perpindahan mencari pasangan baris/blok dengan isi persis sama pada wilayah yang berbeda; kapitalisasi dan whitespace tetap diperhitungkan, meskipun opsi abaikan spasi tepi aktif. Deteksi tidak memahami fungsi, dependensi, atau makna script. Teks yang sekaligus diubah dan dipindahkan belum dikenali sebagai satu perpindahan; teks berulang juga dapat menghasilkan pasangan yang berbeda dari maksud penulis. Tinjau rentang dan hasilnya sebelum menyimpan. Script tidak diurutkan otomatis.

## Filter

| Pilihan   | Hasil                                                                        |
| --------- | ---------------------------------------------------------------------------- |
| Semua     | Editor lengkap yang dapat diedit.                                            |
| Berbeda   | Baris yang berbeda, termasuk pasangan perpindahan yang masih berbeda urutan. |
| Sama      | Baris yang sama menurut aturan perbandingan aktif.                           |
| Berpindah | Baris/blok identik yang terdeteksi berbeda posisi.                           |

Hasil filter merupakan tampilan baca saja dengan nomor baris dokumen asli. Tombol salin tetap mengacu pada posisi dokumen lengkap, bukan nomor urut hasil filter. Pilih **Edit** untuk kembali ke baris sumber pada tampilan **Semua**. Filter tidak menghapus isi berkas.

## Menyimpan dan menutup berkas

Setiap sisi mempunyai **Simpan**, **Simpan sebagai**, dan **Tutup**. Tanda `*` menunjukkan perubahan terhadap isi terakhir yang dibuka/disimpan. `Ctrl+S` menyimpan sisi editor yang aktif; `Ctrl+Shift+S` membuka Simpan sebagai.

Pada browser yang mendukung File System Access, **Buka** memakai dialog berkas native. **Simpan** memperbarui berkas yang dibuka atau lokasi yang terakhir dipilih untuk sisi tersebut. **Simpan sebagai** memilih lokasi/nama baru. Drag-and-drop memakai akses langsung bila browser menyediakannya; jika tidak, penyimpanan pertama meminta lokasi. Pada browser tanpa dukungan tersebut, membuka memakai pemilih berkas biasa dan menyimpan menghasilkan unduhan; periksa hasil unduhan browser.

Menutup, mengganti berkas, atau membuka sesi lain akan memeriksa perubahan yang belum disimpan. Pilih **Simpan dan lanjutkan**, **Jangan simpan**, atau **Batal**. Membatalkan dialog simpan mempertahankan editor. Setelah ditutup, gunakan **Buka**, jatuhkan berkas, atau pilih **Teks baru** untuk mengisi sisi tersebut kembali.

Encoding yang didukung adalah UTF-8, UTF-8 BOM, UTF-16 LE dengan BOM, dan UTF-16 BE dengan BOM. Encoding/BOM sumber dipertahankan ketika menyimpan. Editor memakai LF secara internal; akhir baris sumber yang seragam LF, CRLF, atau CR dikembalikan saat disimpan. Berkas dengan akhir baris campuran disimpan sebagai LF. Teks baru memakai UTF-8. Penyimpanan mempertahankan teks dan format yang didukung, bukan jaminan salinan byte identik untuk seluruh berkas sumber.

## Sesi dan pemulihan draft

Isi **Nama sesi**, lalu pilih **Simpan sesi**. Snapshot menyimpan isi kedua editor, keadaan buka/tutup, nama berkas, encoding, akhir baris, baseline terakhir disimpan, dan pilihan perbandingan. Nama yang sama memperbarui snapshot sesi tersebut; nama baru membuat sesi lain. Pilih sesi dari daftar untuk membukanya, atau tombol hapus untuk menghapus snapshot. Menghapus sesi tidak menghapus berkas di disk maupun isi editor yang sedang terbuka.

**Simpan sesi** tidak menulis perubahan ke berkas sumber. Gunakan **Simpan** pada masing-masing sisi untuk itu. Draft kerja disimpan otomatis dan dipulihkan ketika alat dibuka kembali; snapshot sesi bernama diperbarui hanya saat **Simpan sesi** dipilih.

Sesi dan draft berada di IndexedDB browser pada alamat aplikasi yang dipakai. Data ini tidak dikirim ke Django dan tidak termasuk backup database Ruang. Browser/profil/alamat aplikasi lain memiliki penyimpanan terpisah; menghapus data situs dapat menghapus sesi. Pemulihan tidak menyimpan akses langsung ke berkas sumber: pada penyimpanan pertama setelah sesi/draft dipulihkan, pilih lokasi berkas kembali. Snapshot juga tidak membaca ulang perubahan berkas di disk; buka berkas kembali untuk memuat versi disk terbaru.

## Acuan BC5

- [Text Compare Commands — Beyond Compare 5](https://www.scootersoftware.com/v5help/commandstext.html): pemisahan Save File/Save Session, copy baris/blok dua arah, dan filter All/Differences/Same.
- [Managing Sessions — Beyond Compare 5](https://www.scootersoftware.com/v5help/managing_sessions.html): sesi terbaru, sesi bernama, serta pengelolaannya.
- [Text Compare Overview — Beyond Compare 5](https://www.scootersoftware.com/v5help/viewtext.html) dan [Editing Text](https://www.scootersoftware.com/v5help/editing_text.html): dua editor dengan scroll bersama dan pembaruan perbandingan ketika mengedit.
- [Moved Text is Considered Important — Scooter Software](https://www.scootersoftware.com/kb/externalconversion): BC membandingkan berdasarkan urutan baris sehingga teks berpindah tetap dianggap perubahan. Penanda perpindahan dan tindakan menyamakan urutan di Ruang merupakan fitur tambahan.
