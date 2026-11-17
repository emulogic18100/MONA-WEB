// =========================================================================
// 1. SECURITY, VALIDATION, SCHEMA SANITIZATION & BINARY FILE INSPECTION
// =========================================================================
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ALLOWED_MUTATION_TYPES = new Set(['PEMASUKAN', 'PENGELUARAN', 'TABUNGAN_GOAL']);
const INTERNAL_AUTH_DOMAIN = '@mona-internal.app';

function normalizePlainText(str, maxLen = 120) {
    if (typeof str !== 'string') return '';
    return str.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLen);
}

function cleanAlphaNum(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase().slice(0, 24);
}

function usernameToInternalEmail(username) {
    const clean = cleanAlphaNum(username);
    return clean ? `${clean}${INTERNAL_AUTH_DOMAIN}` : '';
}

function validateStrongPassword(pwd) {
    if (typeof pwd !== 'string' || pwd.length < 6 || pwd.length > 64) return false;
    return /[a-zA-Z]/.test(pwd) && /[0-9]/.test(pwd);
}

function isValidIsoDate(dateStr) {
    return typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function isValidAccountId(id) {
    if (typeof id !== 'string') return false;
    return /^(acc_[a-zA-Z0-9_-]+|GOAL_\d+)$/.test(id);
}

function sanitizeAccountObject(raw, fallbackIdx = 0) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = (typeof raw.id === 'string' && /^acc_[a-zA-Z0-9_-]+$/.test(raw.id))
    ? raw.id
    : `acc_${Date.now()}_${fallbackIdx}`;
    const name = normalizePlainText(raw.name, 30) || 'Kas Utama';
    const type = normalizePlainText(raw.type, 30) || 'Rekening Utama';
    const initialBalance = Math.max(0, Number(raw.initialBalance) || 0);
    return { id, name, type, initialBalance };
}

function sanitizeGoalObject(raw, fallbackIdx = 0) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = Number.isFinite(Number(raw.id)) ? Math.floor(Number(raw.id)) : (Date.now() + fallbackIdx);
    const name = normalizePlainText(raw.name, 50);
    if (!name) return null;
    return {
        id,
        name,
        target: Math.max(0, Number(raw.target) || 0),
        current: Math.max(0, Number(raw.current) || 0),
        monthly: Math.max(0, Number(raw.monthly) || 0),
        category: normalizePlainText(raw.category, 40) || 'Target Lainnya',
        storeIn: normalizePlainText(raw.storeIn, 35) || 'Kas Utama',
        sourceFromId: isValidAccountId(raw.sourceFromId) ? raw.sourceFromId : 'acc_main',
        sourceFromName: normalizePlainText(raw.sourceFromName, 35) || 'Kas Utama'
    };
}

function sanitizeLogObject(raw, fallbackIdx = 0) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = Number.isFinite(Number(raw.id)) ? Math.floor(Number(raw.id)) : (Date.now() + fallbackIdx);
    const date = isValidIsoDate(raw.date) ? raw.date : new Date().toISOString().split('T')[0];
    const type = ALLOWED_MUTATION_TYPES.has(raw.type) ? raw.type : 'PENGELUARAN';
    const accountId = isValidAccountId(raw.accountId) ? raw.accountId : 'acc_main';
    const category = normalizePlainText(raw.category, 40) || 'Lainnya';
    const title = normalizePlainText(raw.title, 80) || 'Transaksi';
    const amount = Math.max(0, Number(raw.amount) || 0);
    const notes = normalizePlainText(raw.notes, 120);
    return { id, date, type, accountId, category, title, amount, notes };
}

function sanitizeSettingsObject(raw) {
    const clean = {
        savingsMode: 'SINGLE',
        accounts: [{ id: 'acc_main', name: 'Kas Utama', type: 'Rekening Utama', initialBalance: 0 }],
        dailyLimit: 0,
        monthlyLimit: 0,
        avatarDataUrl: ''
    };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;

    for (const key of Object.keys(raw)) {
        if (FORBIDDEN_KEYS.has(key)) continue;
        if (key === 'savingsMode' && (raw.savingsMode === 'SINGLE' || raw.savingsMode === 'MULTI')) {
            clean.savingsMode = raw.savingsMode;
        } else if (key === 'accounts' && Array.isArray(raw.accounts)) {
            const validAccs = raw.accounts.map((a, i) => sanitizeAccountObject(a, i)).filter(Boolean);
            if (validAccs.length > 0) clean.accounts = validAccs;
        } else if (key === 'dailyLimit') {
            clean.dailyLimit = Math.max(0, Number(raw.dailyLimit) || 0);
        } else if (key === 'monthlyLimit') {
            clean.monthlyLimit = Math.max(0, Number(raw.monthlyLimit) || 0);
        } else if (key === 'avatarDataUrl' && typeof raw.avatarDataUrl === 'string') {
            if (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(raw.avatarDataUrl) && raw.avatarDataUrl.length <= 250000) {
                clean.avatarDataUrl = raw.avatarDataUrl;
            }
        }
    }
    return clean;
}

const SVG_EYE_OPEN = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
const SVG_EYE_CLOSED = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

function togglePasswordVisibility(inputId, btnElem) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        if (btnElem) btnElem.innerHTML = SVG_EYE_CLOSED;
    } else {
        input.type = 'password';
        if (btnElem) btnElem.innerHTML = SVG_EYE_OPEN;
    }
}

function inspectImageMagicBytes(file) {
    return new Promise((resolve) => {
        if (!file || file.size > 2 * 1024 * 1024) {
            resolve({ valid: false, reason: 'Ukuran file melebihi batas maksimal 2MB.' });
            return;
        }

        const reader = new FileReader();
        reader.onloadend = function(e) {
            if (!e.target || !e.target.result) {
                resolve({ valid: false, reason: 'Gagal membaca struktur biner file.' });
                return;
            }
            const arr = new Uint8Array(e.target.result);
            if (arr.length < 8) {
                resolve({ valid: false, reason: 'Header file tidak lengkap atau rusak.' });
                return;
            }

            const isJpeg = (arr[0] === 0xFF && arr[1] === 0xD8 && arr[2] === 0xFF);
            const isPng = (
                arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4E && arr[3] === 0x47 &&
                arr[4] === 0x0D && arr[5] === 0x0A && arr[6] === 0x1A && arr[7] === 0x0A
            );
            const isGif = (arr[0] === 0x47 && arr[1] === 0x49 && arr[2] === 0x46 && arr[3] === 0x38);

            if (!isJpeg && !isPng && !isGif) {
                resolve({ valid: false, reason: 'Ditolak oleh Sistem Keamanan: Konten biner bukan JPG, PNG, atau GIF asli.' });
                return;
            }

            resolve({ valid: true, mime: isPng ? 'image/png' : (isGif ? 'image/gif' : 'image/jpeg') });
        };
        reader.onerror = function() {
            resolve({ valid: false, reason: 'Kesalahan membaca berkas.' });
        };
        reader.readAsArrayBuffer(file.slice(0, 16));
    });
}

function sanitizeAndCompressAvatar(file, mime) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                const maxSourceDim = 4096;
                if (img.width <= 0 || img.height <= 0 || img.width > maxSourceDim || img.height > maxSourceDim) {
                    reject(new Error('Dimensi gambar melebihi batas maksimal 4096x4096 piksel.'));
                    return;
                }

                const canvas = document.createElement('canvas');
                const maxDim = 220;
                let w = img.width;
                let h = img.height;
                if (w > h) {
                    if (w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
                } else {
                    if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
                }
                canvas.width = Math.max(1, w);
                canvas.height = Math.max(1, h);

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Gagal menginisialisasi konteks pemrosesan gambar.'));
                    return;
                }

                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const outputMime = (mime === 'image/png') ? 'image/png' : 'image/jpeg';
                const cleanDataUrl = canvas.toDataURL(outputMime, 0.85);

                if (cleanDataUrl.length > 250000) {
                    reject(new Error('Ukuran hasil kompresi gambar terlalu besar untuk disimpan.'));
                    return;
                }
                resolve(cleanDataUrl);
            };
            img.onerror = () => reject(new Error('Konten gambar korup atau tidak valid.'));
            img.src = event.target.result;
        };
        reader.onerror = () => reject(new Error('Gagal memproses gambar.'));
        reader.readAsDataURL(file);
    });
}

// =========================================================================
// 2. CONFIG FIREBASE (AUTH + FIRESTORE) & APPLICATION STATE
// =========================================================================
const firebaseConfig = {
    apiKey: "AIzaSyCMCJL-0uN1uhqB4xnK0TpIw13cGZEvYfo",
    authDomain: "mona-finance-2d09c.firebaseapp.com",
    projectId: "mona-finance-2d09c",
    storageBucket: "mona-finance-2d09c.firebasestorage.app",
    messagingSenderId: "436142712801",
    appId: "1:436142712801:web:2e1a48565b135fe68fd4a0",
    measurementId: "G-VW99ZB4BSD"
};

let db = null;
let auth = null;
let isFirebaseActive = false;

try {
    if (firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("PASTE_")) {
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore();
        isFirebaseActive = true;
    }
} catch (e) {
    console.warn("Mode Lokal Aktif:", e.message || e);
}

let currentUser = null; // { uid, username, nickname }
let unsubscribeFirestore = null;
let isSyncInProgress = false;

let goals = [];
let dailyLogs = [];
let userSettings = sanitizeSettingsObject(null);

// =========================================================================
// 3. THEME SYSTEM ENGINE
// =========================================================================
function setTheme(theme) {
    const btnLight = document.getElementById('btnThemeLight');
    const btnDark = document.getElementById('btnThemeDark');

    if (theme === 'dark') {
        document.body.classList.add('dark-mode');
        localStorage.setItem('mona_theme', 'dark');
        if (btnDark) btnDark.classList.add('active');
        if (btnLight) btnLight.classList.remove('active');
    } else {
        document.body.classList.remove('dark-mode');
        localStorage.setItem('mona_theme', 'light');
        if (btnLight) btnLight.classList.add('active');
        if (btnDark) btnDark.classList.remove('active');
    }
    updateAllCalculations();
}

function initTheme() {
    setTheme(localStorage.getItem('mona_theme') || 'light');
}

// =========================================================================
// 4. DROPDOWN, PARSING & DATE UTILITIES
// =========================================================================
function toggleExportMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById('exportDropdownMenu');
    if (menu) menu.classList.toggle('active');
}

function parseMoneyInput(val) {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : Math.max(0, val);
    const cleaned = val.toString().replace(/[^0-9]/g, '');
    return cleaned === '' ? 0 : parseFloat(cleaned);
}

function formatRupiah(number, showCents = true) {
    if (number === null || number === undefined || isNaN(number)) number = 0;
    const isNeg = number < 0;
    const absVal = Math.abs(number);
    const parts = absVal.toFixed(showCents ? 2 : 0).split('.');
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const prefix = isNeg ? '-Rp' : 'Rp';
    return showCents ? `${prefix}${integerPart},${parts[1]}` : `${prefix}${integerPart}`;
}

function formatInputValue(inputElem) {
    if (!inputElem) return;
    const rawVal = parseMoneyInput(inputElem.value);
    inputElem.value = rawVal ? rawVal.toLocaleString('id-ID') : '';
}

function setupMoneyInputFormatting() {
    document.querySelectorAll('.money-input').forEach(elem => {
        elem.addEventListener('input', function() {
            const cursorOffset = this.value.length - (this.selectionEnd || 0);
            formatInputValue(this);
            const newCursor = Math.max(0, this.value.length - cursorOffset);
            if (this.setSelectionRange) this.setSelectionRange(newCursor, newCursor);
        });
    });
}

function getISOWeekNumber(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function getDateFromISOWeek(w, y) {
    const simple = new Date(y, 0, 1 + (w - 1) * 7);
    const dow = simple.getDay();
    const ISOweekStart = simple;
    if (dow <= 4) ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
    else ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
    return ISOweekStart;
}

// =========================================================================
// 5. ACCOUNT BALANCE ENGINE
// =========================================================================
function ensureDefaultAccount() {
    if (!Array.isArray(userSettings.accounts) || userSettings.accounts.length === 0) {
        userSettings.accounts = [{ id: 'acc_main', name: 'Kas Utama', type: 'Rekening Utama', initialBalance: 0 }];
    }
}

function calculateAccountBalances() {
    ensureDefaultAccount();
    const balances = {};
    userSettings.accounts.forEach(acc => {
        balances[acc.id] = Number(acc.initialBalance) || 0;
    });

    const defaultAccId = userSettings.accounts[0].id;

    dailyLogs.forEach(log => {
        const amt = Number(log.amount) || 0;
        const srcId = log.accountId || defaultAccId;

        if (log.type === 'PEMASUKAN') {
            if (Object.prototype.hasOwnProperty.call(balances, srcId)) balances[srcId] += amt;
            else balances[defaultAccId] += amt;
        } else if (log.type === 'PENGELUARAN') {
            if (!String(srcId).startsWith('GOAL_')) {
                if (Object.prototype.hasOwnProperty.call(balances, srcId)) balances[srcId] -= amt;
                else balances[defaultAccId] -= amt;
            }
        } else if (log.type === 'TABUNGAN_GOAL') {
            if (Object.prototype.hasOwnProperty.call(balances, srcId)) balances[srcId] -= amt;
            else balances[defaultAccId] -= amt;
        }
    });

    return balances;
}

function getAccountNameById(accId) {
    if (!accId) return userSettings.accounts[0]?.name || 'Kas Utama';
    if (String(accId).startsWith('GOAL_')) {
        const gid = parseInt(String(accId).replace('GOAL_', ''), 10);
        const g = goals.find(x => x.id === gid);
        return g ? `Impian: ${g.name}` : 'Tabungan Impian';
    }
    const found = userSettings.accounts.find(a => a.id === accId);
    return found ? found.name : (userSettings.accounts[0]?.name || 'Kas Utama');
}

// =========================================================================
// 6. DATA PERSISTENCE & VERIFIED CLOUD SYNC ENGINE
// =========================================================================
function initApp() {
    initTheme();
    localStorage.removeItem('mona_user_session');
    localStorage.removeItem('mona_registered_accounts');

    const todayObj = new Date();
    const todayStr = todayObj.toISOString().split('T')[0];
    document.getElementById('dailyDate').value = todayStr;
    document.getElementById('filterMonthVal').value = todayStr.substring(0, 7);

    const weekNum = getISOWeekNumber(todayObj);
    document.getElementById('filterWeekVal').value = `${todayObj.getFullYear()}-W${weekNum < 10 ? '0' + weekNum : weekNum}`;
    document.getElementById('filterStartDate').value = todayStr.substring(0, 8) + '01';
    document.getElementById('filterEndDate').value = todayStr;

    if (isFirebaseActive && auth) {
        auth.onAuthStateChanged(async (firebaseUser) => {
            if (firebaseUser) {
                const email = firebaseUser.email || '';
                const extractedUsername = cleanAlphaNum(email.split('@')[0]);
                currentUser = {
                    uid: firebaseUser.uid,
                    username: extractedUsername,
                    nickname: normalizePlainText(firebaseUser.displayName, 32) || extractedUsername
                };
                updateAuthUI('syncing');
                setupFirestoreSync();
            } else {
                if (unsubscribeFirestore) {
                    unsubscribeFirestore();
                    unsubscribeFirestore = null;
                }
                currentUser = null;
                updateAuthUI('offline');
                loadLocalData();
            }
        });
    } else {
        loadLocalData();
    }
}

function loadLocalData() {
    try {
        const rawGoals = JSON.parse(localStorage.getItem('mona_goals_v14') || localStorage.getItem('mona_goals_v13') || '[]');
        const rawLogs = JSON.parse(localStorage.getItem('mona_daily_logs_v14') || localStorage.getItem('mona_daily_logs_v13') || '[]');
        const rawSettings = JSON.parse(localStorage.getItem('mona_settings_v14') || localStorage.getItem('mona_settings_v13') || 'null');

        goals = Array.isArray(rawGoals) ? rawGoals.map((g, i) => sanitizeGoalObject(g, i)).filter(Boolean) : [];
        dailyLogs = Array.isArray(rawLogs) ? rawLogs.map((l, i) => sanitizeLogObject(l, i)).filter(Boolean) : [];
        userSettings = sanitizeSettingsObject(rawSettings);
    } catch (e) {
        goals = [];
        dailyLogs = [];
        userSettings = sanitizeSettingsObject(null);
    }
    ensureDefaultAccount();
    refreshAllViews();
}

function persistLocalCache() {
    const prefix = currentUser ? `mona_uid_${currentUser.uid}_` : 'mona_';
    localStorage.setItem(`${prefix}goals_v14`, JSON.stringify(goals));
    localStorage.setItem(`${prefix}daily_logs_v14`, JSON.stringify(dailyLogs));
    localStorage.setItem(`${prefix}settings_v14`, JSON.stringify(userSettings));
}

async function saveData() {
    persistLocalCache();

    if (currentUser && isFirebaseActive && db && auth && auth.currentUser) {
        if (isSyncInProgress) return true;
        isSyncInProgress = true;
        updateAuthUI('syncing');
        try {
            await db.collection('users').doc(auth.currentUser.uid).set({
                nickname: normalizePlainText(currentUser.nickname, 32),
                                                                       username: cleanAlphaNum(currentUser.username),
                                                                       goals: goals,
                                                                       dailyLogs: dailyLogs,
                                                                       userSettings: userSettings,
                                                                       updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            updateAuthUI('online');
            return true;
        } catch (err) {
            console.error('Gagal menyinkronkan ke Firestore:', err);
            updateAuthUI('error');
            return false;
        } finally {
            isSyncInProgress = false;
        }
    }
    return true;
}

function setupFirestoreSync() {
    if (!currentUser || !isFirebaseActive || !db || !auth || !auth.currentUser) return;
    if (unsubscribeFirestore) unsubscribeFirestore();

    const uid = auth.currentUser.uid;
    unsubscribeFirestore = db.collection('users').doc(uid).onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data() || {};
            if (typeof data.nickname === 'string' && data.nickname.trim()) {
                currentUser.nickname = normalizePlainText(data.nickname, 32);
            }
            if (typeof data.username === 'string' && data.username.trim()) {
                currentUser.username = cleanAlphaNum(data.username);
            }
            goals = Array.isArray(data.goals) ? data.goals.map((g, i) => sanitizeGoalObject(g, i)).filter(Boolean) : [];
            dailyLogs = Array.isArray(data.dailyLogs) ? data.dailyLogs.map((l, i) => sanitizeLogObject(l, i)).filter(Boolean) : [];
            userSettings = sanitizeSettingsObject(data.userSettings);
            ensureDefaultAccount();
            persistLocalCache();
            updateAuthUI('online');
            refreshAllViews();
        } else {
            // Inisialisasi dokumen perdana jika akun baru dibuat
            saveData().then(() => refreshAllViews());
        }
    }, (error) => {
        console.error('Firestore listener error:', error);
        updateAuthUI('error');
    });
}

function refreshAllViews() {
    renderAvatarUI();
    updateTransactionFormOptions();
    renderGoals();
    renderDailyLogs();
    updateAllCalculations();
}

// =========================================================================
// 7. PROFIL, AVATAR UPLOAD, MULTI-TABUNGAN & FIREBASE AUTHENTICATION
// =========================================================================
function switchProfileSection(sec) {
    ['ACCOUNT', 'SAVINGS', 'LIMITS'].forEach(key => {
        const tabEl = document.getElementById(`profTab${key.charAt(0) + key.slice(1).toLowerCase()}`);
        const secEl = document.getElementById(`profSection${key.charAt(0) + key.slice(1).toLowerCase()}`);
        if (tabEl) tabEl.classList.toggle('active', key === sec);
        if (secEl) secEl.style.display = (key === sec) ? 'block' : 'none';
    });

        if (sec === 'SAVINGS') renderSavingsAccountManager();
        if (sec === 'LIMITS') {
            document.getElementById('inputDailyLimit').value = userSettings.dailyLimit ? userSettings.dailyLimit.toLocaleString('id-ID') : '';
            document.getElementById('inputMonthlyLimit').value = userSettings.monthlyLimit ? userSettings.monthlyLimit.toLocaleString('id-ID') : '';
        }
}

function switchAuthMode(mode) {
    const tabLogin = document.getElementById('tabSwitchLogin');
    const tabReg = document.getElementById('tabSwitchRegister');
    const formLogin = document.getElementById('formLoginMode');
    const formReg = document.getElementById('formRegisterMode');

    tabLogin.classList.toggle('active', mode === 'LOGIN');
    tabReg.classList.toggle('active', mode === 'REGISTER');
    formLogin.style.display = (mode === 'LOGIN') ? 'block' : 'none';
    formReg.style.display = (mode === 'REGISTER') ? 'block' : 'none';
}

function openProfileModal(targetTab = 'ACCOUNT') {
    document.getElementById('loginNickname').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('regUsername').value = '';
    document.getElementById('regNickname').value = '';
    document.getElementById('regPassword').value = '';
    if (document.getElementById('oldPasswordForChange')) document.getElementById('oldPasswordForChange').value = '';
    if (document.getElementById('newPasswordInput')) document.getElementById('newPasswordInput').value = '';
    if (document.getElementById('oldPasswordForDelete')) document.getElementById('oldPasswordForDelete').value = '';
    document.getElementById('avatarUploadMsg').textContent = '';

    switchAuthMode('LOGIN');
    renderAvatarUI();

    if (currentUser) {
        document.getElementById('authFormSection').style.display = 'none';
        document.getElementById('authLoggedInSection').style.display = 'block';
        document.getElementById('loggedInUserText').textContent = `${normalizePlainText(currentUser.nickname, 32)} (@${cleanAlphaNum(currentUser.username)})`;
    } else {
        document.getElementById('authFormSection').style.display = 'block';
        document.getElementById('authLoggedInSection').style.display = 'none';
    }

    switchProfileSection(targetTab === 'TAB_ACCOUNTS' ? 'SAVINGS' : (targetTab === 'LIMITS' ? 'LIMITS' : 'ACCOUNT'));
    document.getElementById('profileModal').classList.add('active');
}

function closeProfileModal() {
    document.getElementById('profileModal').classList.remove('active');
}

async function handleSecureAvatarUpload(event) {
    const file = event.target.files && event.target.files[0];
    const msgEl = document.getElementById('avatarUploadMsg');
    if (!file) return;

    msgEl.style.color = 'var(--text-secondary)';
    msgEl.textContent = 'Memeriksa integritas biner & dimensi berkas...';

    const check = await inspectImageMagicBytes(file);
    if (!check.valid) {
        msgEl.style.color = 'var(--accent-rose)';
        msgEl.textContent = check.reason;
        event.target.value = '';
        return;
    }

    try {
        const cleanDataUrl = await sanitizeAndCompressAvatar(file, check.mime);
        userSettings.avatarDataUrl = cleanDataUrl;
        const ok = await saveData();
        renderAvatarUI();
        if (ok) {
            msgEl.style.color = 'var(--accent-green)';
            msgEl.textContent = 'Foto profil berhasil diverifikasi dan diperbarui.';
        } else {
            msgEl.style.color = 'var(--accent-amber)';
            msgEl.textContent = 'Foto tersimpan lokal, namun sinkronisasi cloud tertunda.';
        }
    } catch (err) {
        msgEl.style.color = 'var(--accent-rose)';
        msgEl.textContent = err.message || 'File gambar ditolak.';
    }
    event.target.value = '';
}

async function removeProfileAvatar() {
    userSettings.avatarDataUrl = '';
    await saveData();
    renderAvatarUI();
    document.getElementById('avatarUploadMsg').textContent = 'Foto profil dihapus.';
}

function renderAvatarUI() {
    const dataUrl = userSettings.avatarDataUrl;
    const hImg = document.getElementById('headerAvatarImg');
    const hDef = document.getElementById('headerAvatarDefault');
    const mImg = document.getElementById('modalAvatarImg');
    const mDef = document.getElementById('modalAvatarDefault');
    const btnRem = document.getElementById('btnRemoveAvatar');

    if (dataUrl && /^data:image\/(png|jpeg);base64,/.test(dataUrl)) {
        if (hImg) { hImg.src = dataUrl; hImg.style.display = 'block'; }
        if (hDef) hDef.style.display = 'none';
        if (mImg) { mImg.src = dataUrl; mImg.style.display = 'block'; }
        if (mDef) mDef.style.display = 'none';
        if (btnRem) btnRem.style.display = 'inline-flex';
    } else {
        if (hImg) { hImg.src = ''; hImg.style.display = 'none'; }
        if (hDef) hDef.style.display = 'block';
        if (mImg) { mImg.src = ''; mImg.style.display = 'none'; }
        if (mDef) mDef.style.display = 'block';
        if (btnRem) btnRem.style.display = 'none';
    }
}

async function handleSavingsModeChange() {
    const mode = document.getElementById('savingsModeSelect').value;
    userSettings.savingsMode = (mode === 'MULTI') ? 'MULTI' : 'SINGLE';
    await saveData();
    renderSavingsAccountManager();
    updateTransactionFormOptions();
    updateAllCalculations();
}

function renderSavingsAccountManager() {
    ensureDefaultAccount();
    const modeSelect = document.getElementById('savingsModeSelect');
    const descEl = document.getElementById('savingsModeDesc');
    const listEl = document.getElementById('accountsManageList');
    const addBox = document.getElementById('addAccountFormBox');

    modeSelect.value = userSettings.savingsMode || 'SINGLE';
    const isMulti = userSettings.savingsMode === 'MULTI';

    descEl.textContent = isMulti
    ? 'Mode Multi Tabungan aktif: Anda dapat mencatat dan melacak sisa saldo pada berbagai bank digital, bank konvensional, e-wallet, maupun tunai secara terpisah.'
    : 'Mode Single Tabungan aktif: Seluruh arus kas dipusatkan pada satu rekening utama.';

    addBox.style.display = isMulti ? 'block' : 'none';
    const balances = calculateAccountBalances();
    const visibleAccounts = isMulti ? userSettings.accounts : [userSettings.accounts[0]];

    listEl.textContent = '';
    visibleAccounts.forEach((acc) => {
        const bal = balances[acc.id] || 0;
        const canDelete = isMulti && userSettings.accounts.length > 1;

        const itemDiv = document.createElement('div');
        itemDiv.className = 'account-manage-item';

        const infoDiv = document.createElement('div');
        const typeDiv = document.createElement('div');
        typeDiv.style.cssText = 'font-size:0.68rem; color:var(--text-muted); font-weight:600;';
        typeDiv.textContent = acc.type;

        const nameDiv = document.createElement('div');
        nameDiv.style.cssText = 'font-size:0.84rem; font-weight:700;';
        nameDiv.textContent = acc.name;

        const balDiv = document.createElement('div');
        balDiv.style.cssText = 'font-size:0.78rem; color:var(--accent-blue); font-weight:700;';
        balDiv.textContent = `Saldo Saat Ini: ${formatRupiah(bal)}`;

        infoDiv.append(typeDiv, nameDiv, balDiv);

        const actionsDiv = document.createElement('div');
        actionsDiv.style.cssText = 'display:flex; gap:5px;';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn-blue';
        editBtn.style.cssText = 'padding:4px 8px; min-height:28px; font-size:0.72rem;';
        editBtn.textContent = 'Ubah';
        editBtn.addEventListener('click', () => promptEditAccountName(acc.id));
        actionsDiv.appendChild(editBtn);

        if (canDelete) {
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn-rose';
            delBtn.style.cssText = 'padding:4px 8px; min-height:28px; font-size:0.72rem;';
            delBtn.textContent = 'Hapus';
            delBtn.addEventListener('click', () => deleteSavingsAccount(acc.id));
            actionsDiv.appendChild(delBtn);
        }

        itemDiv.append(infoDiv, actionsDiv);
        listEl.appendChild(itemDiv);
    });
}

async function handleAddSavingsAccount() {
    const name = normalizePlainText(document.getElementById('newAccName').value, 30);
    const type = normalizePlainText(document.getElementById('newAccType').value, 30);
    const initialBalance = parseMoneyInput(document.getElementById('newAccBalance').value);

    if (!name) {
        alert('Nama media tabungan wajib diisi!');
        return;
    }

    userSettings.accounts.push({
        id: 'acc_' + Date.now(),
                               name,
                               type,
                               initialBalance
    });

    document.getElementById('newAccName').value = '';
    document.getElementById('newAccBalance').value = '';
    await saveData();
    renderSavingsAccountManager();
    updateTransactionFormOptions();
    updateAllCalculations();
}

async function promptEditAccountName(accId) {
    const acc = userSettings.accounts.find(a => a.id === accId);
    if (!acc) return;
    const newName = prompt('Ubah nama media tabungan:', acc.name);
    const cleanNew = newName !== null ? normalizePlainText(newName, 30) : '';
    if (cleanNew) {
        acc.name = cleanNew;
        await saveData();
        renderSavingsAccountManager();
        updateTransactionFormOptions();
        updateAllCalculations();
    }
}

async function deleteSavingsAccount(accId) {
    if (userSettings.accounts.length <= 1) return;
    if (!confirm('Hapus media tabungan ini? Riwayat transaksi lama akan dialihkan ke rekening utama.')) return;
    userSettings.accounts = userSettings.accounts.filter(a => a.id !== accId);
    await saveData();
    renderSavingsAccountManager();
    updateTransactionFormOptions();
    updateAllCalculations();
}

async function handleSaveSpendingLimits() {
    userSettings.dailyLimit = parseMoneyInput(document.getElementById('inputDailyLimit').value);
    userSettings.monthlyLimit = parseMoneyInput(document.getElementById('inputMonthlyLimit').value);
    const ok = await saveData();
    updateAllCalculations();
    alert(ok ? 'Batas pengeluaran harian dan bulanan berhasil disimpan.' : 'Tersimpan lokal, namun gagal menyinkronkan ke cloud.');
}

// =========================================================================
// FIREBASE AUTHENTICATION (USERNAME -> INTERNAL EMAIL ALIAS)
// =========================================================================
async function handleAuthRegister() {
    if (!isFirebaseActive || !auth) {
        alert('Layanan sinkronisasi cloud sedang tidak aktif.');
        return;
    }

    const username = cleanAlphaNum(document.getElementById('regUsername').value);
    const nickname = normalizePlainText(document.getElementById('regNickname').value, 32);
    const rawPass = document.getElementById('regPassword').value;

    if (!username || username.length < 4) {
        alert('Username wajib diisi minimal 4 karakter (huruf, angka, garis bawah, atau tanda hubung).');
        return;
    }
    if (!nickname) {
        alert('Nama tampilan wajib diisi.');
        return;
    }
    if (!validateStrongPassword(rawPass)) {
        alert('Password wajib minimal 6 karakter dengan kombinasi huruf dan angka.');
        return;
    }

    const internalEmail = usernameToInternalEmail(username);
    const btn = document.getElementById('btnSubmitRegister');
    if (btn) btn.disabled = true;

    try {
        const cred = await auth.createUserWithEmailAndPassword(internalEmail, rawPass);
        await cred.user.updateProfile({ displayName: nickname });

        currentUser = {
            uid: cred.user.uid,
            username,
            nickname
        };

        await saveData();
        closeProfileModal();
        alert(`Akun ${nickname} (@${username}) berhasil didaftarkan dan tersinkronisasi aman.`);
    } catch (err) {
        if (err.code === 'auth/email-already-in-use') {
            alert('Username telah digunakan. Silakan pilih username lain.');
        } else if (err.code === 'auth/weak-password') {
            alert('Password terlalu lemah. Gunakan minimal 6 karakter kombinasi huruf dan angka.');
        } else {
            alert('Gagal melakukan registrasi: ' + (err.message || 'Terjadi kesalahan.'));
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function handleAuthLogin() {
    if (!isFirebaseActive || !auth) {
        alert('Layanan sinkronisasi cloud sedang tidak aktif.');
        return;
    }

    const rawUsername = document.getElementById('loginNickname').value;
    const rawPass = document.getElementById('loginPassword').value;
    const username = cleanAlphaNum(rawUsername);

    if (!username || !rawPass) {
        alert('Mohon isi Username dan Password.');
        return;
    }

    const internalEmail = usernameToInternalEmail(username);
    const btn = document.getElementById('btnSubmitLogin');
    if (btn) btn.disabled = true;

    try {
        await auth.signInWithEmailAndPassword(internalEmail, rawPass);
        closeProfileModal();
    } catch (err) {
        if (err.code === 'auth/too-many-requests') {
            alert('Terlalu banyak percobaan login gagal. Silakan tunggu beberapa menit sebelum mencoba lagi.');
        } else {
            alert('Username atau Password tidak sesuai.');
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function handleChangePassword() {
    if (!currentUser || !auth || !auth.currentUser) return;

    const oldPass = document.getElementById('oldPasswordForChange').value;
    const newPass = document.getElementById('newPasswordInput').value;

    if (!oldPass) {
        alert('Masukkan password lama untuk verifikasi.');
        return;
    }
    if (!validateStrongPassword(newPass)) {
        alert('Password baru wajib minimal 6 karakter dengan kombinasi huruf dan angka.');
        return;
    }

    const btn = document.getElementById('btnSubmitChangePassword');
    if (btn) btn.disabled = true;

    try {
        const credential = firebase.auth.EmailAuthProvider.credential(auth.currentUser.email, oldPass);
        await auth.currentUser.reauthenticateWithCredential(credential);
        await auth.currentUser.updatePassword(newPass);

        document.getElementById('oldPasswordForChange').value = '';
        document.getElementById('newPasswordInput').value = '';
        alert('Password akun berhasil diperbarui dengan aman.');
    } catch (err) {
        if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
            alert('Verifikasi Gagal: Password lama yang Anda masukkan tidak sesuai.');
        } else {
            alert('Gagal memperbarui password: ' + (err.message || 'Terjadi kesalahan.'));
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function handleAuthLogout() {
    if (unsubscribeFirestore) {
        unsubscribeFirestore();
        unsubscribeFirestore = null;
    }
    if (auth) {
        await auth.signOut();
    }
    currentUser = null;
    updateAuthUI('offline');
    closeProfileModal();
    loadLocalData();
}

async function handleResetAppData() {
    if (!confirm('PERINGATAN: Seluruh riwayat transaksi dan target impian akan dikosongkan. Lanjutkan?')) return;
    goals = [];
    dailyLogs = [];
    userSettings.accounts.forEach(a => a.initialBalance = 0);
    await saveData();
    refreshAllViews();
    closeProfileModal();
    alert('Seluruh data mutasi berhasil di-reset.');
}

async function handleDeleteAccount() {
    if (!currentUser || !auth || !auth.currentUser || !db) return;

    const confirmOldPass = document.getElementById('oldPasswordForDelete').value;
    if (!confirmOldPass) {
        alert('Masukkan password lama Anda pada kolom konfirmasi untuk menghapus akun.');
        return;
    }

    if (!confirm(`KONFIRMASI AKHIR: Akun @${currentUser.username} beserta seluruh data keuangan akan dihapus permanen. Lanjutkan?`)) return;

    const btn = document.getElementById('btnDeleteAccount');
    if (btn) btn.disabled = true;

    try {
        const user = auth.currentUser;
        const uid = user.uid;

        const credential = firebase.auth.EmailAuthProvider.credential(user.email, confirmOldPass);
        await user.reauthenticateWithCredential(credential);

        if (unsubscribeFirestore) {
            unsubscribeFirestore();
            unsubscribeFirestore = null;
        }

        // Hapus dokumen Firestore terlebih dahulu saat sesi terautentikasi masih aktif
        await db.collection('users').doc(uid).delete();

        // Hapus akun Firebase Authentication
        await user.delete();

        localStorage.removeItem(`mona_uid_${uid}_goals_v14`);
        localStorage.removeItem(`mona_uid_${uid}_daily_logs_v14`);
        localStorage.removeItem(`mona_uid_${uid}_settings_v14`);

        goals = [];
        dailyLogs = [];
        currentUser = null;
        updateAuthUI('offline');
        closeProfileModal();
        loadLocalData();
        alert('Akun dan seluruh data Anda telah dihapus secara permanen.');
    } catch (err) {
        if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
            alert('Verifikasi Gagal: Password lama salah. Penghapusan akun dibatalkan.');
        } else {
            alert('Gagal menghapus akun: ' + (err.message || 'Terjadi kesalahan.'));
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}

function updateAuthUI(status = 'offline') {
    const dot = document.getElementById('syncStatusDot');
    const statusText = document.getElementById('userStatusText');
    const pdfOwner = document.getElementById('pdfPrintOwner');

    if (currentUser) {
        const nick = normalizePlainText(currentUser.nickname, 32);
        const uname = cleanAlphaNum(currentUser.username);
        if (status === 'error') {
            dot.classList.remove('online');
            statusText.textContent = `${nick} (Gagal Sinkron)`;
        } else if (status === 'syncing') {
            dot.classList.add('online');
            statusText.textContent = `${nick} (Menyinkronkan...)`;
        } else {
            dot.classList.add('online');
            statusText.textContent = `${nick} (Online)`;
        }
        if (pdfOwner) pdfOwner.textContent = `${nick} (@${uname})`;
    } else {
        dot.classList.remove('online');
        statusText.textContent = 'Offline (Modus Lokal)';
        if (pdfOwner) pdfOwner.textContent = 'Pengguna Lokal';
    }
}

// =========================================================================
// 8. UI NAVIGATION & DYNAMIC FORM SELECTORS
// =========================================================================
function switchTab(tabId, btnElem) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    if (btnElem) btnElem.classList.add('active');
    const target = document.getElementById(tabId);
    if (target) target.classList.add('active');
}

function toggleFilterModeControls() {
    const mode = document.getElementById('timeFilterMode').value;
    document.getElementById('ctrlMonthGroup').style.display = (mode === 'MONTHLY') ? 'block' : 'none';
    document.getElementById('ctrlWeekGroup').style.display = (mode === 'WEEKLY') ? 'block' : 'none';
    document.getElementById('ctrlRangeStartGroup').style.display = (mode === 'RANGE') ? 'block' : 'none';
    document.getElementById('ctrlRangeEndGroup').style.display = (mode === 'RANGE') ? 'block' : 'none';
    updateAllCalculations();
}

function populateAccountSourceSelect(selectElem, type, selectedVal = '') {
    if (!selectElem) return;
    ensureDefaultAccount();
    const isMulti = userSettings.savingsMode === 'MULTI';
    const visibleAccounts = isMulti ? userSettings.accounts : [userSettings.accounts[0]];
    const balances = calculateAccountBalances();

    selectElem.textContent = '';

    const mainGroup = document.createElement('optgroup');
    mainGroup.label = 'Media Tabungan Utama';
    visibleAccounts.forEach(acc => {
        const opt = document.createElement('option');
        opt.value = acc.id;
        opt.textContent = `${acc.name} (${formatRupiah(balances[acc.id] || 0, false)})`;
        mainGroup.appendChild(opt);
    });
    selectElem.appendChild(mainGroup);

    if (type === 'PENGELUARAN' && goals.length > 0) {
        const goalGroup = document.createElement('optgroup');
        goalGroup.label = 'Tarik Dana Darurat dari Tabungan Impian';
        goals.forEach(g => {
            const opt = document.createElement('option');
            opt.value = `GOAL_${g.id}`;
            opt.textContent = `Impian: ${g.name} (Saldo: ${formatRupiah(g.current, false)})`;
            goalGroup.appendChild(opt);
        });
        selectElem.appendChild(goalGroup);
    }

    if (selectedVal) selectElem.value = selectedVal;
}

function populateCategorySelect(selectElem, type, selectedVal = '') {
    if (!selectElem) return;
    selectElem.textContent = '';

    if (type === 'PEMASUKAN') {
        const items = [
            ['Gaji & Pendapatan', 'Gaji & Pendapatan Utama'],
            ['Honor & Lembur', 'Honor, Lembur & Proyek'],
            ['Bonus & Inisiatif', 'Bonus & Tunjangan'],
            ['Pemasukan Lainnya', 'Pemasukan Lainnya']
        ];
        items.forEach(([val, label]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            selectElem.appendChild(opt);
        });
    } else if (type === 'PENGELUARAN') {
        const items = [
            ['Makan & Dapur', 'Konsumsi & Makan'],
            ['Transportasi', 'Transportasi & BBM'],
            ['Kost & Utilitas', 'Tempat Tinggal, Air & Listrik'],
            ['Kuota Internet', 'Internet & Komunikasi'],
            ['Kebutuhan Harian', 'Operasional & Kebutuhan Harian'],
            ['Kebutuhan Darurat', 'Kebutuhan Darurat / Tak Terduga'],
            ['Lainnya', 'Pengeluaran Lainnya']
        ];
        items.forEach(([val, label]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            selectElem.appendChild(opt);
        });
    } else if (type === 'TABUNGAN_GOAL') {
        if (goals.length === 0) {
            const opt = document.createElement('option');
            opt.value = 'GOAL_NONE';
            opt.textContent = '-- Buat Tabungan Impian Terlebih Dahulu --';
            selectElem.appendChild(opt);
        } else {
            goals.forEach(g => {
                const opt = document.createElement('option');
                opt.value = `GOAL_${g.id}`;
                opt.textContent = `Impian: ${g.name} (Simpan di ${g.storeIn || 'Kas'})`;
                selectElem.appendChild(opt);
            });
        }
    }

    if (selectedVal) selectElem.value = selectedVal;
}

function updateTransactionFormOptions() {
    const type = document.getElementById('dailyType').value;
    const lblAcc = document.getElementById('lblDailyAccount');
    if (type === 'PEMASUKAN') lblAcc.textContent = 'Masuk ke Media Tabungan';
    else if (type === 'TABUNGAN_GOAL') lblAcc.textContent = 'Ambil dari Sumber Tabungan';
    else lblAcc.textContent = 'Sumber Dana Pengeluaran';

    populateAccountSourceSelect(document.getElementById('dailyAccountSource'), type);
    populateCategorySelect(document.getElementById('dailyCategory'), type);
}

function updateEditTransactionFormOptions(selectedAcc = '', selectedCat = '') {
    const type = document.getElementById('editLogType').value;
    populateAccountSourceSelect(document.getElementById('editLogAccountSource'), type, selectedAcc);
    populateCategorySelect(document.getElementById('editLogCategory'), type, selectedCat);
}

// =========================================================================
// 9. TRANSACTION MUTATION HANDLERS
// =========================================================================
async function handleDailySubmit(e) {
    e.preventDefault();
    const date = document.getElementById('dailyDate').value;
    const type = document.getElementById('dailyType').value;
    const accountId = document.getElementById('dailyAccountSource').value;
    const category = document.getElementById('dailyCategory').value;
    const title = normalizePlainText(document.getElementById('dailyTitle').value, 80);
    const amount = parseMoneyInput(document.getElementById('dailyAmount').value);
    const notes = normalizePlainText(document.getElementById('dailyNotes').value, 120);

    if (!isValidIsoDate(date) || !title || amount <= 0) {
        alert('Mohon lengkapi tanggal, deskripsi, dan nominal transaksi yang valid.');
        return;
    }

    if (type === 'TABUNGAN_GOAL') {
        if (!category || category === 'GOAL_NONE') {
            alert('Silakan buat Tabungan Impian terlebih dahulu di tab Tabungan Impian.');
            return;
        }
        const goalId = parseInt(category.replace('GOAL_', ''), 10);
        const goal = goals.find(g => g.id === goalId);
        if (goal) {
            goal.current = (Number(goal.current) || 0) + amount;
        }
    } else if (type === 'PENGELUARAN' && String(accountId).startsWith('GOAL_')) {
        const goalId = parseInt(String(accountId).replace('GOAL_', ''), 10);
        const goal = goals.find(g => g.id === goalId);
        if (goal) {
            if (amount > goal.current) {
                if (!confirm(`Saldo tabungan impian "${goal.name}" hanya ${formatRupiah(goal.current, false)}. Tetap kurangi hingga Rp0?`)) {
                    return;
                }
            }
            goal.current = Math.max(0, (Number(goal.current) || 0) - amount);
        }
    }

    dailyLogs.unshift(sanitizeLogObject({
        id: Date.now(),
                                        date,
                                        type,
                                        accountId,
                                        category,
                                        title,
                                        amount,
                                        notes
    }));

    await saveData();
    refreshAllViews();

    document.getElementById('dailyTitle').value = '';
    document.getElementById('dailyAmount').value = '';
    document.getElementById('dailyNotes').value = '';
}

function revertLogEffectOnGoals(log) {
    if (!log) return;
    const amt = Number(log.amount) || 0;
    if (log.type === 'TABUNGAN_GOAL' && String(log.category).startsWith('GOAL_')) {
        const gid = parseInt(String(log.category).replace('GOAL_', ''), 10);
        const g = goals.find(x => x.id === gid);
        if (g) g.current = Math.max(0, (Number(g.current) || 0) - amt);
    } else if (log.type === 'PENGELUARAN' && String(log.accountId).startsWith('GOAL_')) {
        const gid = parseInt(String(log.accountId).replace('GOAL_', ''), 10);
        const g = goals.find(x => x.id === gid);
        if (g) g.current = (Number(g.current) || 0) + amt;
    }
}

function openEditLogModal(id) {
    const log = dailyLogs.find(l => l.id === id);
    if (!log) return;

    document.getElementById('editLogId').value = log.id;
    document.getElementById('editLogDate').value = log.date;
    document.getElementById('editLogType').value = log.type;
    updateEditTransactionFormOptions(log.accountId, log.category);
    document.getElementById('editLogTitle').value = log.title;
    document.getElementById('editLogAmount').value = log.amount ? log.amount.toLocaleString('id-ID') : '';
    document.getElementById('editLogNotes').value = log.notes || '';
    document.getElementById('editLogModal').classList.add('active');
}

function closeEditLogModal() {
    document.getElementById('editLogModal').classList.remove('active');
}

async function saveEditLogModal() {
    const id = parseInt(document.getElementById('editLogId').value, 10);
    const idx = dailyLogs.findIndex(l => l.id === id);
    if (idx === -1) return;

    revertLogEffectOnGoals(dailyLogs[idx]);

    const date = document.getElementById('editLogDate').value;
    const type = document.getElementById('editLogType').value;
    const accountId = document.getElementById('editLogAccountSource').value;
    const category = document.getElementById('editLogCategory').value;
    const title = normalizePlainText(document.getElementById('editLogTitle').value, 80);
    const amount = parseMoneyInput(document.getElementById('editLogAmount').value);
    const notes = normalizePlainText(document.getElementById('editLogNotes').value, 120);

    if (!isValidIsoDate(date) || !title || amount <= 0) {
        alert('Mohon lengkapi data perubahan transaksi dengan benar.');
        return;
    }

    if (type === 'TABUNGAN_GOAL' && String(category).startsWith('GOAL_')) {
        const gid = parseInt(String(category).replace('GOAL_', ''), 10);
        const g = goals.find(x => x.id === gid);
        if (g) g.current = (Number(g.current) || 0) + amount;
    } else if (type === 'PENGELUARAN' && String(accountId).startsWith('GOAL_')) {
        const gid = parseInt(String(accountId).replace('GOAL_', ''), 10);
        const g = goals.find(x => x.id === gid);
        if (g) g.current = Math.max(0, (Number(g.current) || 0) - amount);
    }

    dailyLogs[idx] = sanitizeLogObject({ id, date, type, accountId, category, title, amount, notes });
    await saveData();
    refreshAllViews();
    closeEditLogModal();
}

async function deleteDailyLog(id) {
    if (!confirm('Hapus catatan mutasi ini?')) return;
    const log = dailyLogs.find(l => l.id === id);
    revertLogEffectOnGoals(log);
    dailyLogs = dailyLogs.filter(l => l.id !== id);
    await saveData();
    refreshAllViews();
}

function getFilteredLogs() {
    const mode = document.getElementById('timeFilterMode').value;
    const monthVal = document.getElementById('filterMonthVal').value;
    const weekVal = document.getElementById('filterWeekVal').value;
    const startVal = document.getElementById('filterStartDate').value;
    const endVal = document.getElementById('filterEndDate').value;

    return dailyLogs.filter(log => {
        const logDateStr = isValidIsoDate(log.date) ? log.date : '';
        if (!logDateStr) return false;
        if (mode === 'ALL') return true;
        if (mode === 'MONTHLY') return monthVal ? logDateStr.startsWith(monthVal) : true;
        if (mode === 'WEEKLY') {
            if (!weekVal) return true;
            const parts = weekVal.split('-W');
            const startDate = getDateFromISOWeek(parseInt(parts[1], 10), parseInt(parts[0], 10));
            const endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 6);
            const logDate = new Date(logDateStr);
            return logDate >= startDate && logDate <= endDate;
        }
        if (mode === 'RANGE') {
            if (startVal && logDateStr < startVal) return false;
            if (endVal && logDateStr > endVal) return false;
            return true;
        }
        return true;
    });
}

function getTagClass(type, cat) {
    if (type === 'PEMASUKAN') return 'tag-pemasukan';
    if (type === 'TABUNGAN_GOAL') return 'tag-tabungan';
    if (cat.includes('Makan')) return 'tag-makan';
    if (cat.includes('Transport')) return 'tag-transport';
    if (cat.includes('Darurat')) return 'tag-transport';
    if (cat.includes('Kost')) return 'tag-kost';
    return 'tag-lainnya';
}

function renderDailyLogs() {
    const tableBody = document.getElementById('dailyLogsTableBody');
    tableBody.textContent = '';
    const selectedType = document.getElementById('dailyFilterType').value;
    let filtered = getFilteredLogs();

    if (selectedType !== 'ALL') filtered = filtered.filter(l => l.type === selectedType);

    if (filtered.length === 0) {
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.colSpan = 4;
        emptyCell.className = 'text-center';
        emptyCell.style.cssText = 'color:var(--text-secondary); padding:16px;';
        emptyCell.textContent = 'Tidak ada data mutasi pada periode ini.';
        emptyRow.appendChild(emptyCell);
        tableBody.appendChild(emptyRow);
        return;
    }

    filtered.forEach(log => {
        const tagClass = getTagClass(log.type, log.category || '');
        let displayCat = log.category;
        if (String(log.category).startsWith('GOAL_')) {
            const gid = parseInt(String(log.category).replace('GOAL_', ''), 10);
            const g = goals.find(x => x.id === gid);
            displayCat = g ? `Impian: ${g.name}` : 'Alokasi Impian';
        }

        const mediaName = getAccountNameById(log.accountId);
        const dParts = isValidIsoDate(log.date) ? log.date.split('-') : [];
        const shortDate = dParts.length === 3 ? `${dParts[2]}/${dParts[1]}` : '-';

        const tr = document.createElement('tr');

        // Kolom Tanggal
        const tdDate = document.createElement('td');
        tdDate.style.cssText = 'white-space:nowrap; color:var(--text-secondary); font-size:0.75rem;';
        const strongDate = document.createElement('strong');
        strongDate.textContent = shortDate;
        tdDate.appendChild(strongDate);

        // Kolom Deskripsi
        const tdInfo = document.createElement('td');
        tdInfo.className = 'item-info-cell';

        const rowTop = document.createElement('div');
        rowTop.className = 'item-title-row';

        const spanCat = document.createElement('span');
        spanCat.className = `badge-tag ${tagClass}`;
        spanCat.textContent = displayCat;

        const spanMedia = document.createElement('span');
        spanMedia.className = 'badge-tag tag-media';
        spanMedia.textContent = mediaName;

        rowTop.append(spanCat, spanMedia);

        const titleDiv = document.createElement('div');
        titleDiv.className = 'item-title-text';
        titleDiv.style.marginTop = '2px';
        titleDiv.textContent = log.title;

        tdInfo.append(rowTop, titleDiv);

        if (log.notes) {
            const notesDiv = document.createElement('div');
            notesDiv.className = 'item-meta';
            notesDiv.textContent = log.notes;
            tdInfo.appendChild(notesDiv);
        }

        // Kolom Nominal
        const tdAmt = document.createElement('td');
        tdAmt.className = 'text-right font-bold';
        const colorVar = log.type === 'PEMASUKAN'
        ? 'var(--accent-green)'
        : (log.type === 'TABUNGAN_GOAL' ? 'var(--accent-purple)' : 'var(--accent-rose)');
        tdAmt.style.cssText = `white-space:nowrap; font-size:0.78rem; color:${colorVar};`;
        tdAmt.textContent = `${log.type === 'PEMASUKAN' ? '+' : '-'}${formatRupiah(log.amount)}`;

        // Kolom Aksi
        const tdAct = document.createElement('td');
        tdAct.className = 'text-center no-print';
        tdAct.style.whiteSpace = 'nowrap';

        const btnEdit = document.createElement('button');
        btnEdit.type = 'button';
        btnEdit.className = 'btn-blue';
        btnEdit.style.cssText = 'padding:2px 6px; font-size:0.68rem; min-height:24px; margin-right:2px;';
        btnEdit.textContent = 'Edit';
        btnEdit.addEventListener('click', () => openEditLogModal(log.id));

        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'btn-rose';
        btnDel.style.cssText = 'padding:2px 6px; font-size:0.68rem; min-height:24px;';
        btnDel.textContent = 'Hapus';
        btnDel.addEventListener('click', () => deleteDailyLog(log.id));

        tdAct.append(btnEdit, btnDel);

        tr.append(tdDate, tdInfo, tdAmt, tdAct);
        tableBody.appendChild(tr);
    });
}

// =========================================================================
// 10. TABUNGAN IMPIAN ENGINE
// =========================================================================
function renderGoals() {
    const container = document.getElementById('goalsCardsList');
    container.textContent = '';
    let totalAccumulated = 0;

    if (goals.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'color:var(--text-secondary); font-size:0.84rem; padding:12px;';
        emptyDiv.textContent = 'Belum ada tabungan impian. Klik "+ Tambah Tabungan Impian" untuk memulai.';
        container.appendChild(emptyDiv);
        document.getElementById('dispTotalGoalAccumulation').textContent = formatRupiah(0);
        return;
    }

    goals.forEach(goal => {
        const cur = Number(goal.current) || 0;
        const tgt = Number(goal.target) || 0;
        totalAccumulated += cur;
        const pct = tgt > 0 ? Math.min(100, Math.round((cur / tgt) * 100)) : 0;

        const storeLabel = goal.storeIn || 'Belum Ditentukan';
        const sourceLabel = goal.sourceFromName || getAccountNameById(goal.sourceFromId);

        const card = document.createElement('div');
        card.className = 'goal-card';

        const topWrap = document.createElement('div');

        const header = document.createElement('div');
        header.className = 'goal-header';
        const titleSpan = document.createElement('span');
        titleSpan.className = 'goal-title';
        titleSpan.textContent = goal.name;
        const catSpan = document.createElement('span');
        catSpan.className = 'goal-category';
        catSpan.textContent = goal.category;
        header.append(titleSpan, catSpan);

        const metaTags = document.createElement('div');
        metaTags.className = 'goal-meta-tags';
        const pillStore = document.createElement('span');
        pillStore.className = 'goal-meta-pill';
        pillStore.textContent = `Simpan di: ${storeLabel}`;
        const pillSource = document.createElement('span');
        pillSource.className = 'goal-meta-pill';
        pillSource.textContent = `Sumber: ${sourceLabel}`;
        metaTags.append(pillStore, pillSource);

        const progBox = document.createElement('div');
        progBox.className = 'goal-progress-box';

        const amountsRow = document.createElement('div');
        amountsRow.className = 'goal-amounts';
        const curSpan = document.createElement('span');
        curSpan.textContent = formatRupiah(cur, false);
        const tgtSpan = document.createElement('span');
        tgtSpan.style.color = 'var(--text-secondary)';
        tgtSpan.textContent = `Target: ${formatRupiah(tgt, false)}`;
        amountsRow.append(curSpan, tgtSpan);

        const barBg = document.createElement('div');
        barBg.className = 'progress-bar-bg';
        const barFill = document.createElement('div');
        barFill.className = 'progress-bar-fill';
        barFill.style.width = `${pct}%`;
        barBg.appendChild(barFill);

        const subRow = document.createElement('div');
        subRow.style.cssText = 'font-size: 0.73rem; color: var(--text-secondary); margin-top: 6px; display: flex; justify-content: space-between;';

        const pctWrap = document.createElement('span');
        pctWrap.textContent = 'Tercapai: ';
        const pctStrong = document.createElement('strong');
        pctStrong.textContent = `${pct}%`;
        pctWrap.appendChild(pctStrong);

        const planWrap = document.createElement('span');
        planWrap.textContent = 'Rencana: ';
        const planStrong = document.createElement('strong');
        planStrong.textContent = `${formatRupiah(goal.monthly || 0, false)}/bln`;
        planWrap.appendChild(planStrong);

        subRow.append(pctWrap, planWrap);
        progBox.append(amountsRow, barBg, subRow);
        topWrap.append(header, metaTags, progBox);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'goal-actions no-print';

        const btnEdit = document.createElement('button');
        btnEdit.type = 'button';
        btnEdit.className = 'btn-outline';
        btnEdit.style.cssText = 'color: var(--text-primary); border-color: var(--border);';
        btnEdit.textContent = 'Edit';
        btnEdit.addEventListener('click', () => openEditGoalModal(goal.id));

        const btnSetor = document.createElement('button');
        btnSetor.type = 'button';
        btnSetor.className = 'btn-amber';
        btnSetor.textContent = '+ Setor';
        btnSetor.addEventListener('click', () => addFundsToGoal(goal.id));

        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'btn-rose';
        btnDel.textContent = 'Hapus';
        btnDel.addEventListener('click', () => deleteGoal(goal.id));

        actionsDiv.append(btnEdit, btnSetor, btnDel);
        card.append(topWrap, actionsDiv);
        container.appendChild(card);
    });

    document.getElementById('dispTotalGoalAccumulation').textContent = formatRupiah(totalAccumulated);
}

function populateGoalModalDropdowns(selectedStore = '', selectedSource = '') {
    ensureDefaultAccount();
    const storeSel = document.getElementById('modalGoalStoreIn');
    const sourceSel = document.getElementById('modalGoalSourceFrom');

    storeSel.textContent = '';
    userSettings.accounts.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.name;
        opt.textContent = `${a.name} (${a.type})`;
        storeSel.appendChild(opt);
    });
    const customOpt = document.createElement('option');
    customOpt.value = '__CUSTOM__';
    customOpt.textContent = '+ Media Penyimpanan Lain (Ketik Manual)...';
    storeSel.appendChild(customOpt);

    sourceSel.textContent = '';
    userSettings.accounts.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.name;
        sourceSel.appendChild(opt);
    });

    if (selectedStore) {
        const exists = Array.from(storeSel.options).some(o => o.value === selectedStore);
        if (exists) {
            storeSel.value = selectedStore;
            document.getElementById('customGoalStoreGroup').style.display = 'none';
        } else {
            storeSel.value = '__CUSTOM__';
            document.getElementById('customGoalStoreGroup').style.display = 'block';
            document.getElementById('modalGoalCustomStore').value = selectedStore;
        }
    } else {
        document.getElementById('customGoalStoreGroup').style.display = 'none';
        document.getElementById('modalGoalCustomStore').value = '';
    }

    if (selectedSource) sourceSel.value = selectedSource;
}

function openAddGoalModal() {
    document.getElementById('modalGoalId').value = '';
    document.getElementById('modalGoalTitle').textContent = 'Tambah Tabungan Impian Baru';
    document.getElementById('modalGoalName').value = '';
    document.getElementById('modalGoalTarget').value = '';
    document.getElementById('modalGoalCurrent').value = '';
    document.getElementById('modalGoalMonthly').value = '';
    document.getElementById('modalGoalCategory').value = 'Gadget & Elektronik';
    populateGoalModalDropdowns();
    document.getElementById('goalModal').classList.add('active');
}

function openEditGoalModal(id) {
    const goal = goals.find(g => g.id === id);
    if (!goal) return;

    document.getElementById('modalGoalId').value = goal.id;
    document.getElementById('modalGoalTitle').textContent = 'Edit Tabungan Impian';
    document.getElementById('modalGoalName').value = goal.name;
    document.getElementById('modalGoalTarget').value = goal.target ? goal.target.toLocaleString('id-ID') : '';
    document.getElementById('modalGoalCurrent').value = goal.current ? goal.current.toLocaleString('id-ID') : '';
    document.getElementById('modalGoalMonthly').value = goal.monthly ? goal.monthly.toLocaleString('id-ID') : '';
    document.getElementById('modalGoalCategory').value = goal.category;
    populateGoalModalDropdowns(goal.storeIn || '', goal.sourceFromId || '');
    document.getElementById('goalModal').classList.add('active');
}

function closeGoalModal() {
    document.getElementById('goalModal').classList.remove('active');
}

async function saveGoalModal() {
    const id = document.getElementById('modalGoalId').value;
    const name = normalizePlainText(document.getElementById('modalGoalName').value, 50);
    const target = parseMoneyInput(document.getElementById('modalGoalTarget').value);
    const current = parseMoneyInput(document.getElementById('modalGoalCurrent').value);
    const monthly = parseMoneyInput(document.getElementById('modalGoalMonthly').value);
    const category = normalizePlainText(document.getElementById('modalGoalCategory').value, 40);

    const storeSelVal = document.getElementById('modalGoalStoreIn').value;
    const storeIn = (storeSelVal === '__CUSTOM__')
    ? normalizePlainText(document.getElementById('modalGoalCustomStore').value || 'Dompet Khusus', 35)
    : normalizePlainText(storeSelVal, 35);

    const sourceFromId = document.getElementById('modalGoalSourceFrom').value;
    const sourceFromName = getAccountNameById(sourceFromId);

    if (!name) {
        alert('Mohon isi nama tabungan impian.');
        return;
    }

    const goalObj = sanitizeGoalObject({
        id: id ? parseInt(id, 10) : Date.now(),
                                       name,
                                       target,
                                       current,
                                       monthly,
                                       category,
                                       storeIn,
                                       sourceFromId,
                                       sourceFromName
    });

    if (id) {
        const idx = goals.findIndex(g => g.id === parseInt(id, 10));
        if (idx !== -1) goals[idx] = goalObj;
    } else {
        goals.push(goalObj);
    }

    await saveData();
    refreshAllViews();
    closeGoalModal();
}

async function deleteGoal(id) {
    if (!confirm('Hapus tabungan impian ini?')) return;
    goals = goals.filter(g => g.id !== id);
    await saveData();
    refreshAllViews();
}

async function addFundsToGoal(id) {
    const goal = goals.find(g => g.id === id);
    if (!goal) return;
    const sourceName = goal.sourceFromName || getAccountNameById(goal.sourceFromId);
    const input = prompt(`Setoran untuk "${goal.name}" (Sumber: ${sourceName} -> Simpan di: ${goal.storeIn || 'Kas'}):`, "100000");
    const amount = parseMoneyInput(input);
    if (amount > 0) {
        dailyLogs.unshift(sanitizeLogObject({
            id: Date.now(),
                                            date: new Date().toISOString().split('T')[0],
                                            type: 'TABUNGAN_GOAL',
                                            accountId: goal.sourceFromId || userSettings.accounts[0].id,
                                            category: `GOAL_${goal.id}`,
                                            title: `Setoran Impian: ${goal.name}`,
                                            amount: amount,
                                            notes: `Disimpan di ${goal.storeIn || 'Kas'}`
        }));
        goal.current = (Number(goal.current) || 0) + amount;
        await saveData();
        refreshAllViews();
    }
}

// =========================================================================
// 11. EXPORT PDF & EXCEL (FORMULA-INJECTION SAFE)
// =========================================================================
function sanitizeExcelCellText(val) {
    const str = String(val ?? '');
    if (/^[=+\-@\t\r]/.test(str)) {
        return `'${str}`;
    }
    return str;
}

function exportPDF() {
    const todayStr = new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('pdfPrintDate').textContent = todayStr;
    document.getElementById('pdfPrintFilter').textContent = document.getElementById('recapPeriodTitle').textContent || 'Semua Data';
    window.print();
}

function exportExcel() {
    const filtered = getFilteredLogs();
    if (filtered.length === 0) {
        alert('Tidak ada data mutasi pada periode terpilih untuk diekspor.');
        return;
    }

    let totalIncome = 0;
    let totalExpense = 0;
    let totalGoalAlloc = 0;
    const periodText = document.getElementById('recapPeriodTitle').textContent || 'Semua Data';
    const todayStr = new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });

    const styleTitle = {
        font: { bold: true, sz: 14, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "1E3A8A" } },
        alignment: { vertical: "center", horizontal: "left" }
    };
    const styleSub = {
        font: { italic: true, sz: 10, color: { rgb: "334155" } },
        fill: { fgColor: { rgb: "EFF6FF" } }
    };
    const styleHeader = {
        font: { bold: true, sz: 10, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "0F172A" } },
        alignment: { vertical: "center", horizontal: "center" },
        border: {
            top: { style: "thin", color: { rgb: "CBD5E1" } },
            bottom: { style: "thin", color: { rgb: "CBD5E1" } },
            left: { style: "thin", color: { rgb: "CBD5E1" } },
            right: { style: "thin", color: { rgb: "CBD5E1" } }
        }
    };

    const wsData = [
        [{ v: "MONA FINANCIAL MANAGER - LAPORAN MUTASI KEUANGAN", s: styleTitle }, "", "", "", "", "", "", ""],
        [{ v: `Periode Laporan: ${periodText} | Dicetak: ${todayStr}`, s: styleSub }, "", "", "", "", "", "", ""],
        [],
        [
            { v: "NO", s: styleHeader },
            { v: "TANGGAL", s: styleHeader },
            { v: "JENIS MUTASI", s: styleHeader },
            { v: "MEDIA TABUNGAN", s: styleHeader },
            { v: "KATEGORI POS", s: styleHeader },
            { v: "DESKRIPSI TRANSAKSI", s: styleHeader },
            { v: "NOMINAL (RP)", s: styleHeader },
            { v: "CATATAN", s: styleHeader }
        ]
    ];

    filtered.forEach((l, index) => {
        let displayCat = l.category;
        if (String(l.category).startsWith('GOAL_')) {
            const gid = parseInt(String(l.category).replace('GOAL_', ''), 10);
            const g = goals.find(x => x.id === gid);
            displayCat = g ? `Impian: ${g.name}` : 'Alokasi Impian';
        }

        const isIncome = l.type === 'PEMASUKAN';
        const isGoal = l.type === 'TABUNGAN_GOAL';
        if (isIncome) totalIncome += l.amount;
        else if (isGoal) totalGoalAlloc += l.amount;
        else totalExpense += l.amount;

        const rowBg = isIncome ? "DCFCE7" : (isGoal ? "F3E8FF" : "FEE2E2");
        const textRgb = isIncome ? "166534" : (isGoal ? "6B21A8" : "991B1B");

        const cellStyle = {
            font: { sz: 10, color: { rgb: "0F172A" } },
            fill: { fgColor: { rgb: index % 2 === 0 ? "FFFFFF" : "F8FAFC" } },
            border: {
                top: { style: "thin", color: { rgb: "E2E8F0" } },
                bottom: { style: "thin", color: { rgb: "E2E8F0" } },
                left: { style: "thin", color: { rgb: "E2E8F0" } },
                right: { style: "thin", color: { rgb: "E2E8F0" } }
            }
        };

        const typeBadgeStyle = {
            font: { bold: true, sz: 9, color: { rgb: textRgb } },
            fill: { fgColor: { rgb: rowBg } },
            alignment: { horizontal: "center" },
            border: cellStyle.border
        };

        const numStyle = {
            font: { bold: true, sz: 10, color: { rgb: textRgb } },
            fill: { fgColor: { rgb: rowBg } },
            numFmt: "#,##0",
            alignment: { horizontal: "right" },
            border: cellStyle.border
        };

        wsData.push([
            { v: index + 1, s: { ...cellStyle, alignment: { horizontal: "center" } } },
            { v: l.date, s: { ...cellStyle, alignment: { horizontal: "center" } } },
            { v: l.type, s: typeBadgeStyle },
            { v: sanitizeExcelCellText(getAccountNameById(l.accountId)), s: cellStyle },
                    { v: sanitizeExcelCellText(displayCat), s: cellStyle },
                    { v: sanitizeExcelCellText(l.title), s: cellStyle },
                    { v: l.amount, s: numStyle },
                    { v: sanitizeExcelCellText(l.notes || "-"), s: cellStyle }
        ]);
    });

    const summaryLabelStyle = {
        font: { bold: true, sz: 10, color: { rgb: "0F172A" } },
        fill: { fgColor: { rgb: "E2E8F0" } },
        alignment: { horizontal: "right" }
    };

    wsData.push(
        [],
        ["", "", "", "", "", { v: "TOTAL PEMASUKAN", s: summaryLabelStyle }, { v: totalIncome, s: { font: { bold: true, color: { rgb: "166534" } }, fill: { fgColor: { rgb: "DCFCE7" } }, numFmt: "#,##0" } }, ""],
        ["", "", "", "", "", { v: "TOTAL PENGELUARAN", s: summaryLabelStyle }, { v: totalExpense, s: { font: { bold: true, color: { rgb: "991B1B" } }, fill: { fgColor: { rgb: "FEE2E2" } }, numFmt: "#,##0" } }, ""],
        ["", "", "", "", "", { v: "TOTAL ALOKASI TABUNGAN IMPIAN", s: summaryLabelStyle }, { v: totalGoalAlloc, s: { font: { bold: true, color: { rgb: "6B21A8" } }, fill: { fgColor: { rgb: "F3E8FF" } }, numFmt: "#,##0" } }, ""]
    );

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } }
    ];
    ws['!cols'] = [
        { wch: 5 }, { wch: 13 }, { wch: 18 }, { wch: 20 },
        { wch: 24 }, { wch: 30 }, { wch: 18 }, { wch: 24 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Mutasi Keuangan");
    XLSX.writeFile(wb, `MoNa_Laporan_${new Date().toISOString().split('T')[0]}.xlsx`);
}

// =========================================================================
// 12. ANALYTICS CHARTS & OVERSPENDING NOTIFICATION ENGINE
// =========================================================================
function evaluateOverspendingAlert() {
    const alertBox = document.getElementById('spendingAlertBanner');
    if (!alertBox) return;

    const todayStr = new Date().toISOString().split('T')[0];
    const currentMonthPrefix = todayStr.substring(0, 7);

    let todayExpense = 0;
    let thisMonthExpense = 0;

    dailyLogs.forEach(log => {
        if (log.type === 'PENGELUARAN') {
            const amt = Number(log.amount) || 0;
            if (log.date === todayStr) todayExpense += amt;
            if (String(log.date).startsWith(currentMonthPrefix)) thisMonthExpense += amt;
        }
    });

    const warnings = [];
    const dLimit = Number(userSettings.dailyLimit) || 0;
    const mLimit = Number(userSettings.monthlyLimit) || 0;

    if (dLimit > 0 && todayExpense > dLimit) {
        warnings.push(`Pengeluaran hari ini (${formatRupiah(todayExpense, false)}) telah melampaui batas harian Anda (${formatRupiah(dLimit, false)}).`);
    } else if (dLimit > 0 && todayExpense >= dLimit * 0.85) {
        warnings.push(`Pengeluaran hari ini (${formatRupiah(todayExpense, false)}) sudah mencapai ${Math.round((todayExpense / dLimit) * 100)}% dari batas harian.`);
    }

    if (mLimit > 0 && thisMonthExpense > mLimit) {
        warnings.push(`Akumulasi pengeluaran bulan ini (${formatRupiah(thisMonthExpense, false)}) telah melewati batas bulanan (${formatRupiah(mLimit, false)}).`);
    } else if (mLimit > 0 && thisMonthExpense >= mLimit * 0.85) {
        warnings.push(`Pengeluaran bulan ini (${formatRupiah(thisMonthExpense, false)}) mendekati batas maksimal bulanan (${Math.round((thisMonthExpense / mLimit) * 100)}%).`);
    }

    alertBox.textContent = '';
    if (warnings.length > 0) {
        alertBox.style.display = 'flex';

        const textWrap = document.createElement('div');
        const strongLabel = document.createElement('strong');
        strongLabel.textContent = 'Peringatan Pengendalian Pengeluaran: ';
        textWrap.append(strongLabel, document.createTextNode(warnings.join(' | ')));

        const btnCfg = document.createElement('button');
        btnCfg.type = 'button';
        btnCfg.className = 'btn-rose';
        btnCfg.style.cssText = 'padding:3px 8px; min-height:26px; font-size:0.7rem;';
        btnCfg.textContent = 'Atur Batas';
        btnCfg.addEventListener('click', () => openProfileModal('LIMITS'));

        alertBox.append(textWrap, btnCfg);
    } else {
        alertBox.style.display = 'none';
    }
}

function renderDynamicAnalytics(categoryExpenses) {
    if (window.innerWidth < 768) return;

    const isDark = document.body.classList.contains('dark-mode');
    const labelColor = isDark ? '#cbd5e1' : '#475569';
    const barColor = isDark ? '#3b82f6' : '#1e3a8a';

    const canvasCat = document.getElementById('categoryChart');
    if (canvasCat && canvasCat.getContext) {
        const ctx = canvasCat.getContext('2d');
        const w = canvasCat.width;
        const h = canvasCat.height;
        ctx.clearRect(0, 0, w, h);

        const categories = Object.keys(categoryExpenses);
        const values = Object.values(categoryExpenses);
        const maxVal = Math.max(...values, 100000);

        const barWidth = 28;
        const gap = 18;
        let startX = 18;

        categories.forEach((cat, idx) => {
            const val = values[idx];
            const barHeight = Math.min(105, (val / maxVal) * 105);

            ctx.fillStyle = barColor;
            ctx.fillRect(startX, 132 - barHeight, barWidth, barHeight);

            ctx.fillStyle = labelColor;
            ctx.font = '10px sans-serif';
            ctx.fillText(cat.substring(0, 6), startX, 150);
            startX += barWidth + gap;
        });
    }

    const canvasTrend = document.getElementById('trendChart');
    if (canvasTrend && canvasTrend.getContext) {
        const ctx = canvasTrend.getContext('2d');
        const w = canvasTrend.width;
        const h = canvasTrend.height;
        ctx.clearRect(0, 0, w, h);

        const daysMap = {};
        const daysLabels = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            daysMap[dateStr] = 0;
            daysLabels.push({ dateStr, shortLabel: `${d.getDate()}/${d.getMonth() + 1}` });
        }

        dailyLogs.forEach(log => {
            if (Object.prototype.hasOwnProperty.call(daysMap, log.date) && log.type === 'PENGELUARAN') {
                daysMap[log.date] += (Number(log.amount) || 0);
            }
        });

        const trendValues = daysLabels.map(item => daysMap[item.dateStr]);
        const dLimit = Number(userSettings.dailyLimit) || 0;
        const maxTrendVal = Math.max(...trendValues, dLimit, 100000);

        if (dLimit > 0) {
            const limitY = 132 - (dLimit / maxTrendVal) * 95;
            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = '#dc2626';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(20, limitY);
            ctx.lineTo(w - 20, limitY);
            ctx.stroke();
            ctx.fillStyle = '#dc2626';
            ctx.font = '9px sans-serif';
            ctx.fillText('Batas Harian', w - 75, Math.max(12, limitY - 4));
            ctx.restore();
        }

        const stepX = (w - 44) / 6;
        const points = trendValues.map((val, idx) => ({
            x: 22 + idx * stepX,
            y: 132 - (val / maxTrendVal) * 95,
                                                      val
        }));

        ctx.beginPath();
        ctx.strokeStyle = '#7c3aed';
        ctx.lineWidth = 2.5;
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();

        points.forEach((p, idx) => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = (dLimit > 0 && p.val > dLimit) ? '#dc2626' : '#7c3aed';
            ctx.fill();

            ctx.fillStyle = labelColor;
            ctx.font = '10px sans-serif';
            ctx.fillText(daysLabels[idx].shortLabel, p.x - 10, 150);
        });
    }
}

// =========================================================================
// 13. MASTER CALCULATION & RECAP ENGINE
// =========================================================================
function updateAllCalculations() {
    const filteredLogs = getFilteredLogs();
    const mode = document.getElementById('timeFilterMode').value;

    let filterLabel = 'Semua Riwayat Dari Awal';
    if (mode === 'MONTHLY') filterLabel = `Bulan: ${document.getElementById('filterMonthVal').value}`;
    else if (mode === 'WEEKLY') filterLabel = `Minggu: ${document.getElementById('filterWeekVal').value}`;
    else if (mode === 'RANGE') filterLabel = `Periode: ${document.getElementById('filterStartDate').value} s/d ${document.getElementById('filterEndDate').value}`;

    document.getElementById('dispFilterLabel1').textContent = filterLabel;
    document.getElementById('dispFilterLabel2').textContent = filterLabel;
    document.getElementById('recapPeriodTitle').textContent = filterLabel;

    let periodIncome = 0;
    let periodExpense = 0;

    const categoryExpenses = {
        'Makan & Dapur': 0,
        'Transportasi': 0,
        'Kost & Utilitas': 0,
        'Kuota Internet': 0,
        'Kebutuhan Harian': 0,
        'Kebutuhan Darurat': 0,
        'Lainnya': 0
    };

    const uniqueDates = new Set();

    filteredLogs.forEach(l => {
        uniqueDates.add(l.date);
        const amt = Number(l.amount) || 0;
        if (l.type === 'PEMASUKAN') {
            periodIncome += amt;
        } else if (l.type === 'PENGELUARAN') {
            periodExpense += amt;
            const catKey = Object.prototype.hasOwnProperty.call(categoryExpenses, l.category) ? l.category : 'Lainnya';
            categoryExpenses[catKey] += amt;
        }
    });

    const balances = calculateAccountBalances();
    const isMulti = userSettings.savingsMode === 'MULTI';
    const visibleAccounts = isMulti ? userSettings.accounts : [userSettings.accounts[0]];
    const totalRemainingBalance = visibleAccounts.reduce((sum, acc) => sum + (balances[acc.id] || 0), 0);

    document.getElementById('dispIncome').textContent = formatRupiah(periodIncome);
    document.getElementById('dispExpense').textContent = formatRupiah(periodExpense);
    document.getElementById('dispNet').textContent = formatRupiah(totalRemainingBalance);
    document.getElementById('dispAccountModeSub').textContent = isMulti
    ? `Total Sisa dari ${visibleAccounts.length} Media Tabungan`
    : `Saldo Tersisa (${visibleAccounts[0].name})`;

    const multiStrip = document.getElementById('multiAccountStrip');
    const cardsRow = document.getElementById('accountsCardsRow');
    cardsRow.textContent = '';

    if (isMulti) {
        multiStrip.style.display = 'block';
        visibleAccounts.forEach(acc => {
            const card = document.createElement('div');
            card.className = 'acc-mini-card';

            const tDiv = document.createElement('div');
            tDiv.className = 'acc-mini-type';
            tDiv.textContent = acc.type;

            const nDiv = document.createElement('div');
            nDiv.className = 'acc-mini-name';
            nDiv.textContent = acc.name;

            const bDiv = document.createElement('div');
            bDiv.className = 'acc-mini-bal';
            bDiv.textContent = formatRupiah(balances[acc.id] || 0);

            card.append(tDiv, nDiv, bDiv);
            cardsRow.appendChild(card);
        });
    } else {
        multiStrip.style.display = 'none';
    }

    // Render Recap Table Safely
    const daysCount = Math.max(1, uniqueDates.size);
    const recapBody = document.getElementById('recapTableBody');
    recapBody.textContent = '';

    Object.keys(categoryExpenses).forEach(cat => {
        const spent = categoryExpenses[cat];
        const dailyAvg = spent / daysCount;
        const porsi = periodExpense > 0 ? ((spent / periodExpense) * 100).toFixed(1) : '0.0';

        const tr = document.createElement('tr');

        const tdCat = document.createElement('td');
        const strongCat = document.createElement('strong');
        strongCat.textContent = cat;
        tdCat.appendChild(strongCat);

        const tdSpent = document.createElement('td');
        tdSpent.className = 'text-right font-bold';
        tdSpent.textContent = formatRupiah(spent);

        const tdAvg = document.createElement('td');
        tdAvg.className = 'text-right';
        tdAvg.textContent = formatRupiah(dailyAvg);

        const tdPorsi = document.createElement('td');
        tdPorsi.className = 'text-right';
        tdPorsi.textContent = `${porsi}%`;

        const tdStatus = document.createElement('td');
        tdStatus.className = 'text-center';
        const badge = document.createElement('span');
        badge.className = parseFloat(porsi) > 35 ? 'badge-tag tag-transport' : 'badge-tag tag-pemasukan';
        badge.textContent = parseFloat(porsi) > 35 ? 'Dominan' : 'Terkendali';
        tdStatus.appendChild(badge);

        tr.append(tdCat, tdSpent, tdAvg, tdPorsi, tdStatus);
        recapBody.appendChild(tr);
    });

    // Render Timeline Table Safely
    const timelineBody = document.getElementById('timelineTableBody');
    timelineBody.textContent = '';

    let accumSavings = totalRemainingBalance;
    const estMonthlyIncome = mode === 'WEEKLY' ? periodIncome * 4 : periodIncome;
    const estMonthlyOutflow = mode === 'WEEKLY' ? periodExpense * 4 : periodExpense;
    const estSurplus = estMonthlyIncome - estMonthlyOutflow;

    for (let m = 1; m <= 12; m++) {
        accumSavings += estSurplus;
        const reachedGoals = [];
        goals.forEach(g => {
            if (g.target > 0 && ((Number(g.monthly) || 0) * m + (Number(g.current) || 0)) >= g.target) {
                reachedGoals.push(g.name);
            }
        });

        const tr = document.createElement('tr');

        const tdMonth = document.createElement('td');
        tdMonth.className = 'text-center font-bold';
        tdMonth.textContent = `Bulan ${m}`;

        const tdInc = document.createElement('td');
        tdInc.className = 'text-right';
        tdInc.textContent = formatRupiah(estMonthlyIncome);

        const tdOut = document.createElement('td');
        tdOut.className = 'text-right';
        tdOut.textContent = formatRupiah(estMonthlyOutflow);

        const tdAcc = document.createElement('td');
        tdAcc.className = 'text-right font-bold';
        tdAcc.style.color = 'var(--accent-blue)';
        tdAcc.textContent = formatRupiah(accumSavings);

        const tdStat = document.createElement('td');
        const statSpan = document.createElement('span');
        if (reachedGoals.length > 0) {
            statSpan.className = 'goal-category';
            statSpan.style.cssText = 'background:#dcfce7; color:#166534;';
            statSpan.textContent = `Tercapai: ${reachedGoals.join(', ')}`;
        } else {
            statSpan.style.cssText = 'color:var(--text-secondary); font-size:0.78rem;';
            statSpan.textContent = 'Akumulasi Berjalan';
        }
        tdStat.appendChild(statSpan);

        tr.append(tdMonth, tdInc, tdOut, tdAcc, tdStat);
        timelineBody.appendChild(tr);
    }

    renderDailyLogs();
    evaluateOverspendingAlert();
    renderDynamicAnalytics(categoryExpenses);
}

// =========================================================================
// 14. EVENT LISTENERS BINDING (ZERO INLINE HANDLERS FOR STRICT CSP)
// =========================================================================
function bindStaticEventListeners() {
    // Navbar & Header
    document.getElementById('headerAvatarBox').addEventListener('click', () => openProfileModal('ACCOUNT'));
    document.getElementById('userAuthStatus').addEventListener('click', () => openProfileModal('ACCOUNT'));
    document.getElementById('btnNavAddGoal').addEventListener('click', openAddGoalModal);
    document.getElementById('btnToggleExport').addEventListener('click', toggleExportMenu);
    document.getElementById('btnExportPDF').addEventListener('click', exportPDF);
    document.getElementById('btnExportExcel').addEventListener('click', exportExcel);

    document.addEventListener('click', () => {
        const menu = document.getElementById('exportDropdownMenu');
        if (menu) menu.classList.remove('active');
    });

        // Global Filter Toolbar
        document.getElementById('timeFilterMode').addEventListener('change', toggleFilterModeControls);
        document.getElementById('filterMonthVal').addEventListener('change', updateAllCalculations);
        document.getElementById('filterWeekVal').addEventListener('change', updateAllCalculations);
        document.getElementById('filterStartDate').addEventListener('change', updateAllCalculations);
        document.getElementById('filterEndDate').addEventListener('change', updateAllCalculations);

        // Main Navigation Tabs
        document.querySelectorAll('#mainTabsHeader .tab-btn').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab, btn));
        });

        // Daily Transaction Form & Filter
        document.getElementById('dailyForm').addEventListener('submit', handleDailySubmit);
        document.getElementById('dailyType').addEventListener('change', updateTransactionFormOptions);
        document.getElementById('dailyFilterType').addEventListener('change', renderDailyLogs);

        // Goals Tab
        document.getElementById('btnTabAddGoal').addEventListener('click', openAddGoalModal);

        // Profile Modal & Internal Tabs
        document.getElementById('btnCloseProfileModal').addEventListener('click', closeProfileModal);
        document.querySelectorAll('[data-prof-sec]').forEach(tab => {
            tab.addEventListener('click', () => switchProfileSection(tab.dataset.profSec));
        });
        document.querySelectorAll('[data-auth-mode]').forEach(tab => {
            tab.addEventListener('click', () => switchAuthMode(tab.dataset.authMode));
        });

        // Password Eye Toggles
        document.querySelectorAll('.btn-toggle-eye').forEach(btn => {
            btn.innerHTML = SVG_EYE_OPEN;
            btn.addEventListener('click', () => togglePasswordVisibility(btn.dataset.eyeTarget, btn));
        });

        // Avatar & Auth Forms
        document.getElementById('avatarFileInput').addEventListener('change', handleSecureAvatarUpload);
        document.getElementById('btnRemoveAvatar').addEventListener('click', removeProfileAvatar);
        document.getElementById('formLoginMode').addEventListener('submit', (e) => {
            e.preventDefault();
            handleAuthLogin();
        });
        document.getElementById('formRegisterMode').addEventListener('submit', (e) => {
            e.preventDefault();
            handleAuthRegister();
        });
        document.getElementById('formChangePassword').addEventListener('submit', (e) => {
            e.preventDefault();
            handleChangePassword();
        });
        document.getElementById('btnAuthLogout').addEventListener('click', handleAuthLogout);
        document.getElementById('btnDeleteAccount').addEventListener('click', handleDeleteAccount);

        // Savings Account Manager
        document.getElementById('savingsModeSelect').addEventListener('change', handleSavingsModeChange);
        document.getElementById('btnAddSavingsAccount').addEventListener('click', handleAddSavingsAccount);

        // Theme & Limits
        document.getElementById('btnThemeLight').addEventListener('click', () => setTheme('light'));
        document.getElementById('btnThemeDark').addEventListener('click', () => setTheme('dark'));
        document.getElementById('btnSaveSpendingLimits').addEventListener('click', handleSaveSpendingLimits);
        document.getElementById('btnResetAppData').addEventListener('click', handleResetAppData);

        // Goal Modal
        document.getElementById('modalGoalStoreIn').addEventListener('change', function() {
            document.getElementById('customGoalStoreGroup').style.display = (this.value === '__CUSTOM__') ? 'block' : 'none';
        });
        document.getElementById('btnCloseGoalModal').addEventListener('click', closeGoalModal);
        document.getElementById('btnCancelGoalModal').addEventListener('click', closeGoalModal);
        document.getElementById('btnSaveGoalModal').addEventListener('click', saveGoalModal);

        // Edit Log Modal
        document.getElementById('editLogType').addEventListener('change', () => updateEditTransactionFormOptions());
        document.getElementById('btnCloseEditLogModal').addEventListener('click', closeEditLogModal);
        document.getElementById('btnCancelEditLogModal').addEventListener('click', closeEditLogModal);
        document.getElementById('btnSaveEditLogModal').addEventListener('click', saveEditLogModal);
}

window.addEventListener('DOMContentLoaded', () => {
    bindStaticEventListeners();
    setupMoneyInputFormatting();
    initApp();
});

window.addEventListener('resize', () => {
    updateAllCalculations();
});
