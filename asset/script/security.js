// =========================================================================
// SECURITY, VALIDATION, SCHEMA SANITIZATION & BINARY FILE INSPECTION
// =========================================================================
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ALLOWED_MUTATION_TYPES = new Set(['PEMASUKAN', 'PENGELUARAN', 'TABUNGAN_GOAL']);
const INTERNAL_AUTH_DOMAIN = '@mona-internal.app';
const MAX_SAFE_MONEY = 999999999999; // Maksimum Rp 999 Miliar

let uniqueIdCounter = 0;
function generateUniqueNumericId() {
    uniqueIdCounter = (uniqueIdCounter + 1) % 1000;
    return Date.now() * 1000 + uniqueIdCounter;
}

function getLocalDateString(dateObj = new Date()) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function sanitizeFiniteAmount(val, maxVal = MAX_SAFE_MONEY) {
    const num = Number(val);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return Math.min(maxVal, Math.round(num * 100) / 100);
}

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
    if (typeof pwd !== 'string' || pwd.length < 8 || pwd.length > 64) return false;
    return /[a-zA-Z]/.test(pwd) && /[0-9]/.test(pwd);
}

function isValidIsoDate(dateStr) {
    if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
    const [y, m, d] = dateStr.split('-').map(Number);
    if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
    const check = new Date(y, m - 1, d);
    return check.getFullYear() === y && (check.getMonth() + 1) === m && check.getDate() === d;
}

function isValidAccountId(id) {
    if (typeof id !== 'string') return false;
    return /^(acc_[a-zA-Z0-9_-]+|GOAL_\d+)$/.test(id);
}

function sanitizeAccountObject(raw, fallbackIdx = 0, existingIds = new Set()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    let id = (typeof raw.id === 'string' && /^acc_[a-zA-Z0-9_-]+$/.test(raw.id))
        ? raw.id
        : `acc_${generateUniqueNumericId()}_${fallbackIdx}`;

    if (existingIds.has(id)) {
        id = `acc_${generateUniqueNumericId()}_${fallbackIdx}`;
    }
    existingIds.add(id);

    const name = normalizePlainText(raw.name, 30) || 'Kas Utama';
    const type = normalizePlainText(raw.type, 30) || 'Rekening Utama';
    const initialBalance = sanitizeFiniteAmount(raw.initialBalance);
    return { id, name, type, initialBalance };
}

function sanitizeGoalObject(raw, fallbackIdx = 0) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = Number.isSafeInteger(Number(raw.id)) && Number(raw.id) > 0
        ? Number(raw.id)
        : (generateUniqueNumericId() + fallbackIdx);
    const name = normalizePlainText(raw.name, 50);
    if (!name) return null;
    return {
        id,
        name,
        target: sanitizeFiniteAmount(raw.target),
        current: sanitizeFiniteAmount(raw.current),
        monthly: sanitizeFiniteAmount(raw.monthly),
        category: normalizePlainText(raw.category, 40) || 'Target Lainnya',
        storeIn: normalizePlainText(raw.storeIn, 35) || 'Kas Utama',
        sourceFromId: isValidAccountId(raw.sourceFromId) ? raw.sourceFromId : 'acc_main',
        sourceFromName: normalizePlainText(raw.sourceFromName, 35) || 'Kas Utama'
    };
}

function sanitizeLogObject(raw, fallbackIdx = 0) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = Number.isSafeInteger(Number(raw.id)) && Number(raw.id) > 0
        ? Number(raw.id)
        : (generateUniqueNumericId() + fallbackIdx);
    const date = isValidIsoDate(raw.date) ? raw.date : getLocalDateString();
    const type = ALLOWED_MUTATION_TYPES.has(raw.type) ? raw.type : 'PENGELUARAN';
    const accountId = isValidAccountId(raw.accountId) ? raw.accountId : 'acc_main';
    const category = normalizePlainText(raw.category, 40) || 'Lainnya';
    const title = normalizePlainText(raw.title, 80) || 'Transaksi';
    const amount = sanitizeFiniteAmount(raw.amount);
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
            const seenIds = new Set();
            const validAccs = raw.accounts.map((a, i) => sanitizeAccountObject(a, i, seenIds)).filter(Boolean);
            if (validAccs.length > 0) clean.accounts = validAccs;
        } else if (key === 'dailyLimit') {
            clean.dailyLimit = sanitizeFiniteAmount(raw.dailyLimit);
        } else if (key === 'monthlyLimit') {
            clean.monthlyLimit = sanitizeFiniteAmount(raw.monthlyLimit);
        } else if (key === 'avatarDataUrl' && typeof raw.avatarDataUrl === 'string') {
            if (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(raw.avatarDataUrl) && raw.avatarDataUrl.length <= 250000) {
                clean.avatarDataUrl = raw.avatarDataUrl;
            }
        }
    }
    return clean;
}

function sanitizeExcelCellText(val) {
    const str = String(val ?? '').replace(/[\u0000-\u001F\u007F]/g, '');
    if (/^\s*[=+\-@]/.test(str)) {
        return `'${str}`;
    }
    return str;
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
