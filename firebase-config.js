/**
 * CBT Sejarah SMK PGRI 11 - Firebase Cloud Database Service
 * 
 * Modul ini menghubungkan aplikasi ujian CBT ke Google Firebase Firestore
 * untuk penyimpanan terpusat nilai ujian siswa, log sesi, dan token ujian.
 * 
 * Menggunakan mode Hybrid: Jika Firebase belum diisi / offline,
 * sistem secara otomatis beralih ke browser localStorage tanpa error.
 */

// =========================================================================
// 1. KONFIGURASI FIREBASE ANDA
// =========================================================================
// Ganti nilai di bawah ini dengan konfigurasi dari Firebase Console Anda:
// (Project Settings -> General -> Your apps -> Web app)
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBwSy6tiAPC8OgsVKrmWVaO4jV9uGU4Gfo",
  authDomain: "cbt-smk-pgri11.firebaseapp.com",
  projectId: "cbt-smk-pgri11",
  storageBucket: "cbt-smk-pgri11.firebasestorage.app",
  messagingSenderId: "45216062981",
  appId: "1:45216062981:web:8f7baeaaf66142db20866c",
  measurementId: "G-VYX9MX7NWQ"
};

// =========================================================================
// 2. INISIALISASI DATABASE & FALLBACK SYSTEM
// =========================================================================
let db = null;
let isFirebaseReady = false;

function initFirebase() {
  try {
    if (typeof firebase !== 'undefined' && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== "YOUR_FIREBASE_API_KEY") {
      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      db = firebase.firestore();
      isFirebaseReady = true;
      console.log("✅ [Firebase] Berhasil terhubung ke Firestore Cloud Database!");
    } else {
      console.warn("ℹ️ [CBT DB] Firebase belum dikonfigurasi / menggunakan mode LocalStorage Fallback.");
      isFirebaseReady = false;
    }
  } catch (error) {
    console.error("⚠️ [Firebase] Gagal inisialisasi:", error);
    isFirebaseReady = false;
  }
}

// Inisialisasi awal
if (typeof window !== 'undefined') {
  initFirebase();
}

// =========================================================================
// 3. API SERVICE UNTUK UJIAN & DASHBOARD GURU
// =========================================================================
const CBT_DB = {
  isReady: () => isFirebaseReady,

  /**
   * Menyimpan hasil ujian siswa ke Firestore (dan cadangan localStorage)
   * @param {Object} submissionData Data lengkap hasil ujian
   */
  async saveSubmission(submissionData) {
    const payload = {
      ...submissionData,
      timestamp: new Date().toISOString(),
      createdAt: firebase && firebase.firestore ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
    };

    // 1. Selalu simpan di LocalStorage sebagai cadangan lokal
    try {
      const localResults = JSON.parse(localStorage.getItem('cbt_exam_results') || '[]');
      localResults.unshift({ ...payload, id: 'local_' + Date.now() });
      localStorage.setItem('cbt_exam_results', JSON.stringify(localResults));
      localStorage.setItem('cbt_last_result', JSON.stringify(payload));
    } catch (e) {
      console.warn("LocalStorage save warning:", e);
    }

    // 2. Simpan ke Firebase Firestore jika siap
    if (isFirebaseReady && db) {
      try {
        const docRef = await db.collection('exam_submissions').add(payload);
        console.log("✅ [Firebase] Hasil ujian tersimpan di Firestore dengan ID:", docRef.id);
        return { success: true, id: docRef.id, mode: 'cloud' };
      } catch (err) {
        console.error("⚠️ [Firebase] Gagal menyimpan ke cloud, tersimpan di lokal:", err);
        return { success: true, mode: 'local', error: err.message };
      }
    }

    // Hapus sesi aktif siswa jika ada
    if (payload.nama) {
      this.completeExamSession(payload.nama).catch(() => {});
    }

    return { success: true, mode: 'local' };
  },

  /**
   * Mendaftarkan sesi pengerjaan ujian siswa (Live Monitoring)
   */
  async registerExamSession(sessionData) {
    if (!sessionData || !sessionData.nama) return;
    const normName = this.normalizeName(sessionData.nama);
    const docId = normName.replace(/[^a-z0-9]/g, '_');
    const payload = {
      nama: sessionData.nama.trim(),
      normalizedName: normName,
      kelas: sessionData.kelas || 'XI AKL 1',
      nisn: sessionData.nisn || '0000000000',
      bab: sessionData.bab || 'SEMUA BAB',
      status: 'Sedang Mengerjakan',
      pelanggaran: sessionData.pelanggaran || 0,
      waktuMulai: sessionData.waktuMulai || new Date().toLocaleTimeString('id-ID'),
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString()
    };

    try {
      const list = JSON.parse(localStorage.getItem('cbt_active_sessions') || '[]');
      const idx = list.findIndex(s => this.normalizeName(s.nama) === normName);
      if (idx >= 0) list[idx] = { ...list[idx], ...payload };
      else list.unshift(payload);
      localStorage.setItem('cbt_active_sessions', JSON.stringify(list));
    } catch (e) {}

    if (isFirebaseReady && db) {
      try {
        await db.collection('cbt_active_sessions').doc(docId).set(payload, { merge: true });
      } catch (e) {
        console.warn("⚠️ [Firebase] Gagal sinkron sesi aktif:", e);
      }
    }
  },

  /**
   * Memperbarui sesi pengerjaan siswa (cth: pelanggaran, heartbeat)
   */
  async updateExamSession(studentName, updates = {}) {
    if (!studentName) return;
    const normName = this.normalizeName(studentName);
    const docId = normName.replace(/[^a-z0-9]/g, '_');

    try {
      const list = JSON.parse(localStorage.getItem('cbt_active_sessions') || '[]');
      const idx = list.findIndex(s => this.normalizeName(s.nama) === normName);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...updates, lastHeartbeat: new Date().toISOString() };
        localStorage.setItem('cbt_active_sessions', JSON.stringify(list));
      }
    } catch (e) {}

    if (isFirebaseReady && db) {
      try {
        await db.collection('cbt_active_sessions').doc(docId).set({
          ...updates,
          lastHeartbeat: new Date().toISOString()
        }, { merge: true });
      } catch (e) {}
    }
  },

  /**
   * Menyelesaikan / membersihkan sesi aktif saat ujian selesai atau didiskualifikasi
   */
  async completeExamSession(studentName) {
    if (!studentName) return;
    const normName = this.normalizeName(studentName);
    const docId = normName.replace(/[^a-z0-9]/g, '_');

    try {
      let list = JSON.parse(localStorage.getItem('cbt_active_sessions') || '[]');
      list = list.filter(s => this.normalizeName(s.nama) !== normName);
      localStorage.setItem('cbt_active_sessions', JSON.stringify(list));
    } catch (e) {}

    if (isFirebaseReady && db) {
      try {
        await db.collection('cbt_active_sessions').doc(docId).delete();
      } catch (e) {}
    }
  },

  /**
   * Mengambil daftar sesi aktif
   */
  getActiveSessions() {
    try {
      return JSON.parse(localStorage.getItem('cbt_active_sessions') || '[]');
    } catch (e) {
      return [];
    }
  },

  /**
   * Mendengarkan sesi aktif secara Realtime (Live Monitoring)
   */
  listenActiveSessions(onUpdate) {
    const loadLocal = () => onUpdate(this.getActiveSessions());
    loadLocal();

    if (isFirebaseReady && db) {
      return db.collection('cbt_active_sessions').onSnapshot(snap => {
        const list = [];
        snap.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
        localStorage.setItem('cbt_active_sessions', JSON.stringify(list));
        onUpdate(list);
      }, err => {
        console.warn("Active sessions listener fallback:", err);
        loadLocal();
      });
    }

    const storageHandler = () => loadLocal();
    window.addEventListener('storage', storageHandler);
    return () => window.removeEventListener('storage', storageHandler);
  },

  /**
   * Mendengarkan daftar hasil ujian secara Real-time (untuk admin.html)
   * @param {Function} onUpdate Callback yang dipanggil saat ada data baru
   * @param {Function} onError Callback jika terjadi error
   */
  listenSubmissions(onUpdate, onError) {
    // Muat data lokal terlebih dahulu agar tampilan instan
    const loadLocal = () => {
      try {
        const local = JSON.parse(localStorage.getItem('cbt_exam_results') || '[]');
        onUpdate(local);
      } catch (e) {
        onUpdate([]);
      }
    };

    loadLocal();

    if (isFirebaseReady && db) {
      return db.collection('exam_submissions')
        .orderBy('timestamp', 'desc')
        .onSnapshot((snapshot) => {
          const results = [];
          snapshot.forEach((doc) => {
            results.push({ id: doc.id, ...doc.data() });
          });
          onUpdate(results);
        }, (err) => {
          console.warn("⚠️ [Firebase] Realtime listener error, fallback ke lokal:", err);
          if (onError) onError(err);
          loadLocal();
        });
    }

    // Fallback: Dengarkan event storage browser jika tab lain menambah data lokal
    const storageHandler = () => loadLocal();
    window.addEventListener('storage', storageHandler);
    return () => window.removeEventListener('storage', storageHandler);
  },

  /**
   * Menghapus 1 hasil ujian (fitur guru di admin panel)
   * @param {string} submissionId 
   */
  async deleteSubmission(submissionId) {
    // Hapus dari localStorage
    try {
      let local = JSON.parse(localStorage.getItem('cbt_exam_results') || '[]');
      local = local.filter(item => item.id !== submissionId);
      localStorage.setItem('cbt_exam_results', JSON.stringify(local));
    } catch (e) {
      console.warn("Local delete error:", e);
    }

    // Hapus dari Firestore jika ID dari cloud
    if (isFirebaseReady && db && !submissionId.startsWith('local_')) {
      try {
        await db.collection('exam_submissions').doc(submissionId).delete();
        console.log("✅ [Firebase] Dokumen berhasil dihapus:", submissionId);
        return true;
      } catch (err) {
        console.error("⚠️ [Firebase] Gagal menghapus dokumen:", err);
      }
    }
    return true;
  },

  /**
   * Mengambil / Menyimpan Token Ujian Terpusat
   */
  async setToken(token, validUntilMinutes = 5) {
    const expiresAt = Date.now() + (validUntilMinutes * 60 * 1000);
    const tokenObj = {
      token: token.toUpperCase(),
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt,
      validMinutes: validUntilMinutes
    };

    localStorage.setItem('cbt_exam_token', JSON.stringify(tokenObj));

    if (isFirebaseReady && db) {
      try {
        await db.collection('cbt_settings').doc('active_token').set(tokenObj);
        console.log("✅ [Firebase] Token ujian disinkronkan ke Cloud:", token);
      } catch (err) {
        console.warn("⚠️ [Firebase] Gagal sinkron token ke cloud:", err);
      }
    }
    return tokenObj;
  },

  /**
   * Mendengarkan perubahan Token Ujian secara Real-time
   */
  listenToken(onTokenChange) {
    // Cek lokal
    const checkLocal = () => {
      try {
        const saved = JSON.parse(localStorage.getItem('cbt_exam_token') || 'null');
        if (saved) onTokenChange(saved);
      } catch (e) {}
    };
    checkLocal();

    if (isFirebaseReady && db) {
      return db.collection('cbt_settings').doc('active_token')
        .onSnapshot((doc) => {
          if (doc.exists) {
            const data = doc.data();
            localStorage.setItem('cbt_exam_token', JSON.stringify(data));
            onTokenChange(data);
          }
        }, (err) => {
          console.warn("⚠️ [Firebase] Token listener fallback:", err);
        });
    }
  },

  /**
   * Normalisasi Nama Lengkap Siswa agar tahan spasi berlebih & perbedaan huruf besar/kecil
   */
  normalizeName(name) {
    return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  },

  /**
   * Mengambil daftar siswa yang terblokir karena 3x pelanggaran kecurangan
   */
  getBlockedStudents() {
    try {
      return JSON.parse(localStorage.getItem('cbt_blocked_students') || '[]');
    } catch (e) {
      return [];
    }
  },

  /**
   * Memblokir siswa (Nama Lengkap) karena 3x pelanggaran kecurangan
   */
  async blockStudent(studentName, reason = '3x Pelanggaran Layar / Kecurangan', extra = {}) {
    if (!studentName) return;
    const nameClean = studentName.trim();
    const normName = this.normalizeName(nameClean);
    const docId = normName.replace(/[^a-z0-9]/g, '_');
    const list = this.getBlockedStudents();
    const existingIndex = list.findIndex(s => this.normalizeName(s.nama) === normName);
    
    const blockData = {
      nama: nameClean,
      normalizedName: normName,
      kelas: extra.kelas || localStorage.getItem('cbt_student_class') || 'XI AKL 1',
      nisn: extra.nisn || localStorage.getItem('cbt_student_nisn') || '0000000000',
      reason: reason,
      blockedAt: new Date().toISOString(),
      waktuBlokir: new Date().toLocaleTimeString('id-ID'),
      attemptCount: 0,
      lastAttemptTime: null,
      lastAttemptDevice: null
    };

    if (existingIndex >= 0) {
      list[existingIndex] = { ...list[existingIndex], ...blockData };
    } else {
      list.push(blockData);
    }

    localStorage.setItem('cbt_blocked_students', JSON.stringify(list));

    if (isFirebaseReady && db) {
      try {
        await db.collection('cbt_blocked_students').doc(docId).set(blockData, { merge: true });
        console.log("✅ [Firebase] Siswa terblokir disinkronkan ke Cloud Firestore:", nameClean);
      } catch (err) {
        console.warn("⚠️ [Firebase] Gagal sinkron blokir siswa ke cloud:", err);
      }
    }
    return list;
  },

  /**
   * Memeriksa status blokir siswa secara Realtime Cloud (Cross-Device)
   * dan mencatat log percobaan login jika siswa mencoba masuk sebelum direset
   */
  async checkStudentBlockedAsync(studentName) {
    if (!studentName) return { isBlocked: false };
    const normName = this.normalizeName(studentName);
    const docId = normName.replace(/[^a-z0-9]/g, '_');

    // 1. Cek secara sinkron di lokal
    let isBlockedLocal = this.isStudentBlocked(studentName);
    let localData = this.getBlockedStudents().find(s => this.normalizeName(s.nama) === normName);

    // 2. Cek langsung ke Cloud Firestore jika aktif
    if (isFirebaseReady && db) {
      try {
        const docSnap = await db.collection('cbt_blocked_students').doc(docId).get();
        if (docSnap.exists) {
          const cloudData = docSnap.data();
          const deviceLabel = /Mobile|Android|iPhone/i.test(navigator.userAgent) ? 'HP / Mobile' : 'Laptop / PC';
          const newAttemptCount = (cloudData.attemptCount || 0) + 1;
          const attemptTime = new Date().toLocaleTimeString('id-ID');
          
          // Catat log percobaan login siswa terblokir ke Firestore
          await db.collection('cbt_blocked_students').doc(docId).update({
            attemptCount: newAttemptCount,
            lastAttemptAt: new Date().toISOString(),
            lastAttemptTime: attemptTime,
            lastAttemptDevice: deviceLabel
          }).catch(() => {});

          // Perbarui juga data di localStorage
          this.blockStudent(cloudData.nama || studentName, cloudData.reason || '3x Keluar Layar', {
            kelas: cloudData.kelas,
            nisn: cloudData.nisn
          });

          return {
            isBlocked: true,
            data: { ...cloudData, attemptCount: newAttemptCount, lastAttemptTime: attemptTime, lastAttemptDevice: deviceLabel }
          };
        } else {
          // Jika dokumen tidak ada di Firestore (sudah direset admin di cloud)
          if (isBlockedLocal) {
            this.unblockStudent(studentName);
          }
          return { isBlocked: false };
        }
      } catch (err) {
        console.warn("⚠️ [Firebase] Cloud check error, fallback ke lokal:", err);
      }
    }

    if (isBlockedLocal) {
      return { isBlocked: true, data: localData || { nama: studentName, reason: '3x Pelanggaran' } };
    }
    return { isBlocked: false };
  },

  /**
   * Mereset / membuka blokir login siswa (Fitur Admin Guru)
   */
  async unblockStudent(studentName) {
    if (!studentName) return;
    const normName = this.normalizeName(studentName);
    const docId = normName.replace(/[^a-z0-9]/g, '_');
    let list = this.getBlockedStudents();
    list = list.filter(s => this.normalizeName(s.nama) !== normName);
    localStorage.setItem('cbt_blocked_students', JSON.stringify(list));

    // Reset cbt_cheat_count jika siswa lokal
    const currentStudent = localStorage.getItem('cbt_student_name') || '';
    if (this.normalizeName(currentStudent) === normName) {
      localStorage.setItem('cbt_cheat_count', '0');
    }

    if (isFirebaseReady && db) {
      try {
        await db.collection('cbt_blocked_students').doc(docId).delete();
        console.log("✅ [Firebase] Blokir siswa berhasil dibuka di Cloud:", studentName);
      } catch (err) {
        console.warn("⚠️ [Firebase] Gagal hapus blokir di cloud:", err);
      }
    }
    return list;
  },

  /**
   * Mereset semua blokir siswa sekaligus (Fitur Admin Guru)
   */
  async unblockAllStudents() {
    localStorage.setItem('cbt_blocked_students', JSON.stringify([]));
    localStorage.setItem('cbt_cheat_count', '0');

    if (isFirebaseReady && db) {
      try {
        const snapshot = await db.collection('cbt_blocked_students').get();
        const batch = db.batch();
        snapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        console.log("✅ [Firebase] Semua blokir siswa berhasil di-reset di Cloud.");
      } catch (err) {
        console.warn("⚠️ [Firebase] Gagal reset semua blokir:", err);
      }
    }
    return [];
  },

  /**
   * Memeriksa apakah siswa sedang dalam status terblokir (Sinkron)
   */
  isStudentBlocked(studentName) {
    if (!studentName) return false;
    const normName = this.normalizeName(studentName);
    const list = this.getBlockedStudents();
    return list.some(s => this.normalizeName(s.nama) === normName || this.normalizeName(s.normalizedName) === normName);
  },

  /**
   * Mendengarkan daftar siswa terblokir secara Real-time dari Cloud Firestore
   */
  listenBlockedStudents(onUpdate) {
    const checkLocal = () => onUpdate(this.getBlockedStudents());
    checkLocal();

    if (isFirebaseReady && db) {
      return db.collection('cbt_blocked_students')
        .orderBy('blockedAt', 'desc')
        .onSnapshot((snapshot) => {
          const list = [];
          snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
          localStorage.setItem('cbt_blocked_students', JSON.stringify(list));
          onUpdate(list);
        }, (err) => {
          console.warn("⚠️ [Firebase] Blocked students listener fallback:", err);
          checkLocal();
        });
    }

    const storageHandler = () => checkLocal();
    window.addEventListener('storage', storageHandler);
    return () => window.removeEventListener('storage', storageHandler);
  }
};

// Export ke window global
window.CBT_DB = CBT_DB;
window.initFirebase = initFirebase;
