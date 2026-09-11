const mysql = require('mysql2/promise');
const fs = require('fs');

async function seed() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'cbt_sejarah_pgri11',
    port: 3306
  });

  try {
    console.log('Memeriksa isi tabel questions...');
    const [rows] = await pool.query('SELECT COUNT(*) as count FROM questions');
    
    // Default Access Sessions
    const defaultAccess = {
      'BAB 1': 1,
      'BAB 2': 0,
      'BAB 3': 0,
      'BAB 4': 0,
      'BAB 5': 0,
      'BAB 6': 0,
      'ALL': 1
    };

    for (const [babKey, isActive] of Object.entries(defaultAccess)) {
      await pool.query(
        'INSERT INTO exam_sessions (bab_key, is_active) VALUES (?, ?) ON DUPLICATE KEY UPDATE is_active = VALUES(is_active)',
        [babKey, isActive]
      );
    }
    console.log('✓ Sesi BAB 1 - 6 berhasil diinisialisasi ke MySQL.');

    // Seed Questions from index.html if empty
    if (rows[0].count === 0) {
      console.log('Mengambil master soal sejarah dari index.html...');
      const html = fs.readFileSync('index.html', 'utf8');
      const startMark = 'const defaultMasterQuestions = [';
      const endMark = '];\n\n    // Initialize Question Bank';
      
      const startIdx = html.indexOf(startMark);
      const endIdx = html.indexOf(endMark, startIdx);
      
      if (startIdx !== -1 && endIdx !== -1) {
        const jsonCode = html.substring(startIdx + 'const defaultMasterQuestions = '.length, endIdx + 1);
        const questions = eval(jsonCode);
        console.log('Mengimpor ' + questions.length + ' butir soal master ke database MySQL...');
        
        const insertQuery = `
          INSERT INTO questions (bab, type, text, options_json, correct, ai_keywords_json, rubric, points)
          VALUES ?
        `;
        const values = questions.map(q => [
          q.bab || 'BAB 1',
          q.type || 'mcq',
          q.text,
          JSON.stringify(q.options || []),
          q.correct || null,
          JSON.stringify(q.aiKeywords || []),
          q.rubric || null,
          q.points || 2.0
        ]);

        await pool.query(insertQuery, [values]);
        console.log('✓ ' + questions.length + ' Butir soal berhasil diimpor ke MySQL cbt_sejarah_pgri11!');
      }
    } else {
      console.log('✓ Tabel questions sudah memiliki ' + rows[0].count + ' butir soal.');
    }

    console.log('🎉 Inisialisasi Database MySQL Selesai!');
  } catch (err) {
    console.error('✗ Error seeding database:', err.message);
  } finally {
    await pool.end();
  }
}

seed();