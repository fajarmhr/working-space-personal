# Tools harian Ruang

Semua 17 tools berjalan lokal. Catatan, tugas, snippet, preferensi, favorit, dan nama aksi penggunaan disimpan oleh Django. Perbandingan teks, CSV/JSON, checksum, gambar, dan hasil generator tetap di browser. PDF diproses backend lokal; Capture Studio menyimpan hasil sesi di `data/outputs/`.

| Tool               | Kegunaan                            | Batas dan perilaku                                                                                                           |
| ------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| JSON formatter     | Validasi, format, minify            | Input UI 500.000 karakter; kedalaman 100. Angka besar, desimal, escape, dan urutan key dipertahankan.                        |
| Ubah teks          | Kapitalisasi, slug, spasi, hitungan | 200.000 karakter; mendukung huruf Unicode.                                                                                   |
| Base64             | Encode/decode teks UTF-8            | 200.000 karakter; decode menolak data yang bukan UTF-8 valid.                                                                |
| Password generator | Kata sandi acak                     | 12–64 karakter; random kriptografis dengan rejection sampling. Tidak disimpan.                                               |
| Timer fokus        | Fokus dan jeda                      | Deadline disimpan di browser; perpindahan tool/refresh tetap menghitung. Penyelesaian dicatat saat panel dibuka kembali.     |
| Catatan cepat      | Catatan bebas                       | 100.000 karakter; autosave ke SQLite, draf gagal kirim dipertahankan di browser.                                             |
| Tugas harian       | Prioritas dan tenggat               | Maksimal 1.000 tugas; judul 180 karakter, detail 4.000 karakter. Filter tanggal memakai Asia/Makassar.                       |
| Pustaka snippet    | Template atau teks siap pakai       | Maksimal 500 snippet; judul 120, kategori 40, isi 20.000 karakter. Teks tidak dieksekusi.                                    |
| CSV & JSON         | Konversi tabel/data                 | Mendukung koma, titik koma, tab, kutipan, dan sel multiline. Nilai CSV dipertahankan sebagai teks agar nol depan tetap utuh. |
| Bandingkan teks    | Dua editor dengan diff langsung     | Berkas maksimal 4 MB dan 2 juta karakter per editor; UTF-8 atau UTF-16 dengan BOM.                                            |
| Tanggal & waktu    | Epoch, ISO, zona waktu, interval    | Unit epoch dipilih eksplisit. ISO memerlukan offset. Hari kerja menghitung Senin–Jumat tanpa kalender hari libur.            |
| URL toolkit        | Encode/decode dan query             | Pemeriksa menerima URL HTTP/HTTPS. Parameter berulang tetap terlihat. Tidak membuka tautan secara otomatis.                  |
| UUID generator     | Identitas UUID v4                   | 1–100 ID per proses, menggunakan crypto.randomUUID browser.                                                                  |
| Checksum berkas    | SHA-256 dan pencocokan              | Maksimal 50 MB; berkas tidak diunggah ke server.                                                                             |
| Olah gambar        | Resize, format, anotasi, blur        | JPG/PNG/WebP maksimal 20 MB/40 MP; hasil maksimal 20 MP dan sisi 8.192 piksel; maksimal 100 anotasi.                          |
| PDF ke Word        | PDF ke DOCX editable                | Maksimal 25 MB/100 halaman, satu pekerjaan aktif, batas proses 60 detik. PDF bersandi ditolak; OCR belum tersedia.           |
| Capture Studio     | Screenshot DOCX dan input pilihan  | Windows, sesi manual. Screenshot maksimal 200 per sesi, 40 MP per gambar/256 MB PNG total; log input maksimal 10 MB.         |

## Bandingkan teks

Kedua panel Monaco dapat diedit. Tempel teks atau buka berkas di masing-masing sisi; perbedaan diperbarui otomatis tanpa tombol Bandingkan. Navigasi blok sebelumnya/berikutnya dan tombol panah dapat menyalin blok terpilih ke kiri atau kanan. Undo/redo berlaku juga untuk pembukaan berkas dan penyalinan blok. Tersedia pencarian/penggantian, bungkus baris, penanda whitespace, abaikan spasi awal/akhir, serta sembunyikan wilayah yang sama.

Deteksi encoding mendukung UTF-8, UTF-8 BOM, UTF-16 LE/BE dengan BOM. Format biner seperti PDF, gambar, dan dokumen Office ditolak. Akhir baris dinormalisasi menjadi LF di editor; unduhan selalu UTF-8/LF, bukan salinan byte asli. Isi editor tidak disimpan otomatis: unduh sebelum meninggalkan panel.

## Konversi CSV

Header harus terisi dan unik; jumlah kolom tiap baris harus sesuai. File impor wajib UTF-8 valid. CSV ke JSON menghasilkan nilai teks; JSON ke CSV menerima array objek datar. Angka JSON tidak dibulatkan ketika dikonversi.

Proteksi formula spreadsheet aktif secara default ketika mengekspor CSV. Nilai yang berpotensi dibaca sebagai formula diberi awalan apostrof. Ini mengubah representasi sel dengan sengaja; opsi dapat dimatikan saat kebutuhan pertukaran data memerlukan nilai persis. Pratinjau dan helper UI menjelaskan pilihan ini.

## Gambar

Format sumber diperiksa dari header berkas dan dimensinya dibatasi sebelum decode. SVG tidak diterima. Ekspor melalui canvas menghapus metadata sumber dan menghasilkan gambar diam. JPEG mengisi area transparan dengan putih. Kualitas hanya berlaku pada JPEG/WebP; PNG tidak memakai pengaturan kualitas lossy. Ukuran berkas hasil tidak selalu lebih kecil.

Anotasi tersedia sebagai kotak, bulat/elips, panah, nomor, tulisan, dan area blur. Pilih bentuk untuk memindahkan, mengubah ukuran, warna/garis, rotasi, serta skew horizontal/vertikal (maksimal ±45°); undo/redo dan hapus tersedia. Tulisan maksimal 1.000 karakter dan nomor 1–999. Anotasi mengikuti ukuran gambar saat resize dan digabung ke piksel saat ekspor. Proyek anotasi tidak disimpan otomatis; simpan gambar hasil sebelum menutup panel.

## PDF ke Word

Unggah PDF untuk menghasilkan DOCX dengan teks yang dapat diedit. Engine lokal mencoba memulihkan paragraf, tabel, kolom, serta gambar. Layout tidak dapat dijamin sama persis: periksa font, tabel, header/footer, dan pemisahan halaman setelah membuka hasil di Word.

PDF tanpa teks terdeteksi, termasuk scan murni, ditolak dan memerlukan OCR dari aplikasi lain. Pada PDF campuran, halaman tanpa teks diberi peringatan dan isi scan tidak menjadi teks editable. Tidak ada mode pengganti berupa gambar halaman maupun layanan cloud/OCR. PDF rusak, bersandi, atau melewati batas ditolak dengan pesan status.

Pekerjaan berjalan di proses terpisah dengan tahap validasi, konversi, dan verifikasi DOCX. Status dapat dipantau dari panel; satu konversi berjalan pada satu waktu dengan batas 60 detik. Berkas sumber, hasil, status, dan log disimpan di `data/outputs/pdf/<uuid>/`; tidak ada penghapusan otomatis saat ini.

## Capture Studio

### Screenshot ke DOCX

Mulai sesi secara manual, pilih **Ctrl+Shift+S** (default) atau **Ctrl+Alt+S**, lalu tunggu status aktif. Shortcut yang sedang digunakan aplikasi lain menghasilkan error; pilih alternatif atau hentikan pemakai shortcut tersebut. Tombol tangkap di panel juga tersedia saat sesi aktif.

Setiap tangkapan layar utama disimpan sebagai PNG dan ditambahkan ke satu DOCX landscape, satu gambar per halaman dengan nomor/waktu. Rasio gambar dipertahankan agar muat halaman. DOCX diganti secara atomik setelah setiap tangkapan berhasil; hasil sebelumnya tetap tersedia jika tangkapan berikutnya gagal. Tekanan shortcut berulang saat proses sibuk digabung agar tidak membentuk antrean tanpa batas.

Hentikan sesi setelah selesai, lalu unduh DOCX dari sesi saat ini atau riwayat. Data tersimpan di `data/outputs/captures/<uuid>/` (`frames/`, `report.docx`, dan status). Maksimal 200 screenshot, 40 MP per gambar dan total PNG 256 MB per sesi.

### Perekam input aplikasi pilihan

Pilih satu atau lebih aplikasi: Notepad, Notepad++, Visual Studio Code, Windows PowerShell, PowerShell, Command Prompt, atau Windows Terminal. Mulai sesi secara manual setelah memahami cakupannya. Hanya input aplikasi terpilih yang sedang berada di depan yang dicatat; perpindahan aplikasi memisahkan buffer. Browser dan aplikasi di luar daftar tidak dicatat. Shortcut dapat muncul sebagai tag, misalnya `[CTRL+V]`; isi clipboard tidak dibaca. IME/komposisi teks tidak dijamin direkonstruksi sempurna.

Jendela indikator Windows **Rekam input aktif** tetap terlihat walaupun tab Ruang ditutup, lengkap dengan tombol berhenti. **Ctrl+Alt+Shift+K** adalah shortcut berhenti darurat. Jika indikator atau shortcut darurat gagal disiapkan, sesi tidak mulai merekam. Input sintetis yang ditandai Windows sebagai injected diabaikan.

Kolom password standar Windows disaring secara best-effort; filter ini tidak menjamin rahasia tersaring pada terminal, webview, atau kontrol khusus. Hentikan sesi sebelum memasukkan password, token, atau informasi sensitif. Log bukan rekonstruksi persis dokumen yang sedang diedit: input dicatat per aplikasi/waktu dan disimpan sebagai TXT UTF-8 maksimal 10 MB di `data/outputs/keyboard/<uuid>/`.

Kedua jenis sesi berlanjut sampai dihentikan atau backend berhenti. Tidak ada auto-start atau pemulihan rekaman otomatis. Proses helper memantau umur backend agar tidak tetap merekam setelah proses induk keluar. Pengujian otomatis memakai mock/synthetic input dan gambar buatan; pengujian tersebut tidak merekam layar atau input keyboard nyata.

## Data produktivitas

Simpan tugas/snippet menunggu respons API sebelum memperbarui daftar. Jika gagal, isian editor tetap ada agar dapat dicoba lagi. Penghapusan memakai konfirmasi. Draf otomatis hanya tersedia untuk Catatan Cepat; simpan isian editor tugas/snippet sebelum menutup panel.

Backup workspace menyertakan SQLite, secret, serta folder `data/files/` dan `data/outputs/` jika ada. Hentikan pekerjaan PDF dan sesi capture/input sebelum backup agar hasil tidak berubah saat disalin. Unduhan browser yang disimpan di luar folder tersebut tidak tercakup. Data dan backup tersimpan tanpa enkripsi aplikasi.
