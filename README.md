# Sistem CBT Ujian Sejarah Indonesia
### SMK PGRI 11 CILEDUG KOTA TANGERANG

Aplikasi Ujian Berbasis Web (Computer Based Test) khusus mata pelajaran **Sejarah Indonesia**, dirancang dengan antarmuka modern, fokus, bebas distraksi, serta ramah pengguna bagi siswa dan guru.

---

## 📁 Struktur Halaman Web

1. **[`login.html`](login.html)**: Halaman Login terpadu dengan pemilih peran (*Peserta Ujian / Siswa* dan *Identitas Guru : Yoga Rahmanda, S.Pd*).
2. **[`index.html`](index.html)**: Halaman Utama Ujian Siswa (Desktop View):
   - **Header**: Judul Ujian, Nama Siswa/NISN, Indikator *Auto-Save* Mikro, dan *Countdown Timer* interaktif (berubah merah saat sisa waktu < 5 menit).
   - **Area Soal (Kiri/Tengah)**: 40 butir soal pilihan ganda (A, B, C, D) bermuatan silabus Sejarah Indonesia (Proklamasi, Politik Etis, Dekrit Presiden, Reformasi 1998, dll.), navigasi tombol *Sebelumnya*, *Ragu-ragu*, *Selanjutnya*, dan *Selesai*.
   - **Sidebar (Kanan)**: Grid nomor soal (1-40) dengan indikator warna status dinamis (Hijau = Dijawab, Kuning = Ragu-ragu, Abu-abu = Belum).
   - **Anti-Cheat Monitoring**: Modal pop-up peringatan otomatis jika siswa berpindah tab, minimize browser, atau mencoba melakukan split-screen.
   - **Kalkulasi Nilai Otomatis**: Menghitung skor akhir secara instan saat ujian diselesaikan.
3. **[`admin.html`](admin.html)**: Dashboard Monitoring & Manajemen Nilai Guru:
   - Rekapitulasi nilai siswa secara *real-time*.
   - Filter berdasarkan kelas (XII RPL 1, XII RPL 2, XII AKL 1, XII OTKP 1) dan pencarian nama/NISN.
   - Pemantauan status log pelanggaran kecurangan (*anti-cheat log*).
   - Fitur **Export Nilai ke Excel/CSV**.

---

## 🚀 Cara Menjalankan

Aplikasi ini dibuat secara mandiri (*standalone*) menggunakan HTML5, Tailwind CSS (via CDN), dan Vanilla JavaScript tanpa memerlukan build tool yang rumit:

1. **Buka Langsung di Browser**:
   - Cukup klik ganda file `login.html` atau `index.html` untuk membuka di Google Chrome, Microsoft Edge, Mozilla Firefox, dsb.
2. **Atau Menggunakan Live Server / Server Lokal**:
   - Jika menggunakan VS Code / Antigravity, klik kanan `login.html` lalu pilih *Open with Live Server*.
   - Atau menggunakan Python built-in server:
     ```bash
     python -m http.server 8080
     ```
     Lalu buka `http://localhost:8080/login.html` di browser.

---

© 2026 SMK PGRI 11 CILEDUG KOTA TANGERANG
