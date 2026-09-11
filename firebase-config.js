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

    return { success: true, mode: 'local' };
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
  }
};

// Export ke window global
window.CBT_DB = CBT_DB;
window.initFirebase = initFirebase;
