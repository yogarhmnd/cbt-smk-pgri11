const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Helper to resolve files in local & Vercel serverless Lambda environments
const getRootFile = (fileName) => {
  const candidates = [
    path.join(__dirname, fileName),
    path.join(__dirname, '..', fileName),
    path.join(process.cwd(), fileName)
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(process.cwd(), fileName);
};

// Serve static assets and views
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/assets', express.static(path.join(process.cwd(), 'assets')));
app.use(express.static(path.join(__dirname)));
app.use(express.static(process.cwd()));

app.get('/', (req, res) => {
  res.sendFile(getRootFile('index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(getRootFile('admin.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(getRootFile('login.html'));
});

app.get('/ai-engine.js', (req, res) => {
  res.sendFile(getRootFile('ai-engine.js'));
});

// MySQL Database Connection Pool
const dbPool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'cbt_sejarah_pgri11',
  port: parseInt(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 5000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

// Test Connection
dbPool.getConnection()
  .then(conn => {
    console.log('✓ [DATABASE SUCCESS]: Terhubung ke MySQL:', process.env.DB_HOST || 'localhost', process.env.DB_NAME || 'cbt_sejarah_pgri11');
    conn.release();
  })
  .catch(err => {
    console.warn('! [DATABASE STATUS]: Menggunakan mode fallback otomatis (Offline / LocalStorage):', err.message);
  });

// ==========================================
// 1. API: HEALTH CHECK & STATUS KONEKSI DB
// ==========================================
app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await dbPool.query('SELECT 1 as connected');
    res.json({ status: 'ok', database: 'connected', time: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'disconnected', error: err.message });
  }
});

// ==========================================
// 2. API: BANK SOAL (QUESTIONS)
// ==========================================
// Get all questions or by BAB
app.get('/api/questions', async (req, res) => {
  try {
    const { bab } = req.query;
    let query = 'SELECT * FROM questions';
    const params = [];
    if (bab && bab !== 'ALL') {
      query += ' WHERE bab = ?';
      params.push(bab);
    }
    query += ' ORDER BY id ASC';

    const [rows] = await dbPool.query(query, params);
    const formatted = rows.map(q => ({
      id: q.id,
      bab: q.bab,
      type: q.type,
      text: q.text,
      options: q.options_json ? (typeof q.options_json === 'string' ? JSON.parse(q.options_json) : q.options_json) : [],
      correct: q.correct,
      aiKeywords: q.ai_keywords_json ? (typeof q.ai_keywords_json === 'string' ? JSON.parse(q.ai_keywords_json) : q.ai_keywords_json) : [],
      rubric: q.rubric,
      points: parseFloat(q.points) || 2.0
    }));

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add single or bulk questions
app.post('/api/questions', async (req, res) => {
  try {
    const data = req.body;
    if (Array.isArray(data)) {
      // Bulk insert
      const insertQuery = `
        INSERT INTO questions (bab, type, text, options_json, correct, ai_keywords_json, rubric, points)
        VALUES ?
      `;
      const values = data.map(q => [
        q.bab || 'BAB 1',
        q.type || 'mcq',
        q.text,
        JSON.stringify(q.options || []),
        q.correct || null,
        JSON.stringify(q.aiKeywords || []),
        q.rubric || null,
        q.points || 2.0
      ]);
      const [result] = await dbPool.query(insertQuery, [values]);
      return res.json({ success: true, insertedCount: result.affectedRows });
    } else {
      // Single insert
      const { bab, type, text, options, correct, aiKeywords, rubric, points } = data;
      const [result] = await dbPool.query(
        `INSERT INTO questions (bab, type, text, options_json, correct, ai_keywords_json, rubric, points)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bab || 'BAB 1',
          type || 'mcq',
          text,
          JSON.stringify(options || []),
          correct || null,
          JSON.stringify(aiKeywords || []),
          rubric || null,
          points || 2.0
        ]
      );
      res.json({ success: true, id: result.insertId });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete question
app.delete('/api/questions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await dbPool.query('DELETE FROM questions WHERE id = ?', [id]);
    res.json({ success: true, message: 'Soal berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 3. API: SESI UJIAN & KONTROL AKSES BAB
// ==========================================
app.get('/api/sessions', async (req, res) => {
  try {
    const [rows] = await dbPool.query('SELECT * FROM exam_sessions');
    const access = {};
    rows.forEach(r => {
      access[r.bab_key] = Boolean(r.is_active);
    });
    res.json({ success: true, access });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const { access } = req.body;
    if (!access) return res.status(400).json({ success: false, message: 'Data akses diperlukan' });

    for (const [babKey, isActive] of Object.entries(access)) {
      await dbPool.query(
        `INSERT INTO exam_sessions (bab_key, is_active)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE is_active = VALUES(is_active)`,
        [babKey, isActive ? 1 : 0]
      );
    }
    res.json({ success: true, message: 'Status akses sesi ujian diperbarui' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 4. API: TOKEN UJIAN 5-MENIT
// ==========================================
app.get('/api/token', async (req, res) => {
  try {
    const [rows] = await dbPool.query(
      'SELECT * FROM exam_tokens WHERE expires_at > NOW() ORDER BY id DESC LIMIT 1'
    );
    if (rows.length > 0) {
      const token = rows[0];
      const remainingSec = Math.max(0, Math.floor((new Date(token.expires_at).getTime() - Date.now()) / 1000));
      return res.json({ success: true, token: token.token_code, remainingSec, expiresAt: token.expires_at });
    }

    // Generate new token
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    const tokenCode = 'SEJ-' + code;
    const expiresAt = new Date(Date.now() + 300 * 1000);

    await dbPool.query(
      'INSERT INTO exam_tokens (token_code, expires_at) VALUES (?, ?)',
      [tokenCode, expiresAt]
    );

    res.json({ success: true, token: tokenCode, remainingSec: 300, expiresAt });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/token/regenerate', async (req, res) => {
  try {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    const tokenCode = 'SEJ-' + code;
    const expiresAt = new Date(Date.now() + 300 * 1000);

    await dbPool.query(
      'INSERT INTO exam_tokens (token_code, expires_at) VALUES (?, ?)',
      [tokenCode, expiresAt]
    );

    res.json({ success: true, token: tokenCode, remainingSec: 300, expiresAt });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 5. API: HASIL & SUBMISSION SISWA (NILAI)
// ==========================================
app.get('/api/submissions', async (req, res) => {
  try {
    const [rows] = await dbPool.query(
      'SELECT * FROM student_submissions ORDER BY waktu_submit DESC'
    );
    const formatted = rows.map(s => ({
      id: s.id,
      nisn: s.nisn,
      nama: s.nama,
      kelas: s.kelas,
      bab: s.bab_ujian,
      nilai: parseFloat(s.nilai_total).toFixed(1),
      pgScore: parseFloat(s.skor_pg).toFixed(1),
      essayScore: parseFloat(s.skor_esai).toFixed(1),
      benar: s.benar,
      salah: s.salah,
      pelanggaran: s.pelanggaran,
      waktuSubmit: new Date(s.waktu_submit).toLocaleTimeString('id-ID'),
      evaluationDetails: s.evaluation_json ? (typeof s.evaluation_json === 'string' ? JSON.parse(s.evaluation_json) : s.evaluation_json) : []
    }));
    res.json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/submissions', async (req, res) => {
  try {
    const { nisn, nama, kelas, bab, nilai, pgScore, essayScore, benar, salah, pelanggaran, answers, evaluationDetails } = req.body;
    
    const [result] = await dbPool.query(
      `INSERT INTO student_submissions 
        (nisn, nama, kelas, bab_ujian, nilai_total, skor_pg, skor_esai, benar, salah, pelanggaran, answers_json, evaluation_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nisn || '0067829102',
        nama || 'Ahmad Fauzi',
        kelas || 'XI Akuntansi 1',
        bab || 'ALL',
        parseFloat(nilai) || 0,
        parseFloat(pgScore) || 0,
        parseFloat(essayScore) || 0,
        parseInt(benar) || 0,
        parseInt(salah) || 0,
        parseInt(pelanggaran) || 0,
        JSON.stringify(answers || {}),
        JSON.stringify(evaluationDetails || [])
      ]
    );

    res.json({ success: true, id: result.insertId, message: 'Hasil ujian berhasil disimpan ke database MySQL' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// EXPORT FOR VERCEL SERVERLESS & LOCAL LISTEN
if (process.env.VERCEL !== '1' && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  app.listen(PORT, () => {
    console.log('🚀 ====================================================');
    console.log('   CBT SEJARAH INDONESIA - SERVER BACKEND AKTIF');
    console.log('   Aplikasi: http://localhost:' + PORT);
    console.log('   Database: MySQL localhost:3306 / cbt_sejarah_pgri11');
    console.log('====================================================');
  });
}

module.exports = app;