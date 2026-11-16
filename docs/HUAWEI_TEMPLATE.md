# Huawei LLD ke MML

Generator lokal ini mendukung konfigurasi **UPF baru** berdasarkan format contoh dua sheet. Hasil mempertahankan bahasa MML contoh, termasuk ketika ekstensi unduhan dipilih `.ini`. Hasil bukan format INI key/value dan bukan VRP CLI.

Tidak ada koneksi atau eksekusi ke perangkat. Aplikasi membaca XLSX sebagai data, memvalidasi relasi, lalu membuat dua script. File XLSX, alamat, dan password contoh pengguna tidak dimasukkan ke source repository.

## Urutan perubahan

1. **Static Routing + BFD:** preparation, execution, verification, rollback.
2. **BGP over Static Routing + BFD:** preparation, execution, verification, rollback.

Jalankan preparation dan execution paket pertama, lalu verifikasi sebelum melanjutkan paket kedua. Untuk pemulihan, rollback paket BGP harus selesai sebelum rollback paket static/BFD. Berkas lengkap memuat perintah execution **dan** rollback, sehingga jangan mengeksekusi seluruh berkas sekaligus.

## Format sumber

Nama sheet yang diperlukan:

- `5G Core Service IP Design`, tabel NP Card Connection dengan header `NE Name`, `External Interface`, `Subnet Interface`, `Start IP Address`, dan parameter pendukung.
- `Routing`, tabel Loopback Design, BGP Design, VNF ke L3GW Static Route Design, serta BFD Design.

Baris header ditemukan dari nama kolom. Nomor baris boleh berubah. Kolom yang berulang pada sisi lokal dan peer dipetakan menurut urutannya. Merged cells dibaca menggunakan nilai anchor; sel kosong biasa tidak diisi turun secara otomatis. Data di luar bagian NP dan tabel routing tersebut tidak dijadikan konfigurasi.

Satu node dipilih untuk setiap paket. Setiap resource yang dipakai harus memiliki `Data Phase Type=New`. Format yang berbeda, operasi modifikasi existing, import route selain WLR, inter-VRF routing, dan migrasi AS existing memerlukan adapter/template tersendiri.

Parameter non-LLD:

- Nama interface diisi atau dikonfirmasi manual untuk physical port, trunk, subinterface, dan loopback. Nilai awal berasal dari LLD. Nama baru diterapkan konsisten pada execution, verification, dan rollback. Subinterface harus tetap mengikuti nama parent trunk yang dipilih.
- Nilai `PSWDCIPHERTEXT` BGP sesuai template. Password tidak diambil dari script contoh. Tanda kutip, koma, titik koma, backslash, spasi, dan karakter kontrol ditolak agar tidak membentuk perintah MML tambahan.
- EBGP maximum hop dan maximum load balance, dengan nilai awal 10 dan 2 sesuai template contoh.
- Konfirmasi bahwa resource baru, baseline tersimpan, dan sintaks telah diperiksa untuk produk/release perangkat.

## Validasi

Importer memeriksa IP dan mask, kecocokan VLAN dengan NP subinterface, gateway dalam subnet, port yang dipakai dua trunk, konsistensi parameter trunk, duplikasi discriminator BFD, dan relasi NP/loopback/BGP/static route. Setiap peer BGP harus mempunyai host route pendukung. VRF/IP family BGP dan loopback harus termasuk koneksi NP yang dibuat paket. Nama node dibatasi agar aman untuk nama hasil unduhan.

Mode BFD mengikuti contoh **one-arm echo**: satu session untuk satu kombinasi VRF, VLAN, IP family, dan gateway. Jika satu range discriminator mencakup beberapa instance, generator memakai nomor pertama. Baris peer cadangan dengan gateway identik tidak membuat session duplikat. Interval RX dan TX harus sama karena template echo menggunakan satu interval. Aplikasi menampilkan peringatan tentang kebijakan ini.

Trunk membership dibentuk dari data NP. Generator tidak menyalin kesalahan penamaan trunk pada contoh script. Rollback peer meliputi semua peer yang dihasilkan, lalu alamat dan loopback baru.

## Baseline dan batas rollback

Perintah rollback static route, BFD, interface, binding, trunk member, VPN family, dan VPN instance mengikuti bentuk `RMV` yang tersedia dalam contoh. Status global BFD/BGP serta admin-state physical port hanya dipulihkan jika nilai sebelumnya diberikan. Aplikasi tidak mengasumsikan semua port sebelumnya down atau semua fitur global sebelumnya off.

Opsi baseline dapat diberikan dengan field berikut:

```json
{
  "bgp_enabled_before": false,
  "bfd_enabled_before": false,
  "physical_admin_before": {
    "200GE1/0/1": "down",
    "200GE2/0/1": "up"
  }
}
```

Key physical port selalu menggunakan nama asal LLD, termasuk ketika nama hasil diubah manual. Generator memetakan perintah pemulihan ke nama hasil yang dipilih. API juga menerima bentuk `baseline` dengan field `bgp_enabled`, `bfd_enabled`, `physical_interfaces`, dan `bgp_asn`. Jika BGP sudah aktif, ASN existing harus cocok; bila ASN tidak diberikan, pemeriksaan kesamaan ASN ditampilkan sebagai langkah manual.

Contoh script yang diberikan belum memuat inverse MML untuk menghapus import WLR, BGP address family, dan BGP VRF. Generator tidak mengarang sintaks yang belum terverifikasi untuk versi UPF. Operator dapat mengisi **BGP cleanup commands** yang telah diverifikasi pada perangkat. Field ini hanya menerima `RMV IMPORTROUTE`, `RMV BGPVRFAF`, dan `RMV BGPVRF`, harus mencakup seluruh resource BGP paket tepat satu kali, dan harus mengikuti urutan import, AF, lalu VRF. VRF di luar paket ditolak.

Jika baseline atau cleanup belum lengkap, hasil berstatus `review_required`; daftar langkah yang belum lengkap tampil pada UI dan preparation dalam script. Status `baseline_supplied` berarti semua input pemulihan telah disediakan, bukan bukti pengujian sintaks pada perangkat fisik. Verifikasi release perangkat tetap diperlukan.

## Batas pembacaan XLSX

Maksimum upload 10 MB, total isi arsip 40 MB, 1.500 bagian, 20.000 baris/128 kolom per sheet, dan 120.000 sel termasuk perluasan merged cells. Encrypted XLSX, macro, external relationship, DTD/entity, formula tanpa cached value, dan error Excel ditolak. Formula tidak dievaluasi; jika cache tidak tersedia, hitung ulang dan simpan workbook di Excel sebelum upload.

## Pemeriksaan pengembangan

`backend/workspace/tests/test_huawei_lld.py` memakai XLSX sintetis di memori, termasuk IPv4/IPv6, merged cells, perubahan nama interface, relasi lintas tabel, mapping trunk, cakupan cleanup, pemulihan baseline, dan penolakan input/arsip yang tidak valid. Data contoh pengguna hanya dipakai untuk verifikasi lokal di luar repository.
