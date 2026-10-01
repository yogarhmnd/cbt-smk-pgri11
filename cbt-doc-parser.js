/**
 * CBT Sejarah Indonesia - Universal Document & Question Parser Engine
 * SMK PGRI 11 CILEDUG KOTA TANGERANG
 *
 * Mendukung format:
 * - Microsoft Word (.docx) via Mammoth.js
 * - Adobe PDF (.pdf) via PDF.js
 * - Plain Text & Paste (.txt, direct paste)
 * - JSON & CSV
 *
 * Mengonfigurasi dan memetakan soal secara langsung ke struktur CBT (BAB 1 s/d BAB 6)
 */

(function (window) {
  'use strict';

  const CBTDocParser = {
    // Normalisasi angka romawi ke format BAB standar
    romanToBab(romanOrNum) {
      if (!romanOrNum) return 'BAB 1';
      const clean = romanOrNum.toString().trim().toUpperCase();
      const map = {
        'I': 'BAB 1', '1': 'BAB 1',
        'II': 'BAB 2', '2': 'BAB 2',
        'III': 'BAB 3', '3': 'BAB 3',
        'IV': 'BAB 4', '4': 'BAB 4',
        'V': 'BAB 5', '5': 'BAB 5',
        'VI': 'BAB 6', '6': 'BAB 6',
        'VII': 'BAB 7', '7': 'BAB 7',
        'VIII': 'BAB 8', '8': 'BAB 8'
      };
      return map[clean] || (`BAB ${clean}`);
    },

    // Ekstraksi teks murni dari File (Word .docx, PDF, TXT/CSV/JSON)
    async extractTextFromFile(file) {
      const fileName = file.name.toLowerCase();

      // 1. Word Document (.docx)
      if (fileName.endsWith('.docx')) {
        if (!window.mammoth) {
          throw new Error('Library Mammoth.js belum dimuat. Periksa koneksi internet.');
        }
        const arrayBuffer = await file.arrayBuffer();
        const result = await window.mammoth.extractRawText({ arrayBuffer: arrayBuffer });
        return result.value || '';
      }

      // 2. Adobe PDF (.pdf)
      if (fileName.endsWith('.pdf')) {
        if (!window.pdfjsLib) {
          throw new Error('Library PDF.js belum dimuat. Periksa koneksi internet.');
        }
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
        const pdf = await loadingTask.promise;
        let fullText = '';
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(' ');
          fullText += pageText + '\n\n';
        }
        return fullText;
      }

      // 3. File Teks Biasa (.txt, .json, .csv)
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result || '');
        reader.onerror = (e) => reject(new Error('Gagal membaca berkas teks.'));
        reader.readAsText(file);
      });
    },

    // Parsing cerdas teks soal menjadi struktur Array CBT Questions
    parseQuestions(rawText, defaultBab = 'AUTO') {
      if (!rawText || typeof rawText !== 'string') {
        return { questions: [], babCounts: {}, total: 0, warnings: [] };
      }

      // 1. Bersihkan dan rapikan teks
      let cleaned = rawText
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/\u00A0/g, ' '); // non-breaking space

      // Deteksi jika dokumen adalah JSON murni
      const trimmed = cleaned.trim();
      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        try {
          const parsed = JSON.parse(trimmed);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          const validated = list.map((q, idx) => ({
            id: q.id || (Date.now() + idx),
            bab: q.bab || (defaultBab !== 'AUTO' ? defaultBab : 'BAB 1'),
            type: q.type === 'essay' ? 'essay' : (q.type === 'short_essay' ? 'short_essay' : 'mcq'),
            text: q.text || q.soal || 'Soal Sejarah Indonesia',
            options: q.options || (q.opsi ? Object.keys(q.opsi).map(k => ({ key: k.toUpperCase(), text: q.opsi[k] })) : []),
            correct: (q.correct || q.kunci || 'A').toString().trim().toUpperCase(),
            points: parseFloat(q.points || q.bobot) || 2.0,
            aiKeywords: q.aiKeywords || q.keywords || []
          }));
          return this.summarizeResults(validated);
        } catch (e) {
          // Lanjut ke parser teks bebas
        }
      }

      // Deteksi Kunci Jawaban terpisah di bagian akhir dokumen
      // Misal: "KUNCI JAWABAN: 1. A 2. B 3. C" atau "KUNCI: 1=A, 2=B, 3=C"
      const separateKeysMap = {};
      const kunciSectionMatch = cleaned.match(/(?:KUNCI\s+JAWABAN|KUNCI\s+SOAL|KUNCI)\s*[:\n]([\s\S]+)$/i);
      if (kunciSectionMatch) {
        const kunciText = kunciSectionMatch[1];
        const keyItemRegex = /(?:^|\s|,|;)([0-9]{1,3})[\.\=\-\:\s]+([A-Ea-e])\b/g;
        let km;
        while ((km = keyItemRegex.exec(kunciText)) !== null) {
          separateKeysMap[parseInt(km[1], 10)] = km[2].toUpperCase();
        }
      }

      // Pisahkan teks menjadi baris-baris
      const lines = cleaned.split('\n');
      const questions = [];
      let currentBab = (defaultBab !== 'AUTO' ? defaultBab : 'BAB 1');
      let currentQuestion = null;
      let questionCounter = 0;

      // Regex untuk mendeteksi Header BAB
      // Contoh: "BAB 1 : Kependudukan Jepang", "BAB II", "Bab 3 - Mempertahankan Kemerdekaan", "Modul 4"
      const babHeaderRegex = /^\s*(?:#{1,4}\s*)?(?:BAB|Bab|bab|MODUL|Modul|KD)\s*([0-9IVXLCDM]+|[1-6])\b(?:\s*[:\-\.]?\s*(.*))?$/i;

      // Regex untuk mendeteksi Awal Soal
      // Contoh: "1. ", "1) ", "Soal 1.", "No. 1 ", "1 . ", "[1] "
      const questionStartRegex = /^\s*(?:(?:Soal|No\.?|Nomor)\s*)?([0-9]{1,3})[\.\)\-\]\:]\s*(.*)$/i;

      // Regex untuk mendeteksi Pilihan Opsi
      // Contoh: "A. ", "A) ", "(A) ", "a. ", "*A. " (jika bertanda bintang adalah kunci)
      const optionRegex = /^\s*(\*?)\s*([A-Ea-e])[\.\)\-\]\:]\s*(.*)$/;

      // Regex untuk mendeteksi Kunci Jawaban di dalam blok soal
      // Contoh: "Kunci: A", "Jawaban: B", "Kunci Jawaban = C"
      const inlineKeyRegex = /^\s*(?:Kunci(?:\s*Jawaban)?|Jawaban|Key|Answer)\s*[:\=\-]\s*([A-Ea-e])\b/i;

      // Regex untuk mendeteksi Bobot/Poin
      const pointsRegex = /(?:Bobot|Poin|Score|Nilai)\s*[:\=\-]?\s*([0-9\.]+)/i;

      // Regex untuk mendeteksi Kata Kunci Esai
      const keywordsRegex = /^\s*(?:Kata\s*Kunci|Rubrik|Keywords|AI\s*Rubric)\s*[:\=\-]\s*(.*)$/i;

      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const line = rawLine.trim();
        if (!line) continue;

        // Cek apakah baris ini adalah header BAB
        const babMatch = line.match(babHeaderRegex);
        if (babMatch && defaultBab === 'AUTO') {
          currentBab = this.romanToBab(babMatch[1]);
          continue;
        }

        // Cek apakah baris ini memulai soal baru
        const qMatch = line.match(questionStartRegex);
        if (qMatch) {
          // Simpan soal sebelumnya jika ada
          if (currentQuestion) {
            this.finalizeQuestion(currentQuestion, separateKeysMap);
            questions.push(currentQuestion);
          }

          questionCounter++;
          const qNum = parseInt(qMatch[1], 10) || questionCounter;
          const initialText = qMatch[2] ? qMatch[2].trim() : '';

          // Deteksi apakah ada penanda [Esai] atau [Essay]
          const isExplicitEssay = /\[(esai|essay|uraian|isian)\]/i.test(line);

          currentQuestion = {
            id: Date.now() + questionCounter,
            qNumber: qNum,
            bab: (defaultBab !== 'AUTO' ? defaultBab : currentBab),
            type: isExplicitEssay ? 'essay' : 'mcq',
            text: initialText.replace(/\[(esai|essay|uraian|isian)\]/gi, '').trim(),
            options: [],
            correct: separateKeysMap[qNum] || '',
            points: isExplicitEssay ? 4.0 : 2.0,
            aiKeywords: [],
            rawLines: [line]
          };

          // Cek apakah ada bobot pada baris pertama
          const ptsMatch = line.match(pointsRegex);
          if (ptsMatch) {
            currentQuestion.points = parseFloat(ptsMatch[1]) || currentQuestion.points;
          }

          continue;
        }

        // Jika belum ada soal yang dimulai, abaikan pengantar/kop surat
        if (!currentQuestion) continue;

        // Cek baris Kunci Jawaban
        const keyMatch = line.match(inlineKeyRegex);
        if (keyMatch) {
          currentQuestion.correct = keyMatch[1].toUpperCase();
          continue;
        }

        // Cek baris Kata Kunci Esai (Rubrik AI)
        const kwMatch = line.match(keywordsRegex);
        if (kwMatch) {
          currentQuestion.type = 'essay';
          currentQuestion.aiKeywords = kwMatch[1]
            .split(/[,;]/)
            .map(k => k.trim())
            .filter(k => k.length > 0);
          continue;
        }

        // Cek baris Bobot Nilai
        const ptsLineMatch = line.match(pointsRegex);
        if (ptsLineMatch && !line.includes('?')) {
          currentQuestion.points = parseFloat(ptsLineMatch[1]) || currentQuestion.points;
          continue;
        }

        // Cek apakah baris ini adalah opsi jawaban A, B, C, D, E
        const optMatch = line.match(optionRegex);
        if (optMatch) {
          const hasStar = optMatch[1] === '*';
          const optKey = optMatch[2].toUpperCase();
          let optText = optMatch[3].trim();

          // Cek jika ada penanda kunci di dalam teks opsi: "A. Opsi (Kunci)"
          if (/\((?:kunci|jawaban|benar|key)\)/i.test(optText)) {
            currentQuestion.correct = optKey;
            optText = optText.replace(/\((?:kunci|jawaban|benar|key)\)/gi, '').trim();
          } else if (hasStar) {
            currentQuestion.correct = optKey;
          }

          currentQuestion.options.push({
            key: optKey,
            text: optText
          });
          continue;
        }

        // Opsi sebaris (Inline options seperti: "A. Opsi 1  B. Opsi 2  C. Opsi 3")
        const inlineOptRegex = /(?:^|\s)([A-Ea-e])[\.\)\-\]]\s+([^A-Ea-e\.\)\-\]]+)(?=(?:\s+[A-Ea-e][\.\)\-\]]|$))/g;
        let inlineMatches = [];
        let im;
        while ((im = inlineOptRegex.exec(line)) !== null) {
          inlineMatches.push({ key: im[1].toUpperCase(), text: im[2].trim() });
        }
        if (inlineMatches.length >= 2) {
          inlineMatches.forEach(m => currentQuestion.options.push(m));
          continue;
        }

        // Jika bukan opsi/kunci/header, gabungkan baris sebagai kelanjutan teks pertanyaan
        if (currentQuestion.options.length === 0) {
          currentQuestion.text += (currentQuestion.text ? '\n' : '') + line;
        } else {
          // Kelanjutan teks dari opsi terakhir
          const lastOpt = currentQuestion.options[currentQuestion.options.length - 1];
          if (lastOpt) {
            lastOpt.text += ' ' + line;
          }
        }
      }

      // Finalisasi soal terakhir
      if (currentQuestion) {
        this.finalizeQuestion(currentQuestion, separateKeysMap);
        questions.push(currentQuestion);
      }

      return this.summarizeResults(questions);
    },

    // Finalisasi satu butir soal
    finalizeQuestion(q, separateKeysMap) {
      // Jika tidak ada opsi sama sekali dan ada tanda tanya / teks panjang -> tipe Esai
      if (q.options.length === 0) {
        q.type = 'essay';
        if (!q.points || q.points === 2.0) q.points = 4.0;
      } else {
        q.type = 'mcq';
        // Pastikan opsi terurut A, B, C, D, E jika ada
        q.options.sort((a, b) => a.key.localeCompare(b.key));
        // Jika kunci belum ditentukan, gunakan kunci terpisah jika ada, atau default ke 'A'
        if (!q.correct) {
          if (separateKeysMap && separateKeysMap[q.qNumber]) {
            q.correct = separateKeysMap[q.qNumber];
          } else {
            q.correct = 'A';
            q.needsKeyReview = true;
          }
        }
      }
    },

    // Ringkasan hasil parsing
    summarizeResults(questions) {
      const babCounts = {};
      const warnings = [];

      questions.forEach((q, idx) => {
        const b = q.bab || 'BAB 1';
        babCounts[b] = (babCounts[b] || 0) + 1;

        if (q.type === 'mcq') {
          if (q.options.length < 2) {
            warnings.push(`Soal #${idx + 1}: Hanya memiliki ${q.options.length} opsi jawaban.`);
          }
          if (q.needsKeyReview) {
            warnings.push(`Soal #${idx + 1}: Kunci jawaban otomatis diatur ke 'A' (perlu verifikasi).`);
          }
        }
      });

      return {
        questions: questions,
        babCounts: babCounts,
        total: questions.length,
        warnings: warnings
      };
    },

    // Unduh Panduan & Contoh Format Dokumen Soal Word
    downloadSampleTextFile() {
      const sample = `CONTOH FORMAT DOKUMEN SOAL UJIAN SEJARAH INDONESIA
SMK PGRI 11 CILEDUG KOTA TANGERANG
==================================================

BAB 1: Kependudukan Jepang di Indonesia
1. Salah satu organisasi semi militer bentukan pemerintah pendudukan Jepang yang beranggotakan para pemuda berusia 14-22 tahun adalah...
A. Heiho
B. Seinendan
C. Keibodan
D. PETA
E. Barisan Pelopor
Kunci: B
Bobot: 2.0

2. Dampak positif diterapkannya kebijakan bahasa pada masa pendudukan Jepang bagi bangsa Indonesia adalah...
A. Bahasa Belanda menjadi bahasa utama pemerintahan
B. Bahasa Indonesia diizinkan sebagai bahasa pengantar di sekolah dan pergaulan resmi
C. Bahasa Jepang wajib digunakan dalam seluruh upacara adat daerah
D. Bahasa Sanskerta dihidupkan kembali dalam naskah dinas
E. Bahasa Inggris dilarang dipelajari secara mutlak
Kunci: B
Bobot: 2.0

3. Jelaskan tujuan utama pendudukan militer Jepang di Indonesia pada tahun 1942 serta dampaknya terhadap sistem ekonomi rakyat!
[Esai]
Kata Kunci: eksploitasi sumber daya, minyak bumi, romusha, logistik perang, kemiskinan
Bobot: 4.0

BAB 2: Proklamasi Kemerdekaan Indonesia
4. Makna utama dari Peristiwa Rengasdengklok yang terjadi pada tanggal 16 Agustus 1945 adalah...
A. Menghindarkan Soekarno-Hatta dari pengaruh militer Jepang agar segera memproklamasikan kemerdekaan
B. Menunggu izin resmi dari Marsekal Terauchi di Saigon
C. Melakukan penyerangan mendadak terhadap markas tentara Sekutu
D. Mempersiapkan sidang rancangan undang-undang dasar di gedung Chuo Sangi In
E. Menyembunyikan naskah otentik proklamasi di luar Jakarta
Kunci: A
Bobot: 2.0

5. Naskah teks Proklamasi Kemerdekaan Indonesia yang dibacakan oleh Ir. Soekarno diketik dengan perubahan ejaan oleh...
A. Sukarni Kartodiwirjo
B. Sayuti Melik
C. Chaerul Saleh
D. B.M. Diah
E. Radjiman Wedyodiningrat
Kunci: B
Bobot: 2.0

BAB 3: Mempertahankan Kemerdekaan Indonesia
6. Pertempuran heroik di Surabaya yang berpuncak pada tanggal 10 November 1945 dipicu oleh gugurnya pimpinan militer Inggris bernama...
A. Jenderal Sir Philip Christison
B. Brigadir Jenderal A.W.S. Mallaby
C. Letnan Jenderal Montagu Stopford
D. Mayor Jenderal E.C. Mansergh
E. Lord Killearn
Kunci: B
Bobot: 2.0
`;

      const blob = new Blob([sample], { type: 'text/plain;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'Format_Upload_Soal_CBT_Sejarah.txt';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    },

    // 5. KONVERTER SOAL KE WORD (.DOCX COMPATIBLE) & PDF (.PDF)
    // Menghasilkan dokumen Word berformat rapih sesuai standar Kop Surat SMK PGRI 11
    exportToWord(questionsList, filename = 'Bank_Soal_CBT_Sejarah_Indonesia.doc') {
      const questions = Array.isArray(questionsList) ? questionsList : [];
      if (questions.length === 0) {
        alert("Tidak ada soal untuk diekspor ke Word.");
        return;
      }

      // Grouping per BAB
      const babs = {};
      questions.forEach((q, idx) => {
        const b = q.bab || "BAB 1";
        if (!babs[b]) babs[b] = [];
        babs[b].push({ ...q, num: idx + 1 });
      });

      let questionsHtml = "";
      Object.keys(babs).sort().forEach(bKey => {
        const bQuestions = babs[bKey];
        questionsHtml += `
          <div style="margin-top: 25px; margin-bottom: 15px; border-bottom: 2px solid #00569E; padding-bottom: 5px;">
            <h2 style="color: #00569E; font-size: 14pt; margin: 0;">${bKey} - PAKET SOAL UJIAN SEJARAH</h2>
            <p style="font-size: 9pt; color: #555; margin: 2px 0 0 0; font-style: italic;">Total: ${bQuestions.length} Butir Soal • Terintegrasi Otomatis ke Sistem CBT</p>
          </div>
        `;

        bQuestions.forEach(q => {
          const isEssay = q.type === 'essay';
          let optionsBlock = "";
          if (!isEssay && q.options && q.options.length > 0) {
            optionsBlock = `<div style="margin-left: 20px; margin-top: 5px; margin-bottom: 6px;">`;
            q.options.forEach(opt => {
              const isCorrect = opt.key === q.correct;
              optionsBlock += `
                <div style="margin-bottom: 3px; ${isCorrect ? 'color: #047857; font-weight: bold;' : 'color: #333;'}">
                  ${opt.key}. ${opt.text} ${isCorrect ? '*(Kunci)' : ''}
                </div>
              `;
            });
            optionsBlock += `</div>`;
          }

          let metaBlock = `
            <div style="margin-left: 20px; font-size: 9pt; color: #666; margin-top: 4px; margin-bottom: 12px;">
              <span style="color: #059669; font-weight: bold;">Kunci: ${isEssay ? 'Rubrik AI' : (q.correct || 'A')}</span>
              &nbsp;&nbsp;|&nbsp;&nbsp;
              <span style="color: #D97706; font-weight: bold;">Bobot: ${q.points || 2.0} Poin</span>
              ${isEssay && q.aiKeywords ? `&nbsp;&nbsp;|&nbsp;&nbsp;<span style="color: #7C3AED; font-weight: bold;">Kata Kunci AI:</span> <em>${q.aiKeywords.join(', ')}</em>` : ''}
            </div>
          `;

          questionsHtml += `
            <div style="margin-bottom: 14px; page-break-inside: avoid;">
              <p style="margin: 0; font-size: 10.5pt; color: #111;">
                <strong>${q.num}.</strong> ${q.text} ${isEssay ? '<strong style="color: #7C3AED;">[Esai]</strong>' : ''}
              </p>
              ${optionsBlock}
              ${metaBlock}
            </div>
          `;
        });
      });

      // Tabel Rekapitulasi Kunci di Akhir Dokumen
      let rekapTable = `
        <div style="margin-top: 35px; page-break-before: always;">
          <h3 style="text-align: center; color: #00569E; font-size: 12pt; margin-bottom: 10px;">REKAPITULASI KUNCI JAWABAN & BOBOT PENILAIAN CBT</h3>
          <table border="1" cellpadding="6" cellspacing="0" style="width: 100%; border-collapse: collapse; font-size: 9pt; text-align: left; border-color: #CBD5E1;">
            <tr style="background-color: #F1F5F9; font-weight: bold; color: #1E293B;">
              <th style="width: 40px; text-align: center;">No</th>
              <th style="width: 80px;">BAB</th>
              <th style="width: 100px;">Tipe</th>
              <th>Kunci Jawaban / Kata Kunci AI</th>
              <th style="width: 70px; text-align: center;">Bobot</th>
            </tr>
      `;

      questions.forEach((q, idx) => {
        const isEssay = q.type === 'essay';
        rekapTable += `
          <tr>
            <td style="text-align: center;">${idx + 1}</td>
            <td>${q.bab || 'BAB 1'}</td>
            <td>${isEssay ? 'Esai HOTS' : 'Pilihan Ganda'}</td>
            <td>${isEssay ? (q.aiKeywords ? q.aiKeywords.slice(0, 4).join(', ') : 'Rubrik Evaluasi') : (q.correct || 'A')}</td>
            <td style="text-align: center;">${q.points || 2.0}</td>
          </tr>
        `;
      });
      rekapTable += `</table></div>`;

      const fullWordHtml = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head>
          <meta charset='utf-8'>
          <title>${filename}</title>
          <style>
            @page { margin: 2cm 2cm 2cm 2cm; size: A4; }
            body { font-family: 'Times New Roman', serif; font-size: 11pt; line-height: 1.4; color: #1E293B; }
            h1, h2, h3 { font-family: 'Arial', sans-serif; }
          </style>
        </head>
        <body>
          <!-- KOP SURAT FORMAL -->
          <div style="text-align: center; border-bottom: 3px double #00569E; padding-bottom: 10px; margin-bottom: 20px;">
            <p style="font-size: 10pt; font-weight: bold; margin: 0; color: #1E293B;">YAYASAN PEMBINA LEMBAGA PENDIDIKAN PGRI</p>
            <h1 style="font-size: 15pt; font-weight: bold; margin: 2px 0; color: #00569E;">SMK PGRI 11 CILEDUG KOTA TANGERANG</h1>
            <p style="font-size: 8.5pt; color: #555; margin: 0;">Jl. Raden Fatah No. 19, Ciledug, Kota Tangerang • Telp: (021) 7309999 • cbt.smkpgri11.sch.id</p>
          </div>

          <div style="text-align: center; margin-bottom: 25px;">
            <h2 style="font-size: 12.5pt; margin: 0; text-decoration: underline; color: #0F172A;">DOKUMEN MASTER BANK SOAL CBT SEJARAH INDONESIA</h2>
            <p style="font-size: 9.5pt; color: #475569; margin: 3px 0 0 0;">Fase F (Kelas XI/XII) • Guru Pengampu: Yoga Rahmanda, S.Pd • Terintegrasi Sistem CBT</p>
          </div>

          ${questionsHtml}
          ${rekapTable}
        </body>
        </html>
      `;

      const blob = new Blob(['\ufeff', fullWordHtml], {
        type: 'application/msword;charset=utf-8'
      });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename.endsWith('.doc') || filename.endsWith('.docx') ? filename : `${filename}.doc`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    },

    // Ekspor atau Cetak ke Format PDF dengan Tampilan Resmi
    exportToPdf(questionsList, title = 'Dokumen Master Bank Soal CBT Sejarah') {
      const questions = Array.isArray(questionsList) ? questionsList : [];
      if (questions.length === 0) {
        alert("Tidak ada soal untuk dicetak ke PDF.");
        return;
      }

      // Buka jendela cetak yang diformat khusus untuk PDF
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert("Harap izinkan pop-up peramban untuk mencetak/mengunduh PDF.");
        return;
      }

      // Grouping per BAB
      const babs = {};
      questions.forEach((q, idx) => {
        const b = q.bab || "BAB 1";
        if (!babs[b]) babs[b] = [];
        babs[b].push({ ...q, num: idx + 1 });
      });

      let questionsHtml = "";
      Object.keys(babs).sort().forEach(bKey => {
        const bQuestions = babs[bKey];
        questionsHtml += `
          <div class="bab-header">
            <h3>${bKey}: PAKET SOAL UJIAN CBT SEJARAH INDONESIA</h3>
            <span class="bab-meta">${bQuestions.length} Butir Soal Terkonfigurasi</span>
          </div>
        `;

        bQuestions.forEach(q => {
          const isEssay = q.type === 'essay';
          let optionsBlock = "";
          if (!isEssay && q.options && q.options.length > 0) {
            optionsBlock = `<div class="options-box">`;
            q.options.forEach(opt => {
              const isCorrect = opt.key === q.correct;
              optionsBlock += `
                <div class="option-item ${isCorrect ? 'correct-option' : ''}">
                  <span class="opt-key">${opt.key}.</span> ${opt.text} ${isCorrect ? '<strong style="color: #059669;">✔ (Kunci)</strong>' : ''}
                </div>
              `;
            });
            optionsBlock += `</div>`;
          }

          questionsHtml += `
            <div class="question-card">
              <p class="question-text">
                <span class="q-num">${q.num}.</span> ${q.text}
                ${isEssay ? '<span class="badge-essay">[Esai Analisis HOTS]</span>' : ''}
              </p>
              ${optionsBlock}
              <div class="q-meta">
                <span class="kunci-tag">Kunci: <strong>${isEssay ? 'Rubrik Evaluasi AI' : (q.correct || 'A')}</strong></span>
                <span class="bobot-tag">Bobot: <strong>${q.points || 2.0} Poin</strong></span>
                ${isEssay && q.aiKeywords ? `<span class="kw-tag">Kata Kunci AI: <em>${q.aiKeywords.join(', ')}</em></span>` : ''}
              </div>
            </div>
          `;
        });
      });

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${title} - SMK PGRI 11 CILEDUG</title>
          <meta charset="utf-8">
          <style>
            @page { size: A4; margin: 15mm 15mm 15mm 15mm; }
            body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; line-height: 1.45; color: #1E293B; margin: 0; padding: 15px; }
            .kop { text-align: center; border-bottom: 2.5px solid #00569E; padding-bottom: 8px; margin-bottom: 15px; }
            .kop h1 { color: #00569E; font-size: 14pt; margin: 2px 0; }
            .kop p { font-size: 8pt; color: #64748B; margin: 1px 0; }
            .doc-title { text-align: center; margin-bottom: 18px; }
            .doc-title h2 { font-size: 11.5pt; margin: 0; color: #0F172A; text-transform: uppercase; }
            .doc-title p { font-size: 8.5pt; color: #475569; margin: 2px 0; }
            .bab-header { background: #F0F9FF; border-left: 4px solid #0072C6; padding: 6px 12px; margin: 18px 0 10px 0; display: flex; justify-content: space-between; align-items: center; }
            .bab-header h3 { margin: 0; font-size: 10pt; color: #00569E; }
            .bab-meta { font-size: 8pt; color: #64748B; font-weight: bold; }
            .question-card { margin-bottom: 12px; page-break-inside: avoid; }
            .question-text { margin: 0 0 4px 0; font-size: 9.5pt; }
            .q-num { font-weight: bold; color: #00569E; }
            .options-box { margin-left: 18px; margin-bottom: 4px; }
            .option-item { font-size: 9pt; margin-bottom: 2px; color: #334155; }
            .correct-option { color: #047857; font-weight: bold; background: #ECFDF5; padding: 1px 4px; border-radius: 4px; display: inline-block; }
            .opt-key { font-weight: bold; margin-right: 4px; }
            .q-meta { margin-left: 18px; font-size: 8pt; color: #64748B; margin-top: 3px; }
            .kunci-tag { color: #047857; margin-right: 12px; }
            .bobot-tag { color: #D97706; margin-right: 12px; }
            .kw-tag { color: #7C3AED; }
            .badge-essay { background: #F3E8FF; color: #7C3AED; font-weight: bold; font-size: 8pt; padding: 1px 6px; border-radius: 4px; margin-left: 6px; }
            @media print {
              body { padding: 0; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="no-print" style="background: #0072C6; color: white; padding: 10px 20px; border-radius: 8px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center;">
            <span><strong>Pratinjau Cetak / Ekspor PDF CBT Sejarah</strong> • Total ${questions.length} Butir Soal</span>
            <button onclick="window.print()" style="background: #FFAE00; border: none; padding: 8px 16px; color: #0F172A; font-weight: bold; border-radius: 6px; cursor: pointer;">
              🖨️ Cetak / Simpan ke PDF Sekarang
            </button>
          </div>

          <div class="kop">
            <p style="font-weight: bold; letter-spacing: 1px;">YAYASAN PEMBINA LEMBAGA PENDIDIKAN PGRI</p>
            <h1>SMK PGRI 11 CILEDUG KOTA TANGERANG</h1>
            <p>Jl. Raden Fatah No. 19, Ciledug, Kota Tangerang • Telp: (021) 7309999 • cbt.smkpgri11.sch.id</p>
          </div>

          <div class="doc-title">
            <h2>DOKUMEN RESMI BANK SOAL UJIAN CBT SEJARAH INDONESIA</h2>
            <p>Fase F (Kelas XI/XII) • Guru Pengampu: Yoga Rahmanda, S.Pd • Seluruh BAB (1 - 6)</p>
          </div>

          ${questionsHtml}

          <script>
            // Jalankan otomatis dialog cetak PDF setelah render
            setTimeout(() => { window.print(); }, 400);
          </script>
        </body>
        </html>
      `);
      printWindow.document.close();
    },

    // Konversi teks JSON atau CSV mentah langsung ke Word atau PDF
    convertJsonCsv(rawText, outputFormat = 'word') {
      const parsedResult = this.parseQuestions(rawText, 'AUTO');
      if (!parsedResult.questions || parsedResult.questions.length === 0) {
        alert("Gagal mengurai teks JSON atau CSV. Pastikan format teks valid.");
        return;
      }

      if (outputFormat === 'word') {
        this.exportToWord(parsedResult.questions, 'Bank_Soal_Hasil_Konversi_CBT.doc');
      } else {
        this.exportToPdf(parsedResult.questions, 'Bank Soal Hasil Konversi CBT Sejarah');
      }
    },

    // 50 Soal Default Master Kurikulum Sejarah Indonesia SMK PGRI 11
    defaultQuestions: [
  {
    "id": 1,
    "bab": "BAB 1",
    "type": "mcq",
    "text": "Tujuan pokok pemerintah pendudukan militer Jepang membentuk organisasi Pembela Tanah Air (PETA) pada tahun 1943 adalah...",
    "options": [
      {
        "key": "A",
        "text": "Mempersiapkan kemerdekaan bangsa Indonesia secara mandiri dan bertahap"
      },
      {
        "key": "B",
        "text": "Mendapatkan bantuan tentara pribumi guna mempertahankan kepulauan Indonesia dari serangan tentara Sekutu"
      },
      {
        "key": "C",
        "text": "Membubarkan seluruh organisasi kepemudaan yang beraliran nasionalis dan keagamaan"
      },
      {
        "key": "D",
        "text": "Menggantikan posisi tentara KNIL Belanda dalam birokrasi pemerintahan sipil daerah"
      },
      {
        "key": "E",
        "text": "Menyerang pangkalan militer Sekutu yang berada di wilayah Pasifik Barat"
      }
    ],
    "correct": "B",
    "points": 2
  },
  {
    "id": 2,
    "bab": "BAB 1",
    "type": "mcq",
    "text": "Salah satu dampak sosial-ekonomi paling memilukan yang dialami rakyat Indonesia pada masa pendudukan Jepang akibat pengerahan tenaga kerja paksa adalah...",
    "options": [
      {
        "key": "A",
        "text": "Diterapkannya sistem sewa tanah (Landrent System) di seluruh perkebunan swasta"
      },
      {
        "key": "B",
        "text": "Kewajiban Romusha yang mengakibatkan kelaparan massal, kemiskinan ekstrem, dan tingginya angka mortalitas rakyat"
      },
      {
        "key": "C",
        "text": "Pelaksanaan kebijakan tanam paksa (Cultuurstelsel) khusus tanaman tebu dan tembakau"
      },
      {
        "key": "D",
        "text": "Dihapuskannya mata uang gulden dan diganti langsung dengan mata uang Poundsterling Inggris"
      },
      {
        "key": "E",
        "text": "Kewajiban penyerahan rempah-rempah kepada serikat dagang VOC"
      }
    ],
    "correct": "B",
    "points": 2
  },
  {
    "id": 3,
    "bab": "BAB 1",
    "type": "mcq",
    "text": "Kebijakan Seikerei yang diwajibkan oleh tentara pendudukan Jepang dan memicu perlawanan rakyat di Singaparna Tasikmalaya dipimpin KH Zaenal Mustafa adalah kewajiban untuk...",
    "options": [
      {
        "key": "A",
        "text": "Menyerahkan seluruh hasil panen padi kepada Koperasi Pertanian Kumiai"
      },
      {
        "key": "B",
        "text": "Membungkuk 90 derajat ke arah matahari terbit (Tokyo) sebagai wujud penghormatan kepada Kaisar Tenno Heika"
      },
      {
        "key": "C",
        "text": "Menggunakan bahasa Jepang sebagai satu-satunya bahasa percakapan sehari-hari"
      },
      {
        "key": "D",
        "text": "Mengikuti wajib militer bagi seluruh pemuda usia di atas 15 tahun tanpa terkecuali"
      },
      {
        "key": "E",
        "text": "Menyanyikan lagu kebangsaan Kimigayo pada setiap awal ibadah keagamaan"
      }
    ],
    "correct": "B",
    "points": 2
  },
  {
    "id": 4,
    "bab": "BAB 1",
    "type": "mcq",
    "text": "Organisasi semi-militer bentukan Jepang yang beranggotakan para pemuda berusia 14 hingga 22 tahun dengan tujuan mempersiapkan pertahanan baris belakang adalah...",
    "options": [
      {
        "key": "A",
        "text": "Seinendan (Barisan Pemuda)"
      },
      {
        "key": "B",
        "text": "Keibodan (Barisan Pembantu Polisi)"
      },
      {
        "key": "C",
        "text": "Fujinkai (Barisan Wanita)"
      },
      {
        "key": "D",
        "text": "Heiho (Barisan Pembantu Prajurit Militer)"
      },
      {
        "key": "E",
        "text": "Gakukotai (Laskar Pelajar)"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 5,
    "bab": "BAB 1",
    "type": "mcq",
    "text": "Janji Koiso yang diumumkan oleh Perdana Menteri Kuniaki Koiso pada 7 September 1944 bertujuan politis untuk...",
    "options": [
      {
        "key": "A",
        "text": "Menarik simpati dan dukungan rakyat Indonesia agar bersedia membantu Jepang dalam Perang Pasifik"
      },
      {
        "key": "B",
        "text": "Membubarkan badan persiapan kemerdekaan BPUPKI secara sepihak"
      },
      {
        "key": "C",
        "text": "Menyerahkan kekuasaan Hindia Belanda kepada Sekutu secara damai"
      },
      {
        "key": "D",
        "text": "Membentuk uni persemakmuran antara Indonesia dan Kekaisaran Jepang"
      },
      {
        "key": "E",
        "text": "Menghapuskan sistem mata uang militer Jepang (Gunpyo) di Indonesia"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 6,
    "bab": "BAB 1",
    "type": "mcq",
    "text": "Kebijakan autarki ekonomi yang diberlakukan oleh pemerintah militer Jepang di Indonesia mewajibkan setiap daerah untuk...",
    "options": [
      {
        "key": "A",
        "text": "Memenuhi kebutuhan pangan dan logistik perang secara mandiri tanpa bergantung pada daerah lain"
      },
      {
        "key": "B",
        "text": "Menjual seluruh hasil komoditas tambang kepada pedagang swasta Eropa"
      },
      {
        "key": "C",
        "text": "Mengimpor beras dan gandum dari wilayah pendudukan di Burma dan Filipina"
      },
      {
        "key": "D",
        "text": "Membuka pasar bebas bagi produk manufaktur buatan Amerika Serikat"
      },
      {
        "key": "E",
        "text": "Menghentikan seluruh aktivitas perikanan dan pertanian rakyat di pesisir"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 7,
    "bab": "BAB 1",
    "type": "short_essay",
    "text": "Sebutkan nama tokoh perwira PETA berpangkat Shodancho yang memimpin pemberontakan bersenjata melawan tentara Jepang di Blitar pada 14 Februari 1945!",
    "aiKeywords": [
      "Supriyadi",
      "Shodancho Supriyadi",
      "Soeprijadi"
    ],
    "rubric": "Menyebutkan tokoh Shodancho Supriyadi dengan tepat.",
    "points": 2
  },
  {
    "id": 8,
    "bab": "BAB 1",
    "type": "essay",
    "text": "Analislah bagaimana para tokoh pergerakan nasional (seperti Sukarno dan Moh. Hatta) memanfaatkan taktik kooperasi melalui organisasi bentukan Jepang (seperti Putera dan Jawa Hokokai) demi mempersiapkan kemerdekaan Indonesia!",
    "aiKeywords": [
      "taktik kooperasi",
      "Putera",
      "Jawa Hokokai",
      "Sukarno",
      "Hatta",
      "menanamkan nasionalisme",
      "BPUPKI",
      "rapat akbar",
      "cikal bakal TNI"
    ],
    "rubric": "Menjelaskan pemanfaatan fasilitas podium rapat akbar dan media cetak Jepang untuk menyebarkan paham kebangsaan serta menyusun fondasi konstitusi melalui BPUPKI.",
    "points": 4
  },
  {
    "id": 9,
    "bab": "BAB 2",
    "type": "mcq",
    "text": "Faktor krusial yang memicu terjadinya kekosongan kekuasaan (vacuum of power) di Indonesia pada pertengahan Agustus 1945 adalah...",
    "options": [
      {
        "key": "A",
        "text": "Jepang menyerah tanpa syarat kepada Sekutu setelah peristiwa bom atom Hiroshima dan Nagasaki"
      },
      {
        "key": "B",
        "text": "Pasukan Sekutu telah mendarat serentak di seluruh pelabuhan utama pulau Jawa"
      },
      {
        "key": "C",
        "text": "Pemerintah kolonial Belanda menyatakan pembatalan klaim atas wilayah Hindia Belanda"
      },
      {
        "key": "D",
        "text": "Seluruh pimpinan militer Jepang di Batavia melarikan diri ke Australia"
      },
      {
        "key": "E",
        "text": "Terjadinya gencatan senjata antara Uni Soviet dan Kekaisaran Jepang di Manchuria"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 10,
    "bab": "BAB 2",
    "type": "mcq",
    "text": "Peristiwa Rengasdengklok pada tanggal 16 Agustus 1945 didorong oleh perbedaan pandangan mendasar antara golongan muda dan golongan tua mengenai...",
    "options": [
      {
        "key": "A",
        "text": "Waktu dan mekanisme proklamasi yang harus dilakukan murni kekuatan sendiri tanpa campur tangan dan izin PPKI/Jepang"
      },
      {
        "key": "B",
        "text": "Penentuan calon menteri kabinet pertama Republik Indonesia"
      },
      {
        "key": "C",
        "text": "Lokasi pembacaan naskah proklamasi kemerdekaan antara Lapangan Ikada atau Pegangsaan Timur"
      },
      {
        "key": "D",
        "text": "Pemilihan bahasa asing yang akan digunakan dalam siaran radio naskah proklamasi"
      },
      {
        "key": "E",
        "text": "Perdebatan lambang Garuda Pancasila dan bentuk negara federasi"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 11,
    "bab": "BAB 2",
    "type": "mcq",
    "text": "Alasan dipilihnya kediaman Laksamana Tadashi Maeda di Jalan Imam Bonjol No. 1 Jakarta sebagai lokasi perumusan teks Proklamasi adalah...",
    "options": [
      {
        "key": "A",
        "text": "Memiliki hak imunitas ekstra-teritorial perwira Angkatan Laut (Kaigun) yang aman dari intervensi Angkatan Darat Jepang (Rikugun)"
      },
      {
        "key": "B",
        "text": "Merupakan markas utama barisan pemuda laskar pejuang Menteng 31"
      },
      {
        "key": "C",
        "text": "Berdekatan langsung dengan stasiun pemancar radio pusat Hoso Kanrikyoku"
      },
      {
        "key": "D",
        "text": "Telah mendapatkan izin tertulis resmi dari Panglima Tertinggi Tentara Sekutu di Asia Tenggara"
      },
      {
        "key": "E",
        "text": "Menjadi kantor resmi Badan Penyelidik Usaha-Usaha Persiapan Kemerdekaan (BPUPKI)"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 12,
    "bab": "BAB 2",
    "type": "mcq",
    "text": "Hasil keputusan fundamental dalam Sidang Pertama PPKI pada tanggal 18 Agustus 1945 adalah...",
    "options": [
      {
        "key": "A",
        "text": "Mengesahkan UUD 1945 serta menetapkan Ir. Soekarno sebagai Presiden dan Drs. Moh. Hatta sebagai Wakil Presiden"
      },
      {
        "key": "B",
        "text": "Membagi wilayah Indonesia menjadi 8 provinsi dan menunjuk para gubernurnya"
      },
      {
        "key": "C",
        "text": "Membentuk Badan Keamanan Rakyat (BKR) sebagai angkatan bersenjata resmi negara"
      },
      {
        "key": "D",
        "text": "Membentuk 12 kementerian departemen pemerintahan kabinet pertama"
      },
      {
        "key": "E",
        "text": "Menetapkan mata uang resmi Oeang Republik Indonesia (ORI) menggantikan rupiah Jepang"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 13,
    "bab": "BAB 2",
    "type": "mcq",
    "text": "Tokoh pemuda yang mengusulkan agar naskah Proklamasi Kemerdekaan ditandatangani oleh Sukarno dan Moh. Hatta atas nama bangsa Indonesia adalah...",
    "options": [
      {
        "key": "A",
        "text": "Sukarni Kartodiwirjo"
      },
      {
        "key": "B",
        "text": "Sayuti Melik"
      },
      {
        "key": "C",
        "text": "Wikana"
      },
      {
        "key": "D",
        "text": "Chairul Saleh"
      },
      {
        "key": "E",
        "text": "BM Diah"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 14,
    "bab": "BAB 2",
    "type": "mcq",
    "text": "Peran wartawan BM Diah setelah pembacaan teks Proklamasi 17 Agustus 1945 sangat penting karena bertugas...",
    "options": [
      {
        "key": "A",
        "text": "Menyebarluaskan berita proklamasi kemerdekaan melalui percetakan selebaran pamflet dan surat kabar ke seluruh pelosok"
      },
      {
        "key": "B",
        "text": "Mengetik naskah proklamasi yang telah disetujui para tokoh bangsa"
      },
      {
        "key": "C",
        "text": "Mengamankan bendera merah putih dari sitaan tentara Jepang"
      },
      {
        "key": "D",
        "text": "Menjaga keamanan fisik Bung Karno di kediaman Pegangsaan Timur"
      },
      {
        "key": "E",
        "text": "Menjadi penerjemah teks kemerdekaan ke dalam bahasa Inggris di radio Sekutu"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 15,
    "bab": "BAB 2",
    "type": "short_essay",
    "text": "Sebutkan nama tokoh yang mengetik naskah otentik Proklamasi Kemerdekaan Indonesia dan mengubah kata 'tempoh' menjadi 'tempo'!",
    "aiKeywords": [
      "Sayuti Melik",
      "Mohamad Ibnu Sayuti",
      "Ibnu Sayuti"
    ],
    "rubric": "Menyebutkan nama Sayuti Melik dengan tepat.",
    "points": 2
  },
  {
    "id": 16,
    "bab": "BAB 2",
    "type": "essay",
    "text": "Uraikan makna kalimat pertama teks Proklamasi: 'Kami bangsa Indonesia dengan ini menyatakan kemerdekaan Indonesia' ditinjau dari aspek kedaulatan de facto dan pemutusan ikatan kolonialisme!",
    "aiKeywords": [
      "pernyataan kemerdekaan",
      "kedaulatan de facto",
      "pemutusan ikatan kolonial",
      "kehendak bebas rakyat",
      "hukum internasional",
      "proklamasi kemerdekaan"
    ],
    "rubric": "Menjelaskan bahwa proklamasi merupakan deklarasi kedaulatan mutlak lahirnya negara baru yang berdiri sejajar dengan bangsa merdeka lain di dunia.",
    "points": 4
  },
  {
    "id": 17,
    "bab": "BAB 3",
    "type": "mcq",
    "text": "Penyebab utama meletusnya pertempuran dahsyat 10 November 1945 di Surabaya antara pemuda Arek Suroboyo melawan tentara Sekutu (Inggris) adalah...",
    "options": [
      {
        "key": "A",
        "text": "Tewasnya Brigadir Jenderal A.W.S. Mallaby dan penolakan terhadap ultimatum Sekutu agar rakyat Surabaya menyerahkan senjata"
      },
      {
        "key": "B",
        "text": "Penyerahan pangkalan armada laut Ujung Surabaya kepada pihak NICA Belanda"
      },
      {
        "key": "C",
        "text": "Penolakan penetapan garis demarkasi van Mook oleh pejuang Jawa Timur"
      },
      {
        "key": "D",
        "text": "Penangkapan Gubernur Suryo oleh tentara Gurkha Sekutu"
      },
      {
        "key": "E",
        "text": "Pengibaran bendera Uni Soviet di atas Hotel Yamato Surabaya"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 18,
    "bab": "BAB 3",
    "type": "mcq",
    "text": "Doktrin militer 'bumi hangus' yang dilakukan para pejuang dalam peristiwa Bandung Lautan Api 24 Maret 1946 bertujuan taktis untuk...",
    "options": [
      {
        "key": "A",
        "text": "Mencegah tentara Sekutu dan NICA memanfaatkan sarana infrastruktur kota Bandung sebagai markas militer strategis"
      },
      {
        "key": "B",
        "text": "Mengalihkan perhatian pasukan Sekutu dari wilayah Yogyakarta ke Jawa Barat"
      },
      {
        "key": "C",
        "text": "Menghancurkan seluruh gudang senjata tentara Jepang yang berada di pedalaman"
      },
      {
        "key": "D",
        "text": "Mematuhi instruksi gencatan senjata tanpa syarat dari pemerintah pusat RIS"
      },
      {
        "key": "E",
        "text": "Mempercepat evakuasi pejabat kementerian menuju wilayah Cirebon"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 19,
    "bab": "BAB 3",
    "type": "mcq",
    "text": "Hasil kesepakatan Perundingan Linggarjati tahun 1947 menyatakan bahwa Belanda hanya mengakui wilayah kekuasaan de facto RI meliputi...",
    "options": [
      {
        "key": "A",
        "text": "Jawa, Sumatera, dan Madura"
      },
      {
        "key": "B",
        "text": "Seluruh wilayah bekas Hindia Belanda dari Sabang sampai Merauke"
      },
      {
        "key": "C",
        "text": "Jawa, Bali, dan Nusa Tenggara Barat"
      },
      {
        "key": "D",
        "text": "Sumatera, Kalimantan, dan Sulawesi"
      },
      {
        "key": "E",
        "text": "Wilayah Republik Indonesia Serikat (RIS) bagian timur semata"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 20,
    "bab": "BAB 3",
    "type": "mcq",
    "text": "Dampak politis internasional paling krusial dari keberhasilan 'Serangan Umum 1 Maret 1949' di Yogyakarta adalah...",
    "options": [
      {
        "key": "A",
        "text": "Membuktikan kepada dunia internasional dan Dewan Keamanan PBB bahwa TNI dan eksistensi RI masih tegak berdaulat"
      },
      {
        "key": "B",
        "text": "Memukul mundur seluruh divisi militer Belanda dari kepulauan Nusantara secara permanen"
      },
      {
        "key": "C",
        "text": "Membebaskan Presiden Sukarno dan Moh. Hatta dari pengasingan di Pulau Bangka seketika itu juga"
      },
      {
        "key": "D",
        "text": "Mendapatkan kiriman armada pesawat tempur dari negara anggota Dewan Keamanan PBB"
      },
      {
        "key": "E",
        "text": "Membubarkan Pemerintahan Darurat Republik Indonesia (PDRI) di Bukittinggi"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 21,
    "bab": "BAB 3",
    "type": "mcq",
    "text": "Peran Mr. Sjafruddin Prawiranegara dalam dinamika mempertahankan kemerdekaan saat Agresi Militer Belanda II adalah...",
    "options": [
      {
        "key": "A",
        "text": "Memimpin Pemerintahan Darurat Republik Indonesia (PDRI) di Sumatera Barat guna menjaga kelangsungan kedaulatan negara"
      },
      {
        "key": "B",
        "text": "Menjadi ketua delegasi Indonesia dalam Konferensi Meja Bundar di Den Haag"
      },
      {
        "key": "C",
        "text": "Memimpin perang gerilya bersama Jenderal Sudirman di hutan rimba Jawa Tengah"
      },
      {
        "key": "D",
        "text": "Mendirikan Komisi Tiga Negara (KTN) bersama wakil dari Australia dan Belgia"
      },
      {
        "key": "E",
        "text": "Menandatangani Perjanjian Roem-Royen di Jakarta"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 22,
    "bab": "BAB 3",
    "type": "mcq",
    "text": "Salah satu keputusan fundamental Konferensi Meja Bundar (KMB) di Den Haag Belanda tahun 1949 adalah...",
    "options": [
      {
        "key": "A",
        "text": "Belanda menyerahkan dan mengakui kedaulatan penuh kepada Republik Indonesia Serikat (RIS)"
      },
      {
        "key": "B",
        "text": "Penyerahan langsung wilayah Irian Barat dalam tempo 24 jam tanpa perundingan lanjutan"
      },
      {
        "key": "C",
        "text": "Penggabungan seluruh tentara KNIL ke dalam kesatuan militer Kerajaan Belanda di Eropa"
      },
      {
        "key": "D",
        "text": "Penghapusan seluruh beban utang Hindia Belanda sejak tahun 1942"
      },
      {
        "key": "E",
        "text": "Pembentukan negara persemakmuran di bawah pimpinan Presiden Amerika Serikat"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 23,
    "bab": "BAB 3",
    "type": "short_essay",
    "text": "Sebutkan nama tokoh pejuang yang mengobarkan semangat perlawanan rakyat Surabaya lewat orasi Radio Pemberontakan pada peristiwa 10 November 1945!",
    "aiKeywords": [
      "Bung Tomo",
      "Sutomo"
    ],
    "rubric": "Menyebutkan nama Bung Tomo (Sutomo) dengan tepat.",
    "points": 2
  },
  {
    "id": 24,
    "bab": "BAB 3",
    "type": "essay",
    "text": "Bandingkan efektivitas strategi diplomasi perundingan (Linggarjati, Renville, KMB) dengan strategi perjuangan bersenjata dalam upaya mempertahankan kemerdekaan Indonesia kurun waktu 1945-1949!",
    "aiKeywords": [
      "perjuangan diplomasi",
      "perjuangan bersenjata",
      "saling melengkapi",
      "simpati internasional",
      "Dewan Keamanan PBB",
      "pengakuan de jure",
      "TNI"
    ],
    "rubric": "Menjelaskan sinergi saling melengkapi di mana perjuangan bersenjata membuktikan kekuatan de facto, sedangkan jalur diplomasi mengamankan pengakuan de jure dunia internasional.",
    "points": 4
  },
  {
    "id": 25,
    "bab": "BAB 4",
    "type": "mcq",
    "text": "Ciri utama sistem pemerintahan pada masa Demokrasi Parlementer / Liberal (1950–1959) di bawah landasan UUDS 1950 adalah...",
    "options": [
      {
        "key": "A",
        "text": "Pemerintahan dipimpin oleh seorang Perdana Menteri yang bertanggung jawab kepada parlemen (DPR)"
      },
      {
        "key": "B",
        "text": "Presiden memegang kekuasaan eksekutif absolut tanpa pengawasan parlemen"
      },
      {
        "key": "C",
        "text": "Sistem satu partai tunggal yang mengendalikan seluruh kebijakan daerah"
      },
      {
        "key": "D",
        "text": "Menteri diangkat dan hanya bertanggung jawab langsung kepada Presiden"
      },
      {
        "key": "E",
        "text": "Anggota parlemen ditunjuk langsung oleh Mahkamah Agung"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 26,
    "bab": "BAB 4",
    "type": "mcq",
    "text": "Kabinet pertama yang memerintah pada masa Demokrasi Liberal di Indonesia dan berlandaskan koalisi Masyumi-PNI adalah...",
    "options": [
      {
        "key": "A",
        "text": "Kabinet Natsir"
      },
      {
        "key": "B",
        "text": "Kabinet Sukiman"
      },
      {
        "key": "C",
        "text": "Kabinet Wilopo"
      },
      {
        "key": "D",
        "text": "Kabinet Ali Sastroamidjojo I"
      },
      {
        "key": "E",
        "text": "Kabinet Burhanuddin Harahap"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 27,
    "bab": "BAB 4",
    "type": "mcq",
    "text": "Prestasi diplomasi internasional terbesar bangsa Indonesia pada masa Kabinet Ali Sastroamidjojo I tahun 1955 adalah penyelenggaraan...",
    "options": [
      {
        "key": "A",
        "text": "Konferensi Asia Afrika (KAA) di Bandung yang melahirkan Dasasila Bandung"
      },
      {
        "key": "B",
        "text": "Pesta Olahraga Games of the New Emerging Forces (GANEFO)"
      },
      {
        "key": "C",
        "text": "Konferensi Tingkat Tinggi (KTT) Non-Blok pertama di Beograd"
      },
      {
        "key": "D",
        "text": "Pembentukan sekretariat bersama ASEAN di Jakarta"
      },
      {
        "key": "E",
        "text": "Perjanjian bantuan ekonomi Mutual Security Act dengan Amerika Serikat"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 28,
    "bab": "BAB 4",
    "type": "mcq",
    "text": "Faktor determinan yang melatarbelakangi Presiden Sukarno mengeluarkan Dekrit Presiden 5 Juli 1959 adalah...",
    "options": [
      {
        "key": "A",
        "text": "Kegagalan Badan Konstituante menetapkan UUD baru pengganti UUDS 1950 yang memicu ancaman disintegrasi bangsa"
      },
      {
        "key": "B",
        "text": "Terjadinya agresi militer asing di kepulauan Maluku"
      },
      {
        "key": "C",
        "text": "Pemutusan sepihak hubungan bilateral diplomatik dengan Uni Soviet"
      },
      {
        "key": "D",
        "text": "Tuntutan pembubaran parlemen oleh serikat buruh migran"
      },
      {
        "key": "E",
        "text": "Kekalahan telak partai nasionalis dalam pemilihan umum legislatif"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 29,
    "bab": "BAB 4",
    "type": "mcq",
    "text": "Pemilu demokratis pertama dalam sejarah Indonesia pada tahun 1955 dilaksanakan dalam dua tahap, yaitu untuk memilih...",
    "options": [
      {
        "key": "A",
        "text": "Anggota DPR (Parlemen) pada tahap I dan Anggota Dewan Konstituante pada tahap II"
      },
      {
        "key": "B",
        "text": "Presiden pada tahap I dan Wakil Presiden pada tahap II"
      },
      {
        "key": "C",
        "text": "Gubernur provinsi pada tahap I dan Bupati pada tahap II"
      },
      {
        "key": "D",
        "text": "Menteri kabinet pada tahap I dan Panglima militer pada tahap II"
      },
      {
        "key": "E",
        "text": "Anggota Mahkamah Agung pada tahap I dan Jaksa Agung pada tahap II"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 30,
    "bab": "BAB 4",
    "type": "mcq",
    "text": "Konsep ideologi politik 'Nasakom' yang diperkenalkan Presiden Sukarno pada era Demokrasi Terpimpin menggabungkan tiga pilar kekuatan, yaitu...",
    "options": [
      {
        "key": "A",
        "text": "Nasionalisme, Agama, dan Komunisme"
      },
      {
        "key": "B",
        "text": "Nasionalisme, Agraria, dan Koperasi"
      },
      {
        "key": "C",
        "text": "Negara, Angkatan Perang, dan Komando"
      },
      {
        "key": "D",
        "text": "Nusantara, Adat, dan Kemaritiman"
      },
      {
        "key": "E",
        "text": "Nasionalis, Sosialis, dan Demokratis"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 31,
    "bab": "BAB 4",
    "type": "short_essay",
    "text": "Sebutkan nama deklarasi wilayah maritim Indonesia yang dicetuskan pada 13 Desember 1957 yang menetapkan batas laut teritorial 12 mil laut diukur dari garis pantai pulau terluar!",
    "aiKeywords": [
      "Deklarasi Djuanda",
      "Djuanda",
      "Ir. Djuanda",
      "Deklarasi Juanda"
    ],
    "rubric": "Menyebutkan Deklarasi Djuanda dengan tepat.",
    "points": 2
  },
  {
    "id": 32,
    "bab": "BAB 4",
    "type": "essay",
    "text": "Analislah penyebab instabilitas politik dan seringnya pergantian kabinet pada masa Demokrasi Liberal (1950-1959) serta dampaknya terhadap keberlanjutan program pembangunan ekonomi nasional!",
    "aiKeywords": [
      "sistem multipartai",
      "mosi tidak percaya",
      "parlemen rapuh",
      "kabinet jatuh bangun",
      "kepentingan golongan",
      "program pembangunan terhambat",
      "UUDS 1950"
    ],
    "rubric": "Menguraikan sistem multipartai di mana partai oposisi kerap melayangkan mosi tidak percaya sehingga umur kabinet sangat pendek (rata-rata 1 tahun) dan program jangka panjang terbengkalai.",
    "points": 4
  },
  {
    "id": 33,
    "bab": "BAB 5",
    "type": "mcq",
    "text": "Dokumen bersejarah yang dikeluarkan pada 11 Maret 1966 dan menjadi landasan legal peralihan kekuasaan dari Orde Lama ke Orde Baru dikenal sebagai...",
    "options": [
      {
        "key": "A",
        "text": "Surat Perintah Sebelas Maret (Supersemar)"
      },
      {
        "key": "B",
        "text": "Dekrit Presiden 11 Maret"
      },
      {
        "key": "C",
        "text": "Maklumat Pemerintah No. X"
      },
      {
        "key": "D",
        "text": "Piagam Jakarta 1966"
      },
      {
        "key": "E",
        "text": "Manifesto Politik Republik Indonesia"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 34,
    "bab": "BAB 5",
    "type": "mcq",
    "text": "Pilar utama pembangunan ekonomi pada era Orde Baru yang dirumuskan dalam doktrin 'Trilogi Pembangunan' bertumpu pada...",
    "options": [
      {
        "key": "A",
        "text": "Stabilitas nasional yang dinamis, pertumbuhan ekonomi tinggi, dan pemerataan pembangunan beserta hasilnya"
      },
      {
        "key": "B",
        "text": "Nasionalisasi seluruh aset korporasi asing dan swastanisasi bank pemerintah"
      },
      {
        "key": "C",
        "text": "Penghapusan utang luar negeri secara sepihak dan swasembada industri berat"
      },
      {
        "key": "D",
        "text": "Pemberian hak veto mutlak kepada partai oposisi di parlemen"
      },
      {
        "key": "E",
        "text": "Pemberantasan monopoli perdagangan dan penutupan penanaman modal asing"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 35,
    "bab": "BAB 5",
    "type": "mcq",
    "text": "Prioritas utama program Rencana Pembangunan Lima Tahun (Repelita I) yang dimulai pada tahun 1969 difokuskan pada pemulihan sektor...",
    "options": [
      {
        "key": "A",
        "text": "Pertanian, pemenuhan pangan, sandang, dan perbaikan infrastruktur jalan"
      },
      {
        "key": "B",
        "text": "Industri perakitan otomotif dan penerbangan antariksa"
      },
      {
        "key": "C",
        "text": "Pengembangan teknologi komputer dan kecerdasan buatan"
      },
      {
        "key": "D",
        "text": "Eksplorasi nuklir dan persenjataan pertahanan berat"
      },
      {
        "key": "E",
        "text": "Sektor perbankan syariah dan bursa efek internasional"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 36,
    "bab": "BAB 5",
    "type": "mcq",
    "text": "Prestasi monumental sektor agraris Indonesia pada masa Orde Baru yang mendapatkan apresiasi penghargaan internasional dari FAO (PBB) pada tahun 1984 adalah...",
    "options": [
      {
        "key": "A",
        "text": "Pencapaian Swasembada Beras / Pangan Nasional"
      },
      {
        "key": "B",
        "text": "Pengekspor kelapa sawit terbesar di dunia"
      },
      {
        "key": "C",
        "text": "Penghasil kedelai organik nomor satu di Asia"
      },
      {
        "key": "D",
        "text": "Penggagas revolusi energi hijau terbarukan"
      },
      {
        "key": "E",
        "text": "Pengendali cadangan pupuk kimia regional ASEAN"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 37,
    "bab": "BAB 5",
    "type": "mcq",
    "text": "Kebijakan fusi partai politik pada tahun 1973 menyederhanakan kontestan pemilu di masa Orde Baru menjadi tiga entitas, yaitu...",
    "options": [
      {
        "key": "A",
        "text": "PPP (Partai Persatuan Pembangunan), PDI (Partai Demokrasi Indonesia), dan Golongan Karya (Golkar)"
      },
      {
        "key": "B",
        "text": "Masyumi, Nahdlatul Ulama, dan Partai Nasional Indonesia"
      },
      {
        "key": "C",
        "text": "Partai Demokrat, PDI Perjuangan, dan Partai Gerindra"
      },
      {
        "key": "D",
        "text": "Partai Buruh, Partai Sosialis, dan Partai Murba"
      },
      {
        "key": "E",
        "text": "PKB, PAN, dan Partai Nasdem"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 38,
    "bab": "BAB 5",
    "type": "mcq",
    "text": "Penerapan konsep 'Dwifungsi ABRI' secara masif pada masa Orde Baru menempatkan militer dalam dua peran sekaligus, yaitu...",
    "options": [
      {
        "key": "A",
        "text": "Sebagai garda pertahanan keamanan negara sekaligus kekuatan sosial-politik di birokrasi pemerintahan"
      },
      {
        "key": "B",
        "text": "Sebagai aparat kepolisian dan pengelola bursa efek nasional"
      },
      {
        "key": "C",
        "text": "Sebagai pengawas kurikulum pendidikan dan hakim peradilan sipil"
      },
      {
        "key": "D",
        "text": "Sebagai pasukan perdamaian PBB dan pengelola industri perbankan swasta"
      },
      {
        "key": "E",
        "text": "Sebagai duta diplomasi kebudayaan dan pengawas pers daerah"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 39,
    "bab": "BAB 5",
    "type": "mcq",
    "text": "Program kesehatan masyarakat dan pengendalian ledakan laju pertumbuhan penduduk yang berhasil dijalankan pada era Orde Baru adalah...",
    "options": [
      {
        "key": "A",
        "text": "Program Keluarga Berencana (KB) dengan slogan 'Dua Anak Cukup' dan Posyandu"
      },
      {
        "key": "B",
        "text": "Program Jaminan Kesehatan Nasional BPJS Mandiri"
      },
      {
        "key": "C",
        "text": "Program Wajib Militer Pelajar dan Transmigrasi Otomatis"
      },
      {
        "key": "D",
        "text": "Program Asuransi Tenaga Kerja Swasta Internasional"
      },
      {
        "key": "E",
        "text": "Program Imunisasi Terpadu Berbasis Digital"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 40,
    "bab": "BAB 5",
    "type": "mcq",
    "text": "Dampak negatif dominasi kekuasaan eksekutif dan sentralisasi pemerintahan yang berlebihan pada akhir masa Orde Baru adalah...",
    "options": [
      {
        "key": "A",
        "text": "Merajalelanya praktik Korupsi, Kolusi, dan Nepotisme (KKN) serta pembungkaman kebebasan pers"
      },
      {
        "key": "B",
        "text": "Rendahnya angka partisipasi pemilih dalam pemilihan umum legislatif"
      },
      {
        "key": "C",
        "text": "Terputusnya seluruh hubungan kerja sama ekonomi dengan negara-negara Barat"
      },
      {
        "key": "D",
        "text": "Terjadinya konflik perbatasan maritim dengan seluruh negara tetangga ASEAN"
      },
      {
        "key": "E",
        "text": "Penghapusan secara total anggaran belanja pendidikan nasional"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 41,
    "bab": "BAB 5",
    "type": "short_essay",
    "text": "Sebutkan nama lembaga logistik pemerintah yang dibentuk pada era Orde Baru untuk mengendalikan kestabilan harga beras dan sembako secara nasional!",
    "aiKeywords": [
      "Bulog",
      "Badan Urusan Logistik"
    ],
    "rubric": "Menyebutkan Bulog (Badan Urusan Logistik) dengan tepat.",
    "points": 2
  },
  {
    "id": 42,
    "bab": "BAB 6",
    "type": "mcq",
    "text": "Faktor ekonomi determinan yang memicu krisis multidimensi dan gelombang aksi demonstrasi mahasiswa menuntut Reformasi 1998 adalah...",
    "options": [
      {
        "key": "A",
        "text": "Krisis Moneter Asia yang mengakibatkan anjloknya nilai tukar Rupiah terhadap Dolar AS, inflasi tinggi, dan gelombang PHK massal"
      },
      {
        "key": "B",
        "text": "Kebijakan embargo perdagangan internasional dari negara-negara anggota PBB"
      },
      {
        "key": "C",
        "text": "Kegagalan total panen raya nasional akibat kemarau ekstrem El Nino"
      },
      {
        "key": "D",
        "text": "Ditariknya seluruh investasi tambang minyak dari negara-negara Timur Tengah"
      },
      {
        "key": "E",
        "text": "Kenaikan tarif pajak ekspor manufaktur tekstil secara mendadak"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 43,
    "bab": "BAB 6",
    "type": "mcq",
    "text": "Peristiwa bersejarah pengunduran diri Presiden Soeharto yang menandai berakhirnya era Orde Baru terjadi pada tanggal...",
    "options": [
      {
        "key": "A",
        "text": "21 Mei 1998 di Istana Merdeka Jakarta"
      },
      {
        "key": "B",
        "text": "12 Mei 1998 di Universitas Trisakti"
      },
      {
        "key": "C",
        "text": "17 Agustus 1998 di Gedung DPR/MPR"
      },
      {
        "key": "D",
        "text": "10 November 1998 di Tugu Pahlawan Surabaya"
      },
      {
        "key": "E",
        "text": "25 Desember 1998 di Markas Besar ABRI"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 44,
    "bab": "BAB 6",
    "type": "mcq",
    "text": "Agenda pokok '6 Tuntutan Reformasi' yang diperjuangkan oleh gerakan mahasiswa dan elemen masyarakat tahun 1998 meliputi...",
    "options": [
      {
        "key": "A",
        "text": "Adili Soeharto dan kroninya, amandemen UUD 1945, hapuskan Dwifungsi ABRI, tegakkan supremasi hukum, otonomi daerah, dan berantas KKN"
      },
      {
        "key": "B",
        "text": "Kembali ke UUD 1945 asli tanpa amandemen dan penutupan seluruh bank asing"
      },
      {
        "key": "C",
        "text": "Pembubaran dewan perwakilan rakyat dan pembentukan sistem monarki parlementer"
      },
      {
        "key": "D",
        "text": "Penerapan sistem pemilihan umum bertingkat dan penolakan bantuan pinjaman IMF"
      },
      {
        "key": "E",
        "text": "Pemisahan seluruh provinsi di luar pulau Jawa menjadi negara bagian merdeka"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 45,
    "bab": "BAB 6",
    "type": "mcq",
    "text": "Langkah terobosan demokratis yang diambil pada masa pemerintahan Presiden B.J. Habibie di bidang komunikasi dan informasi adalah...",
    "options": [
      {
        "key": "A",
        "text": "Membuka kebebasan pers seluas-luasnya melalui pencabutan Surat Izin Usaha Penerbitan Pers (SIUPP)"
      },
      {
        "key": "B",
        "text": "Mewajibkan seluruh kantor berita berafiliasi dengan stasiun televisi TVRI"
      },
      {
        "key": "C",
        "text": "Menutup akses internet dan jaringan telekomunikasi luar negeri"
      },
      {
        "key": "D",
        "text": "Menghapuskan Departemen Penerangan dan Kominfo secara mendadak"
      },
      {
        "key": "E",
        "text": "Memberlakukan sensor mutlak atas setiap artikel berita politik harian"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 46,
    "bab": "BAB 6",
    "type": "mcq",
    "text": "Salah satu perubahan mendasar dalam struktur ketatanegaraan Indonesia pasca amandemen UUD 1945 (1999–2002) adalah...",
    "options": [
      {
        "key": "A",
        "text": "Presiden dan Wakil Presiden dipilih langsung oleh rakyat serta pembatasan masa jabatan maksimal 2 periode (10 tahun)"
      },
      {
        "key": "B",
        "text": "Presiden memegang wewenang legislatif penuh tanpa persetujuan DPR RI"
      },
      {
        "key": "C",
        "text": "Penghapusan Mahkamah Konstitusi dan Komisi Yudisial"
      },
      {
        "key": "D",
        "text": "Pengangkatan anggota MPR seumur hidup dari unsur golongan karya"
      },
      {
        "key": "E",
        "text": "Peniadaan pemilihan kepala daerah dan penunjukan langsung oleh Presiden"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 47,
    "bab": "BAB 6",
    "type": "mcq",
    "text": "Lembaga penegak hukum independen yang dibentuk pada era Reformasi (tahun 2002) dengan kewenangan khusus memberantas tindak pidana korupsi adalah...",
    "options": [
      {
        "key": "A",
        "text": "Komisi Pemberantasan Korupsi (KPK)"
      },
      {
        "key": "B",
        "text": "Badan Pemeriksa Keuangan (BPK)"
      },
      {
        "key": "C",
        "text": "Pusat Pelaporan dan Analisis Transaksi Keuangan (PPATK)"
      },
      {
        "key": "D",
        "text": "Komisi Pengawas Persaingan Usaha (KPPU)"
      },
      {
        "key": "E",
        "text": "Komisi Kejaksaan Republik Indonesia"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 48,
    "bab": "BAB 6",
    "type": "mcq",
    "text": "Pemilihan Umum Presiden dan Wakil Presiden secara Langsung oleh rakyat untuk pertama kalinya dalam sejarah Indonesia diselenggarakan pada tahun...",
    "options": [
      {
        "key": "A",
        "text": "2004"
      },
      {
        "key": "B",
        "text": "1999"
      },
      {
        "key": "C",
        "text": "2009"
      },
      {
        "key": "D",
        "text": "2014"
      },
      {
        "key": "E",
        "text": "1997"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 49,
    "bab": "BAB 6",
    "type": "mcq",
    "text": "Penerapan kebijakan Otonomi Daerah melalui UU No. 22 Tahun 1999 bertujuan positif untuk...",
    "options": [
      {
        "key": "A",
        "text": "Memberikan wewenang kepada pemerintah daerah kabupaten/kota untuk mengatur potensi dan pembangunan daerahnya sendiri"
      },
      {
        "key": "B",
        "text": "Mengurangi kewajiban perpajakan pemerintah daerah kepada negara tetangga"
      },
      {
        "key": "C",
        "text": "Membentuk mata uang regional di masing-masing provinsi kepulauan"
      },
      {
        "key": "D",
        "text": "Menghapuskan sistem peradilan hukum nasional di tingkat daerah"
      },
      {
        "key": "E",
        "text": "Membagi kepulauan Indonesia menjadi negara persemakmuran mandiri"
      }
    ],
    "correct": "A",
    "points": 2
  },
  {
    "id": 50,
    "bab": "BAB 6",
    "type": "essay",
    "text": "Evaluasilah dampak positif dan tantangan pelaksanaan Pemilu Presiden Langsung serta Otonomi Daerah pada era Reformasi terhadap kematangan demokrasi di Indonesia!",
    "aiKeywords": [
      "pemilu langsung",
      "otonomi daerah",
      "partisipasi rakyat",
      "desentralisasi",
      "kedaulatan rakyat",
      "KPU",
      "tantangan politik dinasti",
      "transparansi"
    ],
    "rubric": "Menjelaskan sisi positif berupa kedaulatan mutlak di tangan pemilih dan pemerataan pembangunan daerah, serta mengkritisi tantangan berupa potensi politik uang (money politics) dan korupsi di tingkat lokal.",
    "points": 4
  }
],

    // Ambil daftar soal aktif dari localStorage / default
    getStoredQuestions() {
      try {
        const stored = localStorage.getItem('cbt_question_bank_v3');
        if (stored !== null) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch (e) {
        console.error("Error reading stored questions:", e);
      }
      const def = this.defaultQuestions || [];
      try {
        localStorage.setItem('cbt_question_bank_v3', JSON.stringify(def));
      } catch (e) {}
      return def;
    },

    // Simpan daftar soal ke localStorage dan Firebase (jika aktif)
    saveQuestions(questionsList) {
      try {
        localStorage.setItem('cbt_question_bank_v3', JSON.stringify(questionsList));
        if (window.CBT_DB && typeof window.CBT_DB.saveQuestions === 'function') {
          window.CBT_DB.saveQuestions(questionsList);
        }
        return true;
      } catch (e) {
        console.error("Error saving questions:", e);
        return false;
      }
    },

    // Penambahan Soal Batch / Massal
    batchAddQuestions(newQuestionsList, mode = 'append') {
      const current = this.getStoredQuestions();
      const sanitized = newQuestionsList.map((q, idx) => ({
        id: q.id || (Date.now() + idx + Math.floor(Math.random() * 1000)),
        bab: q.bab || 'BAB 1',
        type: q.type || 'mcq',
        text: q.text || 'Pertanyaan Ujian',
        options: q.options || [],
        correct: q.correct || 'A',
        points: parseFloat(q.points) || 2.0,
        aiKeywords: q.aiKeywords || [],
        rubric: q.rubric || ''
      }));

      const finalQuestions = (mode === 'replace') ? sanitized : [...current, ...sanitized];
      this.saveQuestions(finalQuestions);
      return {
        addedCount: sanitized.length,
        totalCount: finalQuestions.length,
        questions: finalQuestions
      };
    },

    // Hapus Soal Massal Berdasarkan ID yang Dipilih
    batchDeleteQuestions(idsToDelete) {
      if (!Array.isArray(idsToDelete) || idsToDelete.length === 0) {
        const current = this.getStoredQuestions();
        return { deletedCount: 0, totalCount: current.length, questions: current };
      }
      const idSet = new Set(idsToDelete.map(id => id.toString()));
      const current = this.getStoredQuestions();
      const remaining = current.filter(q => !idSet.has(q.id.toString()));
      this.saveQuestions(remaining);
      return {
        deletedCount: current.length - remaining.length,
        totalCount: remaining.length,
        questions: remaining
      };
    },

    // Hapus Seluruh Soal Berdasarkan BAB
    deleteQuestionsByBab(babKey) {
      const current = this.getStoredQuestions();
      const remaining = current.filter(q => q.bab !== babKey);
      this.saveQuestions(remaining);
      return {
        deletedCount: current.length - remaining.length,
        totalCount: remaining.length,
        questions: remaining
      };
    },

    // Kosongkan / Reset Seluruh Bank Soal
    clearQuestionBank() {
      const current = this.getStoredQuestions();
      const deletedCount = current.length;
      this.saveQuestions([]);
      return {
        deletedCount: deletedCount,
        totalCount: 0,
        questions: []
      };
    },

    // Pulihkan Bank Soal ke 50 Soal Standar Kurikulum
    restoreDefaultQuestions() {
      const def = this.defaultQuestions || [];
      this.saveQuestions(def);
      return {
        restoredCount: def.length,
        totalCount: def.length,
        questions: def
      };
    }
  };

  window.CBTDocParser = CBTDocParser;
})(window);
