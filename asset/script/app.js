// =========================================================================
// 1. CONFIG FIREBASE (AUTH + FIRESTORE) & APPLICATION STATE
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
    if (typeof firebase !== 'undefined' && firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("PASTE_")) {
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
let hasPendingSync = false;
let pendingSyncResolvers = [];
let localRevision = 0;
let isGuestNoticeDismissed = false;
let useGoalFundsForExpense = false;

let goals = [];
let dailyLogs = [];
let userSettings = sanitizeSettingsObject(null);

// =========================================================================
// 1B. THEME-AWARE SYSTEM ALERT MODAL (PENGGANTI BROWSER ALERT)
// =========================================================================
function showThemeAlert(message, title = 'Informasi Sistem', variant = 'info') {
    return new Promise(resolve => {
        const modal = document.getElementById('systemAlertModal');
        const titleEl = document.getElementById('systemAlertTitle');
        const msgEl = document.getElementById('systemAlertMessage');
        const badgeEl = document.getElementById('systemAlertBadge');
        const okBtn = document.getElementById('btnSystemAlertOk');

        if (!modal || !titleEl || !msgEl || !okBtn) {
            resolve();
            return;
        }

        titleEl.textContent = title;
        msgEl.textContent = String(message || '');

        if (badgeEl) {
            badgeEl.className = 'alert-modal-badge';
            if (variant === 'success') {
                badgeEl.classList.add('success');
                badgeEl.textContent = 'Berhasil';
            } else if (variant === 'error') {
                badgeEl.classList.add('error');
                badgeEl.textContent = 'Perhatian';
            } else if (variant === 'warning') {
                badgeEl.classList.add('warning');
                badgeEl.textContent = 'Peringatan';
            } else {
                badgeEl.textContent = 'Notifikasi';
            }
        }

        modal.classList.add('active');
        setTimeout(() => okBtn.focus(), 30);

        const cleanup = () => {
            modal.classList.remove('active');
            okBtn.removeEventListener('click', onOk);
            document.removeEventListener('keydown', onKey);
            resolve();
        };

        const onOk = () => cleanup();
        const onKey = (e) => {
            if (e.key === 'Escape' || e.key === 'Enter') {
                e.preventDefault();
                cleanup();
            }
        };

        okBtn.addEventListener('click', onOk);
        document.addEventListener('keydown', onKey);
    });
}

// =========================================================================
// 2. THEME SYSTEM ENGINE (STANDAR / GELAP / RETRO + STORAGE FALLBACK)
// =========================================================================
function setTheme(theme) {
    const validThemes = ['light', 'dark', 'retro'];
    const chosen = validThemes.includes(theme) ? theme : 'light';

    document.body.classList.remove('dark-mode', 'retro-mode');
    if (chosen === 'dark') {
        document.body.classList.add('dark-mode');
    } else if (chosen === 'retro') {
        document.body.classList.add('retro-mode');
    }

    try {
        localStorage.setItem('mona_theme', chosen);
    } catch (e) {
        // Fallback jika penyimpanan dibatasi
    }

    const btnLight = document.getElementById('btnThemeLight');
    const btnDark = document.getElementById('btnThemeDark');
    const btnRetro = document.getElementById('btnThemeRetro');
    if (btnLight) btnLight.classList.toggle('active', chosen === 'light');
    if (btnDark) btnDark.classList.toggle('active', chosen === 'dark');
    if (btnRetro) btnRetro.classList.toggle('active', chosen === 'retro');

    updateAllCalculations();
}

function initTheme() {
    let savedTheme = 'light';
    try {
        savedTheme = localStorage.getItem('mona_theme') || 'light';
    } catch (e) {
        savedTheme = 'light';
    }
    setTheme(savedTheme);
}

// =========================================================================
// 3. PARSING & LOCAL CALENDAR UTILITIES
// =========================================================================
function parseMoneyInput(val) {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return sanitizeFiniteAmount(val);
    const cleaned = val.toString().replace(/[^0-9]/g, '');
    return cleaned === '' ? 0 : sanitizeFiniteAmount(parseFloat(cleaned));
}

function formatRupiah(number, showCents = true) {
    if (number === null || number === undefined || !Number.isFinite(number)) number = 0;
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
        elem.setAttribute('inputmode', 'numeric');
        elem.setAttribute('pattern', '[0-9.]*');
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
// 4. ACCOUNT BALANCE & GOAL STORE GROUPING ENGINE
// =========================================================================
function ensureDefaultAccount() {
    if (!Array.isArray(userSettings.accounts) || userSettings.accounts.length === 0) {
        userSettings.accounts = [{ id: 'acc_main', name: 'Kas Utama', type: 'Rekening Utama', initialBalance: 0 }];
    }
}

function getGoalStoreGroups() {
    const groupsMap = new Map();
    goals.forEach((g) => {
        const key = normalizeStoreKey(g.storeIn);
        const label = formatNormalizedStoreLabel(g.storeIn);
        const bal = sanitizeFiniteAmount(g.current);
        if (!groupsMap.has(key)) {
            groupsMap.set(key, {
                key,
                label,
                totalBalance: 0,
                goals: []
            });
        }
        const entry = groupsMap.get(key);
        entry.totalBalance = sanitizeFiniteAmount(entry.totalBalance + bal);
        entry.goals.push(g);
    });
    return Array.from(groupsMap.values());
}

function findGoalStoreGroupByKey(storeKey) {
    const normalized = normalizeStoreKey(storeKey);
    return getGoalStoreGroups().find(grp => grp.key === normalized) || null;
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
        const isGoalSource = String(srcId).startsWith('GOAL_') || (Array.isArray(log.goalAllocations) && log.goalAllocations.length > 0);

        if (log.type === 'PEMASUKAN') {
            if (Object.prototype.hasOwnProperty.call(balances, srcId)) balances[srcId] += amt;
            else balances[defaultAccId] += amt;
        } else if (log.type === 'PENGELUARAN') {
            if (!isGoalSource) {
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

function getAccountNameById(accId, logRef = null) {
    if (logRef && logRef.type === 'PENGELUARAN' && Array.isArray(logRef.goalAllocations) && logRef.goalAllocations.length > 0) {
        const storeLabel = logRef.goalStoreLabel || formatNormalizedStoreLabel(logRef.goalAllocations[0].storeKey);
        return `Impian (${storeLabel})`;
    }
    if (!accId) return userSettings.accounts[0]?.name || 'Kas Utama';
    if (String(accId).startsWith('GOAL_STORE_')) {
        const rawKey = String(accId).replace('GOAL_STORE_', '');
        const grp = findGoalStoreGroupByKey(rawKey);
        return grp ? `Impian (${grp.label})` : `Impian (${formatNormalizedStoreLabel(rawKey)})`;
    }
    if (String(accId).startsWith('GOAL_')) {
        const gid = Number(String(accId).replace('GOAL_', ''));
        const g = goals.find(x => x.id === gid);
        return g ? `Impian: ${g.name}` : 'Tabungan Impian (Terarsip)';
    }
    const found = userSettings.accounts.find(a => a.id === accId);
    return found ? found.name : (userSettings.accounts[0]?.name || 'Kas Utama');
}

// =========================================================================
// 5. DETERMINISTIC GOAL ALLOCATION & REVERSAL ENGINE
// =========================================================================
function computeDeterministicGoalAllocations(storeKey, totalAmount) {
    const cleanAmount = sanitizeFiniteAmount(totalAmount);
    if (cleanAmount <= 0) {
        return { ok: false, reason: 'Nominal pengeluaran harus lebih besar dari Rp0.', allocations: [], group: null };
    }

    const group = findGoalStoreGroupByKey(storeKey);
    if (!group || group.goals.length === 0) {
        return { ok: false, reason: 'Kelompok tempat penyimpanan Tabungan Impian tidak ditemukan.', allocations: [], group: null };
    }

    if (cleanAmount > group.totalBalance) {
        return {
            ok: false,
            reason: `Saldo gabungan Tabungan Impian di "${group.label}" (${formatRupiah(group.totalBalance, false)}) tidak mencukupi untuk penarikan ${formatRupiah(cleanAmount, false)}.`,
            allocations: [],
            group
        };
    }

    let remaining = cleanAmount;
    const allocations = [];

    for (let i = 0; i < group.goals.length && remaining > 0; i++) {
        const goal = group.goals[i];
        const available = sanitizeFiniteAmount(goal.current);
        if (available <= 0) continue;

        const take = Math.min(available, remaining);
        if (take > 0) {
            allocations.push({
                goalId: goal.id,
                goalName: goal.name,
                storeKey: group.key,
                amount: sanitizeFiniteAmount(take)
            });
            remaining = sanitizeFiniteAmount(remaining - take);
        }
    }

    const allocatedSum = sanitizeFiniteAmount(allocations.reduce((acc, item) => acc + (Number(item.amount) || 0), 0));
    if (remaining > 0 || allocatedSum !== cleanAmount) {
        return {
            ok: false,
            reason: 'Alokasi dana tidak dapat dipenuhi secara penuh dari saldo target yang tersedia.',
            allocations: [],
            group
        };
    }

    return { ok: true, allocations, group };
}

function applyGoalAllocations(allocations) {
    if (!Array.isArray(allocations)) return;
    allocations.forEach(alloc => {
        const g = goals.find(x => x.id === Number(alloc.goalId));
        if (g) {
            const take = sanitizeFiniteAmount(alloc.amount);
            g.current = sanitizeFiniteAmount(Math.max(0, (Number(g.current) || 0) - take));
        }
    });
}

function revertLogEffectOnGoals(log) {
    if (!log) return;
    const amt = Number(log.amount) || 0;

    if (log.type === 'TABUNGAN_GOAL' && String(log.category).startsWith('GOAL_')) {
        const gid = Number(String(log.category).replace('GOAL_', ''));
        const g = goals.find(x => x.id === gid);
        if (g) g.current = sanitizeFiniteAmount(Math.max(0, (Number(g.current) || 0) - amt));
        return;
    }

    if (log.type === 'PENGELUARAN') {
        if (Array.isArray(log.goalAllocations) && log.goalAllocations.length > 0) {
            log.goalAllocations.forEach(alloc => {
                const g = goals.find(x => x.id === Number(alloc.goalId));
                if (g) {
                    g.current = sanitizeFiniteAmount((Number(g.current) || 0) + (Number(alloc.amount) || 0));
                }
            });
            return;
        }
        if (String(log.accountId).startsWith('GOAL_') && !String(log.accountId).startsWith('GOAL_STORE_')) {
            const gid = Number(String(log.accountId).replace('GOAL_', ''));
            const g = goals.find(x => x.id === gid);
            if (g) g.current = sanitizeFiniteAmount((Number(g.current) || 0) + amt);
        }
    }
}

// =========================================================================
// 6. DATA PERSISTENCE & SERIALIZED QUEUE CLOUD SYNC ENGINE
// =========================================================================
function initApp() {
    initTheme();
    try {
        localStorage.removeItem('mona_user_session');
        localStorage.removeItem('mona_registered_accounts');
    } catch (e) {}

    const todayObj = new Date();
    const todayStr = getLocalDateString(todayObj);
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
                loadLocalData(firebaseUser.uid);
                updateAuthUI('syncing');
                setupFirestoreSync();
            } else {
                if (unsubscribeFirestore) {
                    unsubscribeFirestore();
                    unsubscribeFirestore = null;
                }
                currentUser = null;
                localRevision = 0;
                updateAuthUI('offline');
                loadLocalData(null);
            }
        });
    } else {
        updateAuthUI('offline');
        loadLocalData(null);
    }
}

function loadLocalData(uid = null) {
    try {
        let rawGoals, rawLogs, rawSettings, rawRev;
        if (uid) {
            const prefix = `mona_uid_${uid}_`;
            rawGoals = JSON.parse(localStorage.getItem(`${prefix}goals_v14`) || '[]');
            rawLogs = JSON.parse(localStorage.getItem(`${prefix}daily_logs_v14`) || '[]');
            rawSettings = JSON.parse(localStorage.getItem(`${prefix}settings_v14`) || 'null');
            rawRev = localStorage.getItem(`${prefix}revision_v14`) || '0';
        } else {
            rawGoals = JSON.parse(localStorage.getItem('mona_goals_v14') || '[]');
            rawLogs = JSON.parse(localStorage.getItem('mona_daily_logs_v14') || '[]');
            rawSettings = JSON.parse(localStorage.getItem('mona_settings_v14') || 'null');
            rawRev = localStorage.getItem('mona_guest_revision_v14') || '0';
        }

        localRevision = Number(rawRev) || 0;
        goals = Array.isArray(rawGoals) ? rawGoals.slice(0, MAX_GOALS_COUNT).map((g, i) => sanitizeGoalObject(g, i)).filter(Boolean) : [];
        dailyLogs = Array.isArray(rawLogs) ? rawLogs.slice(0, MAX_LOGS_COUNT).map((l, i) => sanitizeLogObject(l, i)).filter(Boolean) : [];
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
    try {
        if (currentUser) {
            const prefix = `mona_uid_${currentUser.uid}_`;
            localStorage.setItem(`${prefix}goals_v14`, JSON.stringify(goals));
            localStorage.setItem(`${prefix}daily_logs_v14`, JSON.stringify(dailyLogs));
            localStorage.setItem(`${prefix}settings_v14`, JSON.stringify(userSettings));
            localStorage.setItem(`${prefix}revision_v14`, String(localRevision));
        } else {
            localStorage.setItem('mona_goals_v14', JSON.stringify(goals));
            localStorage.setItem('mona_daily_logs_v14', JSON.stringify(dailyLogs));
            localStorage.setItem('mona_settings_v14', JSON.stringify(userSettings));
            localStorage.setItem('mona_guest_revision_v14', String(localRevision));
        }
        return true;
    } catch (err) {
        console.warn('Penyimpanan lokal penuh atau dibatasi:', err);
        return false;
    }
}

function saveData() {
    localRevision += 1;
    const localSaved = persistLocalCache();
    if (!localSaved) {
        showThemeAlert(
            'Kapasitas penyimpanan browser penuh atau dibatasi. Perubahan berisiko tidak tersimpan secara lokal.',
            'Peringatan Penyimpanan Lokal',
            'warning'
        );
    }

    if (!(currentUser && isFirebaseActive && db && auth && auth.currentUser)) {
        return Promise.resolve(localSaved);
    }

    return new Promise((resolve) => {
        pendingSyncResolvers.push(resolve);
        if (isSyncInProgress) {
            hasPendingSync = true;
            return;
        }
        flushSyncQueue();
    });
}

async function flushSyncQueue() {
    if (isSyncInProgress) return;
    isSyncInProgress = true;

    while (true) {
        hasPendingSync = false;
        const batchResolvers = pendingSyncResolvers.splice(0, pendingSyncResolvers.length);

        if (!(currentUser && isFirebaseActive && db && auth && auth.currentUser)) {
            batchResolvers.forEach(r => r(false));
            break;
        }

        updateAuthUI('syncing');
        let success = false;
        try {
            await db.collection('users').doc(auth.currentUser.uid).set({
                nickname: normalizePlainText(currentUser.nickname, 32),
                                                                       username: cleanAlphaNum(currentUser.username),
                                                                       goals: goals.slice(0, MAX_GOALS_COUNT),
                                                                       dailyLogs: dailyLogs.slice(0, MAX_LOGS_COUNT),
                                                                       userSettings: userSettings,
                                                                       revision: localRevision,
                                                                       updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            updateAuthUI('online');
            success = true;
        } catch (err) {
            console.error('Gagal menyinkronkan ke Firestore:', err);
            updateAuthUI('error');
            success = false;
        }

        batchResolvers.forEach(r => r(success));

        if (!hasPendingSync && pendingSyncResolvers.length === 0) {
            break;
        }
    }

    isSyncInProgress = false;
}

function setupFirestoreSync() {
    if (!currentUser || !isFirebaseActive || !db || !auth || !auth.currentUser) return;
    if (unsubscribeFirestore) unsubscribeFirestore();

    const uid = auth.currentUser.uid;
    unsubscribeFirestore = db.collection('users').doc(uid).onSnapshot((doc) => {
        if (doc.metadata.hasPendingWrites || isSyncInProgress) return;

        if (doc.exists) {
            const data = doc.data() || {};
            const remoteRev = Number(data.revision) || 0;
            if (remoteRev < localRevision && localRevision > 0) {
                saveData();
                return;
            }
            localRevision = remoteRev;

            if (typeof data.nickname === 'string' && data.nickname.trim()) {
                currentUser.nickname = normalizePlainText(data.nickname, 32);
            }
            if (typeof data.username === 'string' && data.username.trim()) {
                currentUser.username = cleanAlphaNum(data.username);
            }
            goals = Array.isArray(data.goals) ? data.goals.slice(0, MAX_GOALS_COUNT).map((g, i) => sanitizeGoalObject(g, i)).filter(Boolean) : [];
            dailyLogs = Array.isArray(data.dailyLogs) ? data.dailyLogs.slice(0, MAX_LOGS_COUNT).map((l, i) => sanitizeLogObject(l, i)).filter(Boolean) : [];
            userSettings = sanitizeSettingsObject(data.userSettings);
            ensureDefaultAccount();
            persistLocalCache();
            updateAuthUI('online');
            refreshAllViews();
        } else {
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
// 7. PROFIL TERPISAH, AUTH MODAL TERPISAH, AVATAR & MULTI-TABUNGAN
// =========================================================================
function switchProfileSection(sec) {
    ['PROFILE', 'SECURITY', 'SAVINGS', 'PREFS'].forEach(key => {
        const cap = key.charAt(0) + key.slice(1).toLowerCase();
        const tabEl = document.getElementById(`profTab${cap}`);
        const secEl = document.getElementById(`profSection${cap}`);
        if (tabEl) tabEl.classList.toggle('active', key === sec);
        if (secEl) secEl.style.display = (key === sec) ? 'block' : 'none';
    });

        if (sec === 'SAVINGS') renderSavingsAccountManager();
        if (sec === 'PREFS') {
            document.getElementById('inputDailyLimit').value = userSettings.dailyLimit ? userSettings.dailyLimit.toLocaleString('id-ID') : '';
            document.getElementById('inputMonthlyLimit').value = userSettings.monthlyLimit ? userSettings.monthlyLimit.toLocaleString('id-ID') : '';
        }
}

function openProfileModal(targetTab = 'PROFILE') {
    document.getElementById('avatarUploadMsg').textContent = '';
    if (document.getElementById('profileEditMsg')) document.getElementById('profileEditMsg').textContent = '';
    if (document.getElementById('oldPasswordForChange')) document.getElementById('oldPasswordForChange').value = '';
    if (document.getElementById('newPasswordInput')) document.getElementById('newPasswordInput').value = '';
    if (document.getElementById('oldPasswordForDelete')) document.getElementById('oldPasswordForDelete').value = '';

    renderAvatarUI();

    const guestNotice = document.getElementById('profileGuestNoticeBox');
    const editFormBox = document.getElementById('profileIdentityEditBox');
    const secLoggedIn = document.getElementById('securityLoggedInBox');
    const secGuest = document.getElementById('securityGuestBox');

    if (currentUser) {
        if (guestNotice) guestNotice.style.display = 'none';
        if (editFormBox) editFormBox.style.display = 'block';
        if (secLoggedIn) secLoggedIn.style.display = 'block';
        if (secGuest) secGuest.style.display = 'none';

        document.getElementById('editProfileNickname').value = normalizePlainText(currentUser.nickname, 32);
        document.getElementById('editProfileUsername').value = `@${cleanAlphaNum(currentUser.username)}`;
        document.getElementById('loggedInUserText').textContent = `${normalizePlainText(currentUser.nickname, 32)} (@${cleanAlphaNum(currentUser.username)})`;
    } else {
        if (guestNotice) guestNotice.style.display = 'block';
        if (editFormBox) editFormBox.style.display = 'none';
        if (secLoggedIn) secLoggedIn.style.display = 'none';
        if (secGuest) secGuest.style.display = 'block';
    }

    const mapped = (targetTab === 'TAB_ACCOUNTS' || targetTab === 'SAVINGS') ? 'SAVINGS'
    : (targetTab === 'LIMITS' || targetTab === 'PREFS') ? 'PREFS'
    : (targetTab === 'SECURITY') ? 'SECURITY'
    : 'PROFILE';

    switchProfileSection(mapped);
    document.getElementById('profileModal').classList.add('active');
}

function closeProfileModal() {
    document.getElementById('profileModal').classList.remove('active');
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

function openAuthModal(defaultMode = 'LOGIN') {
    closeProfileModal();
    document.getElementById('loginNickname').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('regUsername').value = '';
    document.getElementById('regNickname').value = '';
    document.getElementById('regPassword').value = '';
    switchAuthMode(defaultMode);
    document.getElementById('authModal').classList.add('active');
}

function closeAuthModal() {
    document.getElementById('authModal').classList.remove('active');
}

async function handleUpdateProfileIdentity(e) {
    e.preventDefault();
    if (!currentUser || !auth || !auth.currentUser) return;

    const newNickname = normalizePlainText(document.getElementById('editProfileNickname').value, 32);
    const msgEl = document.getElementById('profileEditMsg');

    if (!newNickname) {
        await showThemeAlert('Nama tampilan tidak boleh kosong.', 'Validasi Profil', 'warning');
        return;
    }

    const btn = document.getElementById('btnSaveProfileIdentity');
    if (btn) btn.disabled = true;

    try {
        await auth.currentUser.updateProfile({ displayName: newNickname });
        currentUser.nickname = newNickname;
        const ok = await saveData();
        updateAuthUI(ok ? 'online' : 'error');
        if (msgEl) {
            msgEl.style.color = ok ? 'var(--accent-green)' : 'var(--accent-amber)';
            msgEl.textContent = ok
            ? 'Nama tampilan profil berhasil diperbarui.'
            : 'Tersimpan lokal, namun gagal menyinkronkan ke cloud.';
        }
    } catch (err) {
        if (msgEl) {
            msgEl.style.color = 'var(--accent-rose)';
            msgEl.textContent = 'Gagal memperbarui profil: ' + (err.message || 'Kesalahan sistem.');
        }
    } finally {
        if (btn) btn.disabled = false;
    }
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
    const ok = await saveData();
    renderAvatarUI();
    document.getElementById('avatarUploadMsg').textContent = ok
    ? 'Foto profil dihapus.'
    : 'Foto profil dihapus secara lokal (sinkronisasi cloud tertunda).';
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
        infoDiv.style.minWidth = '0';

        const typeDiv = document.createElement('div');
        typeDiv.style.cssText = 'font-size:0.68rem; color:var(--text-muted); font-weight:600; overflow-wrap:anywhere;';
        typeDiv.textContent = acc.type;

        const nameDiv = document.createElement('div');
        nameDiv.style.cssText = 'font-size:0.84rem; font-weight:700; overflow-wrap:anywhere;';
        nameDiv.textContent = acc.name;

        const balDiv = document.createElement('div');
        balDiv.style.cssText = 'font-size:0.78rem; color:var(--accent-blue); font-weight:700; overflow-wrap:anywhere;';
        balDiv.textContent = `Saldo Saat Ini: ${formatRupiah(bal)}`;

        infoDiv.append(typeDiv, nameDiv, balDiv);

        const actionsDiv = document.createElement('div');
        actionsDiv.style.cssText = 'display:flex; gap:5px; flex-shrink:0;';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn-blue';
        editBtn.style.cssText = 'padding:4px 8px; min-height:28px; font-size:0.72rem;';
        editBtn.textContent = 'Ubah';
        editBtn.addEventListener('click', () => openEditAccountModal(acc.id));
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
    if (userSettings.accounts.length >= MAX_ACCOUNTS_COUNT) {
        await showThemeAlert(`Batas maksimum ${MAX_ACCOUNTS_COUNT} media tabungan telah tercapai.`, 'Batas Media Tabungan', 'warning');
        return;
    }

    const name = normalizePlainText(document.getElementById('newAccName').value, 30);
    const type = normalizePlainText(document.getElementById('newAccType').value, 30);
    const initialBalance = parseMoneyInput(document.getElementById('newAccBalance').value);

    if (!name) {
        await showThemeAlert('Nama media tabungan wajib diisi!', 'Validasi Media Tabungan', 'warning');
        return;
    }

    const btn = document.getElementById('btnAddSavingsAccount');
    if (btn) btn.disabled = true;

    try {
        userSettings.accounts.push({
            id: 'acc_' + generateUniqueNumericId(),
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
    } finally {
        if (btn) btn.disabled = false;
    }
}

function openEditAccountModal(accId) {
    ensureDefaultAccount();
    const acc = userSettings.accounts.find(a => a.id === accId);
    if (!acc) return;

    const balances = calculateAccountBalances();
    const currentBalance = Number(balances[acc.id]) || 0;

    document.getElementById('editAccId').value = acc.id;
    document.getElementById('editAccName').value = acc.name;

    const typeSelect = document.getElementById('editAccType');
    const hasOption = Array.from(typeSelect.options).some(opt => opt.value === acc.type);
    if (!hasOption && acc.type) {
        const customOpt = document.createElement('option');
        customOpt.value = acc.type;
        customOpt.textContent = acc.type;
        typeSelect.appendChild(customOpt);
    }
    typeSelect.value = acc.type || 'Bank Digital';

    const balInput = document.getElementById('editAccCurrentBalance');
    balInput.value = currentBalance === 0 ? '0' : Math.round(currentBalance).toLocaleString('id-ID');

    document.getElementById('editAccountModal').classList.add('active');
}

function closeEditAccountModal() {
    document.getElementById('editAccountModal').classList.remove('active');
}

async function saveEditAccountModal(e) {
    if (e) e.preventDefault();
    const accId = document.getElementById('editAccId').value;
    const acc = userSettings.accounts.find(a => a.id === accId);
    if (!acc) return;

    const newName = normalizePlainText(document.getElementById('editAccName').value, 30);
    const newType = normalizePlainText(document.getElementById('editAccType').value, 30);
    const rawBalStr = document.getElementById('editAccCurrentBalance').value.trim();

    if (!newName) {
        await showThemeAlert('Nama media tabungan wajib diisi.', 'Validasi Media Tabungan', 'warning');
        return;
    }
    if (!rawBalStr) {
        await showThemeAlert('Nominal saldo saat ini wajib diisi (isi 0 jika kosong).', 'Validasi Saldo', 'warning');
        return;
    }

    const newTargetBalance = parseMoneyInput(rawBalStr);
    const balances = calculateAccountBalances();
    const currentBalance = Number(balances[acc.id]) || 0;
    const oldInitialBalance = Number(acc.initialBalance) || 0;

    const transactionNetDelta = currentBalance - oldInitialBalance;
    const newInitialBalance = sanitizeFiniteAmount(newTargetBalance - transactionNetDelta);

    const prevName = acc.name;
    const prevType = acc.type;
    const prevInitial = acc.initialBalance;
    const prevGoals = goals.map(g => ({ ...g }));

    acc.name = newName;
    acc.type = newType || prevType;
    acc.initialBalance = newInitialBalance;

    goals.forEach(g => {
        if (g.sourceFromId === accId) {
            g.sourceFromName = newName;
        }
    });

    const btn = document.getElementById('btnSaveEditAccountModal');
    if (btn) btn.disabled = true;

    try {
        const saved = await saveData();
        if (!saved && currentUser && isFirebaseActive) {
            acc.name = prevName;
            acc.type = prevType;
            acc.initialBalance = prevInitial;
            goals = prevGoals;
            await showThemeAlert('Gagal menyimpan perubahan ke server. Data dikembalikan ke kondisi sebelumnya.', 'Gagal Menyimpan', 'error');
            return;
        }

        renderSavingsAccountManager();
        updateTransactionFormOptions();
        renderGoals();
        updateAllCalculations();
        closeEditAccountModal();
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteSavingsAccount(accId) {
    if (userSettings.accounts.length <= 1) return;
    const agreed = await showVerificationConfirmModal({
        title: 'Hapus Media Tabungan',
        message: 'Hapus media tabungan ini? Riwayat transaksi lama dan referensi sumber tabungan impian akan dialihkan ke rekening utama.',
        confirmLabel: 'Ya, Hapus Media'
    });
    if (!agreed) return;

    userSettings.accounts = userSettings.accounts.filter(a => a.id !== accId);
    const fallbackAcc = userSettings.accounts[0];

    goals.forEach(g => {
        if (g.sourceFromId === accId) {
            g.sourceFromId = fallbackAcc.id;
            g.sourceFromName = fallbackAcc.name;
        }
    });

    await saveData();
    renderSavingsAccountManager();
    updateTransactionFormOptions();
    renderGoals();
    updateAllCalculations();
}

async function handleSaveSpendingLimits() {
    userSettings.dailyLimit = parseMoneyInput(document.getElementById('inputDailyLimit').value);
    userSettings.monthlyLimit = parseMoneyInput(document.getElementById('inputMonthlyLimit').value);
    const ok = await saveData();
    updateAllCalculations();
    await showThemeAlert(
        ok ? 'Batas pengeluaran harian dan bulanan berhasil disimpan.' : 'Tersimpan lokal, namun gagal menyinkronkan ke cloud.',
        'Batas Pengeluaran',
        ok ? 'success' : 'warning'
    );
}

// =========================================================================
// FIREBASE AUTHENTICATION (USERNAME -> INTERNAL EMAIL ALIAS)
// =========================================================================
async function handleAuthRegister() {
    if (!isFirebaseActive || !auth) {
        await showThemeAlert('Layanan sinkronisasi cloud sedang tidak aktif.', 'Koneksi Cloud', 'warning');
        return;
    }

    const username = cleanAlphaNum(document.getElementById('regUsername').value);
    const nickname = normalizePlainText(document.getElementById('regNickname').value, 32);
    const rawPass = document.getElementById('regPassword').value;

    if (!username || username.length < 4) {
        await showThemeAlert('Username wajib diisi minimal 4 karakter (huruf, angka, garis bawah, atau tanda hubung).', 'Validasi Registrasi', 'warning');
        return;
    }
    if (!nickname) {
        await showThemeAlert('Nama tampilan wajib diisi.', 'Validasi Registrasi', 'warning');
        return;
    }
    if (!validateStrongPassword(rawPass)) {
        await showThemeAlert('Password wajib minimal 8 karakter dengan kombinasi huruf dan angka.', 'Validasi Password', 'warning');
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
        closeAuthModal();
        await showThemeAlert(`Akun ${nickname} (@${username}) berhasil didaftarkan dan tersinkronisasi aman.`, 'Registrasi Berhasil', 'success');
    } catch (err) {
        if (err.code === 'auth/email-already-in-use') {
            await showThemeAlert('Username telah digunakan. Silakan pilih username lain.', 'Registrasi Gagal', 'error');
        } else if (err.code === 'auth/weak-password') {
            await showThemeAlert('Password terlalu lemah. Gunakan minimal 8 karakter kombinasi huruf dan angka.', 'Registrasi Gagal', 'error');
        } else {
            await showThemeAlert('Gagal melakukan registrasi: ' + (err.message || 'Terjadi kesalahan.'), 'Registrasi Gagal', 'error');
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function handleAuthLogin() {
    if (!isFirebaseActive || !auth) {
        await showThemeAlert('Layanan sinkronisasi cloud sedang tidak aktif.', 'Koneksi Cloud', 'warning');
        return;
    }

    const rawUsername = document.getElementById('loginNickname').value;
    const rawPass = document.getElementById('loginPassword').value;
    const username = cleanAlphaNum(rawUsername);

    if (!username || !rawPass) {
        await showThemeAlert('Mohon isi Username dan Password.', 'Validasi Login', 'warning');
        return;
    }

    const internalEmail = usernameToInternalEmail(username);
    const btn = document.getElementById('btnSubmitLogin');
    if (btn) btn.disabled = true;

    try {
        await auth.signInWithEmailAndPassword(internalEmail, rawPass);
        closeAuthModal();
    } catch (err) {
        if (err.code === 'auth/too-many-requests') {
            await showThemeAlert('Terlalu banyak percobaan login gagal. Silakan tunggu beberapa menit sebelum mencoba lagi.', 'Akses Dibatasi Sementara', 'error');
        } else {
            await showThemeAlert('Username atau Password tidak sesuai.', 'Login Gagal', 'error');
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
        await showThemeAlert('Masukkan password lama untuk verifikasi.', 'Validasi Keamanan', 'warning');
        return;
    }
    if (!validateStrongPassword(newPass)) {
        await showThemeAlert('Password baru wajib minimal 8 karakter dengan kombinasi huruf dan angka.', 'Validasi Password', 'warning');
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
        await showThemeAlert('Password akun berhasil diperbarui dengan aman.', 'Password Diperbarui', 'success');
    } catch (err) {
        if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
            await showThemeAlert('Verifikasi Gagal: Password lama yang Anda masukkan tidak sesuai.', 'Verifikasi Gagal', 'error');
        } else {
            await showThemeAlert('Gagal memperbarui password: ' + (err.message || 'Terjadi kesalahan.'), 'Gagal Memperbarui', 'error');
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
    localRevision = 0;
    isGuestNoticeDismissed = false;
    updateAuthUI('offline');
    closeProfileModal();
    loadLocalData(null);
}

async function handleResetAppData() {
    const agreed = await showVerificationConfirmModal({
        title: 'Reset Seluruh Data Transaksi',
        message: 'PERINGATAN: Seluruh riwayat transaksi dan target impian akan dikosongkan. Tindakan ini tidak dapat dibatalkan. Lanjutkan?',
        confirmLabel: 'Ya, Reset Semua'
    });
    if (!agreed) return;
    goals = [];
    dailyLogs = [];
    userSettings.accounts.forEach(a => a.initialBalance = 0);
    const ok = await saveData();
    refreshAllViews();
    closeProfileModal();
    await showThemeAlert(
        ok ? 'Seluruh data mutasi berhasil di-reset dan tersinkronisasi.' : 'Data di-reset secara lokal, namun sinkronisasi ke cloud gagal.',
        'Reset Data',
        ok ? 'success' : 'warning'
    );
}

async function handleDeleteAccount() {
    if (!currentUser || !auth || !auth.currentUser || !db) return;

    const confirmOldPass = document.getElementById('oldPasswordForDelete').value;
    if (!confirmOldPass) {
        await showThemeAlert('Masukkan password lama Anda pada kolom konfirmasi untuk menghapus akun.', 'Konfirmasi Diperlukan', 'warning');
        return;
    }

    const agreed = await showVerificationConfirmModal({
        title: 'Hapus Akun Permanen',
        message: `KONFIRMASI AKHIR: Akun @${currentUser.username} beserta seluruh data keuangan akan dihapus permanen. Lanjutkan?`,
        confirmLabel: 'Ya, Hapus Permanen'
    });
    if (!agreed) return;

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

        const revAfterDeleteAttempt = localRevision + 1;
        await db.collection('users').doc(uid).delete();
        try {
            await user.delete();
        } catch (authDelErr) {
            await db.collection('users').doc(uid).set({
                nickname: currentUser.nickname,
                username: currentUser.username,
                goals: [],
                dailyLogs: [],
                userSettings: sanitizeSettingsObject(null),
                                                      revision: revAfterDeleteAttempt,
                                                      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            throw authDelErr;
        }

        try {
            localStorage.removeItem(`mona_uid_${uid}_goals_v14`);
            localStorage.removeItem(`mona_uid_${uid}_daily_logs_v14`);
            localStorage.removeItem(`mona_uid_${uid}_settings_v14`);
            localStorage.removeItem(`mona_uid_${uid}_revision_v14`);
        } catch (e) {}

        goals = [];
        dailyLogs = [];
        currentUser = null;
        localRevision = 0;
        isGuestNoticeDismissed = false;
        updateAuthUI('offline');
        closeProfileModal();
        loadLocalData(null);
        await showThemeAlert('Akun dan seluruh data Anda telah dihapus secara permanen.', 'Akun Dihapus', 'success');
    } catch (err) {
        if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
            await showThemeAlert('Verifikasi Gagal: Password lama salah. Penghapusan akun dibatalkan.', 'Verifikasi Gagal', 'error');
        } else {
            await showThemeAlert('Gagal menghapus akun: ' + (err.message || 'Terjadi kesalahan.'), 'Gagal Menghapus Akun', 'error');
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}

function dismissGuestNotice() {
    isGuestNoticeDismissed = true;
    const localNoticeBanner = document.getElementById('localGuestSyncNotice');
    if (localNoticeBanner) localNoticeBanner.style.display = 'none';
}

function updateAuthUI(status = 'offline') {
    const dot = document.getElementById('syncStatusDot');
    const statusText = document.getElementById('userStatusText');
    const pdfOwner = document.getElementById('pdfPrintOwner');
    const localNoticeBanner = document.getElementById('localGuestSyncNotice');

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
        if (localNoticeBanner) localNoticeBanner.style.display = 'none';
    } else {
        dot.classList.remove('online');
        statusText.textContent = 'Mode Tamu (Lokal)';
        if (pdfOwner) pdfOwner.textContent = 'Pengguna Lokal';
        if (localNoticeBanner) {
            localNoticeBanner.style.display = isGuestNoticeDismissed ? 'none' : 'flex';
        }
    }
}

// =========================================================================
// 8. UI NAVIGATION, EXPENSE GOAL TOGGLE & DYNAMIC FORM SELECTORS
// =========================================================================
function switchTab(tabId, btnElem) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    if (btnElem) btnElem.classList.add('active');
    const target = document.getElementById(tabId);
    if (target) {
        target.classList.add('active');
        if (typeof animatePanelEntrance === 'function') animatePanelEntrance(target);
    }
}

function toggleFilterModeControls() {
    const mode = document.getElementById('timeFilterMode').value;
    document.getElementById('ctrlMonthGroup').style.display = (mode === 'MONTHLY') ? 'block' : 'none';
    document.getElementById('ctrlWeekGroup').style.display = (mode === 'WEEKLY') ? 'block' : 'none';
    document.getElementById('ctrlRangeStartGroup').style.display = (mode === 'RANGE') ? 'block' : 'none';
    document.getElementById('ctrlRangeEndGroup').style.display = (mode === 'RANGE') ? 'block' : 'none';
    updateAllCalculations();
}

function syncExpenseGoalToggleUI(type) {
    const toggleBox = document.getElementById('expenseGoalToggleBox');
    const switchBtn = document.getElementById('btnToggleUseGoalFunds');
    const statusLabel = document.getElementById('goalToggleStatusText');
    const descLabel = document.getElementById('goalToggleDescText');

    if (type !== 'PENGELUARAN') {
        useGoalFundsForExpense = false;
        if (toggleBox) toggleBox.style.display = 'none';
    } else if (toggleBox) {
        toggleBox.style.display = 'flex';
    }

    if (switchBtn) {
        switchBtn.setAttribute('aria-checked', useGoalFundsForExpense ? 'true' : 'false');
    }
    if (statusLabel) {
        statusLabel.textContent = useGoalFundsForExpense ? 'ON' : 'OFF';
        statusLabel.classList.toggle('is-on', useGoalFundsForExpense);
    }
    if (descLabel) {
        descLabel.textContent = useGoalFundsForExpense
        ? 'Mengambil dari saldo gabungan Tabungan Impian per tempat penyimpanan.'
        : 'Mengambil dari media tabungan utama (rekening, bank digital, e-wallet, tunai).';
    }
}

let lastGoalToggleTime = 0;

function toggleExpenseGoalSource(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    const now = Date.now();
    if (now - lastGoalToggleTime < 180) return;
    lastGoalToggleTime = now;

    const typeEl = document.getElementById('dailyType');
    const currentType = typeEl ? typeEl.value : 'PENGELUARAN';
    if (currentType !== 'PENGELUARAN') {
        useGoalFundsForExpense = false;
        syncExpenseGoalToggleUI(currentType);
        return;
    }

    useGoalFundsForExpense = !useGoalFundsForExpense;
    syncExpenseGoalToggleUI('PENGELUARAN');

    const accSelect = document.getElementById('dailyAccountSource');
    const lblAcc = document.getElementById('lblDailyAccount');
    if (lblAcc) {
        lblAcc.textContent = useGoalFundsForExpense
            ? 'Sumber Tabungan Impian'
            : 'Sumber Dana Pengeluaran';
    }
    populateAccountSourceSelect(accSelect, 'PENGELUARAN', '', null);
}

function populateAccountSourceSelect(selectElem, type, selectedVal = '', logContext = null) {
    if (!selectElem) return;
    ensureDefaultAccount();
    const isMulti = userSettings.savingsMode === 'MULTI';
    const visibleAccounts = isMulti ? userSettings.accounts : [userSettings.accounts[0]];
    const balances = calculateAccountBalances();

    selectElem.textContent = '';

    const isExpenseFromGoalGroup = (type === 'PENGELUARAN') && (
        (logContext && (Array.isArray(logContext.goalAllocations) && logContext.goalAllocations.length > 0 || String(logContext.accountId).startsWith('GOAL_'))) ||
        (!logContext && useGoalFundsForExpense)
    );

    if (isExpenseFromGoalGroup) {
        const storeGroups = getGoalStoreGroups();
        if (storeGroups.length === 0) {
            const emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.textContent = '-- Belum Ada Tabungan Impian --';
            selectElem.appendChild(emptyOpt);
            return;
        }

        const goalGroupOpt = document.createElement('optgroup');
        goalGroupOpt.label = 'Tabungan Impian (Per Tempat Penyimpanan)';
        storeGroups.forEach((grp) => {
            const opt = document.createElement('option');
            opt.value = `GOAL_STORE_${grp.key}`;
            opt.textContent = `${grp.label} — ${formatRupiah(grp.totalBalance, false)}`;
            goalGroupOpt.appendChild(opt);
        });
        selectElem.appendChild(goalGroupOpt);

        if (selectedVal && String(selectedVal).startsWith('GOAL_') && !String(selectedVal).startsWith('GOAL_STORE_')) {
            const legacyId = Number(String(selectedVal).replace('GOAL_', ''));
            const legacyGoal = goals.find(g => g.id === legacyId);
            if (legacyGoal) {
                const matchedGroup = findGoalStoreGroupByKey(legacyGoal.storeIn);
                if (matchedGroup) {
                    selectElem.value = `GOAL_STORE_${matchedGroup.key}`;
                    return;
                }
            }
            const archivedOpt = document.createElement('option');
            archivedOpt.value = selectedVal;
            archivedOpt.textContent = 'Tabungan Impian (Target Terarsip)';
            selectElem.appendChild(archivedOpt);
            selectElem.value = selectedVal;
            return;
        }

        if (selectedVal && Array.from(selectElem.options).some(o => o.value === selectedVal)) {
            selectElem.value = selectedVal;
        } else if (selectElem.options.length > 0) {
            selectElem.selectedIndex = 0;
        }
        return;
    }

    const mainGroup = document.createElement('optgroup');
    mainGroup.label = 'Media Tabungan Utama';
    visibleAccounts.forEach(acc => {
        const opt = document.createElement('option');
        opt.value = acc.id;
        opt.textContent = `${acc.name} (${formatRupiah(balances[acc.id] || 0, false)})`;
        mainGroup.appendChild(opt);
    });
    selectElem.appendChild(mainGroup);

    if (selectedVal && Array.from(selectElem.options).some(o => o.value === selectedVal)) {
        selectElem.value = selectedVal;
    } else if (selectElem.options.length > 0) {
        selectElem.selectedIndex = 0;
    }
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

    if (selectedVal && Array.from(selectElem.options).some(o => o.value === selectedVal)) {
        selectElem.value = selectedVal;
    }
}

function updateTransactionFormOptions() {
    const type = document.getElementById('dailyType').value;
    const lblAcc = document.getElementById('lblDailyAccount');

    if (type !== 'PENGELUARAN') {
        useGoalFundsForExpense = false;
    }
    syncExpenseGoalToggleUI(type);

    if (type === 'PEMASUKAN') {
        lblAcc.textContent = 'Masuk ke Media Tabungan';
    } else if (type === 'TABUNGAN_GOAL') {
        lblAcc.textContent = 'Ambil dari Sumber Tabungan';
    } else {
        lblAcc.textContent = useGoalFundsForExpense
        ? 'Sumber Tabungan Impian (Per Tempat Penyimpanan)'
        : 'Sumber Dana Pengeluaran';
    }

    populateAccountSourceSelect(document.getElementById('dailyAccountSource'), type, '', null);
    populateCategorySelect(document.getElementById('dailyCategory'), type);
}

function updateEditTransactionFormOptions(selectedAcc = '', selectedCat = '', logContext = null) {
    const type = document.getElementById('editLogType').value;
    populateAccountSourceSelect(document.getElementById('editLogAccountSource'), type, selectedAcc, logContext);
    populateCategorySelect(document.getElementById('editLogCategory'), type, selectedCat);
}

// =========================================================================
// 9. TRANSACTION MUTATION HANDLERS (ATOMIC VALIDATION & DETERMINISTIC GOAL SPLIT)
// =========================================================================
async function handleDailySubmit(e) {
    e.preventDefault();
    if (dailyLogs.length >= MAX_LOGS_COUNT) {
        await showThemeAlert(`Batas maksimum ${MAX_LOGS_COUNT} catatan mutasi telah tercapai.`, 'Batas Riwayat Mutasi', 'warning');
        return;
    }

    const date = document.getElementById('dailyDate').value;
    const type = document.getElementById('dailyType').value;
    const accountId = document.getElementById('dailyAccountSource').value;
    const category = document.getElementById('dailyCategory').value;
    const title = normalizePlainText(document.getElementById('dailyTitle').value, 80);
    const amount = parseMoneyInput(document.getElementById('dailyAmount').value);
    const notes = normalizePlainText(document.getElementById('dailyNotes').value, 120);

    if (!isValidIsoDate(date) || !title || amount <= 0) {
        await showThemeAlert('Mohon lengkapi tanggal, deskripsi, dan nominal transaksi yang valid.', 'Validasi Transaksi', 'warning');
        return;
    }

    if (type === 'TABUNGAN_GOAL') {
        if (!category || category === 'GOAL_NONE' || !String(category).startsWith('GOAL_')) {
            await showThemeAlert('Silakan buat dan pilih Tabungan Impian terlebih dahulu.', 'Tabungan Impian Kosong', 'warning');
            return;
        }
        const goalId = Number(category.replace('GOAL_', ''));
        const goal = goals.find(g => g.id === goalId);
        if (!goal) {
            await showThemeAlert('Tabungan impian tujuan tidak ditemukan.', 'Data Tidak Ditemukan', 'error');
            return;
        }
    }

    let computedGoalAllocations = [];
    let resolvedGoalStoreLabel = '';

    if (type === 'PENGELUARAN' && useGoalFundsForExpense) {
        if (!String(accountId).startsWith('GOAL_STORE_')) {
            await showThemeAlert('Pilih kelompok tempat penyimpanan Tabungan Impian yang valid.', 'Validasi Sumber Impian', 'warning');
            return;
        }
        const storeKey = String(accountId).replace('GOAL_STORE_', '');
        const allocResult = computeDeterministicGoalAllocations(storeKey, amount);
        if (!allocResult.ok) {
            await showThemeAlert(allocResult.reason, 'Saldo Tabungan Impian Tidak Mencukupi', 'error');
            return;
        }
        computedGoalAllocations = allocResult.allocations;
        resolvedGoalStoreLabel = allocResult.group.label;
    } else if ((type === 'PENGELUARAN' && !String(accountId).startsWith('GOAL_')) || type === 'TABUNGAN_GOAL') {
        const balances = calculateAccountBalances();
        const currentBal = balances[accountId] || 0;
        if (amount > currentBal) {
            const accName = getAccountNameById(accountId);
            const proceedOverdraft = await showVerificationConfirmModal({
                title: 'Saldo Sumber Tidak Mencukupi',
                message: `Saldo "${accName}" saat ini ${formatRupiah(currentBal, false)}, lebih kecil dari nominal transaksi ${formatRupiah(amount, false)}. Lanjutkan pencatatan (saldo akan minus)?`,
                                                                        confirmLabel: 'Ya, Tetap Catat'
            });
            if (!proceedOverdraft) return;
        }
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        if (type === 'TABUNGAN_GOAL') {
            const goalId = Number(category.replace('GOAL_', ''));
            const goal = goals.find(g => g.id === goalId);
            if (goal) {
                goal.current = sanitizeFiniteAmount((Number(goal.current) || 0) + amount);
            }
        } else if (type === 'PENGELUARAN' && useGoalFundsForExpense) {
            applyGoalAllocations(computedGoalAllocations);
        }

        const newLog = sanitizeLogObject({
            id: generateUniqueNumericId(),
                                         date,
                                         type,
                                         accountId,
                                         category,
                                         title,
                                         amount,
                                         notes,
                                         goalAllocations: computedGoalAllocations,
                                         goalStoreLabel: resolvedGoalStoreLabel
        });

        dailyLogs.unshift(newLog);

        await saveData();
        refreshAllViews();

        document.getElementById('dailyTitle').value = '';
        document.getElementById('dailyAmount').value = '';
        document.getElementById('dailyNotes').value = '';
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

function openEditLogModal(id) {
    const log = dailyLogs.find(l => l.id === id);
    if (!log) return;

    document.getElementById('editLogId').value = log.id;
    document.getElementById('editLogDate').value = log.date;
    document.getElementById('editLogType').value = log.type;
    updateEditTransactionFormOptions(log.accountId, log.category, log);
    document.getElementById('editLogTitle').value = log.title;
    document.getElementById('editLogAmount').value = log.amount ? log.amount.toLocaleString('id-ID') : '';
    document.getElementById('editLogNotes').value = log.notes || '';
    document.getElementById('editLogModal').classList.add('active');
}

function closeEditLogModal() {
    document.getElementById('editLogModal').classList.remove('active');
}

async function saveEditLogModal() {
    const id = Number(document.getElementById('editLogId').value);
    const idx = dailyLogs.findIndex(l => l.id === id);
    if (idx === -1) return;

    const originalLog = dailyLogs[idx];
    const prevGoalsSnapshot = goals.map(g => ({ ...g }));

    const date = document.getElementById('editLogDate').value;
    const type = document.getElementById('editLogType').value;
    const accountId = document.getElementById('editLogAccountSource').value;
    const category = document.getElementById('editLogCategory').value;
    const title = normalizePlainText(document.getElementById('editLogTitle').value, 80);
    const amount = parseMoneyInput(document.getElementById('editLogAmount').value);
    const notes = normalizePlainText(document.getElementById('editLogNotes').value, 120);

    if (!isValidIsoDate(date) || !title || amount <= 0) {
        await showThemeAlert('Mohon lengkapi data perubahan transaksi dengan benar.', 'Validasi Perubahan', 'warning');
        return;
    }

    if (type === 'TABUNGAN_GOAL') {
        if (!category || category === 'GOAL_NONE' || !String(category).startsWith('GOAL_')) {
            await showThemeAlert('Pilih target Tabungan Impian yang valid untuk jenis mutasi alokasi.', 'Validasi Target', 'warning');
            return;
        }
        const targetGid = Number(String(category).replace('GOAL_', ''));
        if (!goals.some(x => x.id === targetGid)) {
            await showThemeAlert('Target Tabungan Impian yang dipilih sudah tidak tersedia.', 'Target Tidak Ditemukan', 'error');
            return;
        }
    }

    // 1. Kembalikan alokasi / efek transaksi sebelumnya pada target impian
    revertLogEffectOnGoals(originalLog);

    let newGoalAllocations = [];
    let newGoalStoreLabel = '';

    // 2. Validasi sumber dana dan saldo terbaru, lalu hitung alokasi baru
    if (type === 'PENGELUARAN' && String(accountId).startsWith('GOAL_STORE_')) {
        const storeKey = String(accountId).replace('GOAL_STORE_', '');
        const allocResult = computeDeterministicGoalAllocations(storeKey, amount);
        if (!allocResult.ok) {
            goals = prevGoalsSnapshot;
            await showThemeAlert(allocResult.reason, 'Saldo Tabungan Impian Tidak Mencukupi', 'error');
            return;
        }
        newGoalAllocations = allocResult.allocations;
        newGoalStoreLabel = allocResult.group.label;
        applyGoalAllocations(newGoalAllocations);
    } else if (type === 'PENGELUARAN' && String(accountId).startsWith('GOAL_')) {
        const gid = Number(String(accountId).replace('GOAL_', ''));
        const g = goals.find(x => x.id === gid);
        if (!g) {
            goals = prevGoalsSnapshot;
            await showThemeAlert('Target Tabungan Impian sudah tidak tersedia.', 'Target Tidak Ditemukan', 'error');
            return;
        }
        if (amount > (Number(g.current) || 0)) {
            goals = prevGoalsSnapshot;
            await showThemeAlert(
                `Saldo tabungan impian "${g.name}" (${formatRupiah(g.current, false)}) tidak mencukupi untuk penarikan ${formatRupiah(amount, false)}.`,
                                 'Saldo Tabungan Impian Tidak Mencukupi',
                                 'error'
            );
            return;
        }
        g.current = sanitizeFiniteAmount((Number(g.current) || 0) - amount);
        newGoalAllocations = [{
            goalId: g.id,
            goalName: g.name,
            storeKey: normalizeStoreKey(g.storeIn),
            amount
        }];
        newGoalStoreLabel = formatNormalizedStoreLabel(g.storeIn);
    } else if (type === 'TABUNGAN_GOAL' && String(category).startsWith('GOAL_')) {
        const gid = Number(String(category).replace('GOAL_', ''));
        const g = goals.find(x => x.id === gid);
        if (g) g.current = sanitizeFiniteAmount((Number(g.current) || 0) + amount);
    }

    // 3. Simpan transaksi dan alokasi yang baru secara tunggal
    dailyLogs[idx] = sanitizeLogObject({
        id,
        date,
        type,
        accountId,
        category,
        title,
        amount,
        notes,
        goalAllocations: newGoalAllocations,
        goalStoreLabel: newGoalStoreLabel
    });

    await saveData();
    refreshAllViews();
    closeEditLogModal();
}

async function deleteDailyLog(id) {
    const agreed = await showVerificationConfirmModal({
        title: 'Hapus Mutasi Transaksi',
        message: 'Apakah Anda yakin ingin menghapus catatan mutasi transaksi ini?',
        confirmLabel: 'Ya, Hapus'
    });
    if (!agreed) return;
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
            const startStr = getLocalDateString(startDate);
            const endStr = getLocalDateString(endDate);
            return logDateStr >= startStr && logDateStr <= endStr;
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
            const gid = Number(String(log.category).replace('GOAL_', ''));
            const g = goals.find(x => x.id === gid);
            displayCat = g ? `Impian: ${g.name}` : 'Alokasi Impian (Terarsip)';
        }

        const mediaName = getAccountNameById(log.accountId, log);
        const dParts = isValidIsoDate(log.date) ? log.date.split('-') : [];
        const shortDate = dParts.length === 3 ? `${dParts[2]}/${dParts[1]}` : '-';

        const tr = document.createElement('tr');

        const tdDate = document.createElement('td');
        tdDate.style.cssText = 'white-space:nowrap; color:var(--text-secondary); font-size:0.75rem;';
        const strongDate = document.createElement('strong');
        strongDate.textContent = shortDate;
        tdDate.appendChild(strongDate);

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

        if (Array.isArray(log.goalAllocations) && log.goalAllocations.length > 0) {
            const allocSummary = log.goalAllocations
            .map(a => `${a.goalName}: ${formatRupiah(a.amount, false)}`)
            .join(' · ');
            const allocDiv = document.createElement('div');
            allocDiv.className = 'item-meta';
            allocDiv.textContent = `Alokasi: ${allocSummary}`;
            tdInfo.appendChild(allocDiv);
        }

        if (log.notes) {
            const notesDiv = document.createElement('div');
            notesDiv.className = 'item-meta';
            notesDiv.textContent = log.notes;
            tdInfo.appendChild(notesDiv);
        }

        const tdAmt = document.createElement('td');
        tdAmt.className = 'text-right font-bold';
        const colorVar = log.type === 'PEMASUKAN'
        ? 'var(--accent-green)'
        : (log.type === 'TABUNGAN_GOAL' ? 'var(--accent-purple)' : 'var(--accent-rose)');
        tdAmt.style.cssText = `white-space:nowrap; font-size:0.78rem; color:${colorVar};`;
        tdAmt.textContent = `${log.type === 'PEMASUKAN' ? '+' : '-'}${formatRupiah(log.amount)}`;

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
// 10. TABUNGAN IMPIAN ENGINE (TERMASUK MODAL SETOR SESUAI TEMA & RENCANA)
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

        const storeLabel = formatNormalizedStoreLabel(goal.storeIn);
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
        btnSetor.addEventListener('click', () => openDepositGoalModal(goal.id));

        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'btn-rose btn-goal-trash';
        btnDel.title = 'Hapus Tabungan Impian';
        btnDel.setAttribute('aria-label', `Hapus tabungan impian ${goal.name}`);
        btnDel.innerHTML = SVG_TRASH_ICON;
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
        const normalizedTarget = normalizeStoreKey(selectedStore);
        const matchedOpt = Array.from(storeSel.options).find(o => o.value !== '__CUSTOM__' && normalizeStoreKey(o.value) === normalizedTarget);
        if (matchedOpt) {
            storeSel.value = matchedOpt.value;
            document.getElementById('customGoalStoreGroup').style.display = 'none';
        } else {
            storeSel.value = '__CUSTOM__';
            document.getElementById('customGoalStoreGroup').style.display = 'block';
            document.getElementById('modalGoalCustomStore').value = formatNormalizedStoreLabel(selectedStore);
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
    if (!id && goals.length >= MAX_GOALS_COUNT) {
        await showThemeAlert(`Batas maksimum ${MAX_GOALS_COUNT} tabungan impian telah tercapai.`, 'Batas Target Impian', 'warning');
        return;
    }

    const name = normalizePlainText(document.getElementById('modalGoalName').value, 50);
    const target = parseMoneyInput(document.getElementById('modalGoalTarget').value);
    const current = parseMoneyInput(document.getElementById('modalGoalCurrent').value);
    const monthly = parseMoneyInput(document.getElementById('modalGoalMonthly').value);
    const category = normalizePlainText(document.getElementById('modalGoalCategory').value, 40);

    const storeSelVal = document.getElementById('modalGoalStoreIn').value;
    const rawStore = (storeSelVal === '__CUSTOM__')
    ? (document.getElementById('modalGoalCustomStore').value || 'Dompet Khusus')
    : storeSelVal;
    const storeIn = formatNormalizedStoreLabel(rawStore);

    const sourceFromId = document.getElementById('modalGoalSourceFrom').value;
    const sourceFromName = getAccountNameById(sourceFromId);

    if (!name) {
        await showThemeAlert('Mohon isi nama tabungan impian.', 'Validasi Impian', 'warning');
        return;
    }

    const goalObj = sanitizeGoalObject({
        id: id ? Number(id) : generateUniqueNumericId(),
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
        const idx = goals.findIndex(g => g.id === Number(id));
        if (idx !== -1) goals[idx] = goalObj;
    } else {
        goals.push(goalObj);
    }

    await saveData();
    refreshAllViews();
    closeGoalModal();
}

async function deleteGoal(id) {
    const goal = goals.find(g => g.id === id);
    if (!goal) return;

    const goalTag = `GOAL_${id}`;
    const relatedLogs = dailyLogs.filter(l =>
    l.category === goalTag ||
    l.accountId === goalTag ||
    (Array.isArray(l.goalAllocations) && l.goalAllocations.some(a => Number(a.goalId) === Number(id)))
    );

    const agreed = await showVerificationConfirmModal({
        title: 'Verifikasi Hapus Tabungan Impian',
        message: relatedLogs.length > 0
        ? `Hapus target tabungan impian "${goal.name}"? Riwayat ${relatedLogs.length} mutasi sebelumnya akan tetap dipertahankan di jurnal transaksi dengan status (Target Terarsip).`
        : `Apakah Anda yakin ingin menghapus tabungan impian "${goal.name}"?`,
        confirmLabel: 'Ya, Hapus Target',
        cancelLabel: 'Batal'
    });
    if (!agreed) return;

    goals = goals.filter(g => g.id !== id);

    await saveData();
    refreshAllViews();
}

function openDepositGoalModal(id) {
    const goal = goals.find(g => g.id === id);
    if (!goal) return;

    const sourceAccId = goal.sourceFromId || userSettings.accounts[0].id;
    const sourceName = goal.sourceFromName || getAccountNameById(sourceAccId);
    const defaultMonthly = Number(goal.monthly) || 0;

    document.getElementById('depositGoalId').value = goal.id;
    document.getElementById('depositGoalTitleText').textContent = goal.name;
    document.getElementById('depositGoalRouteText').textContent = `Sumber: ${sourceName} → Simpan di: ${goal.storeIn || 'Kas'}`;

    const amtInput = document.getElementById('depositGoalAmount');
    amtInput.value = defaultMonthly > 0 ? defaultMonthly.toLocaleString('id-ID') : '';

    document.getElementById('depositGoalModal').classList.add('active');
    setTimeout(() => {
        amtInput.focus();
        amtInput.select();
    }, 40);
}

function closeDepositGoalModal() {
    document.getElementById('depositGoalModal').classList.remove('active');
}

async function submitDepositGoalModal(e) {
    if (e) e.preventDefault();
    if (dailyLogs.length >= MAX_LOGS_COUNT) {
        await showThemeAlert(`Batas maksimum ${MAX_LOGS_COUNT} catatan mutasi telah tercapai.`, 'Batas Riwayat Mutasi', 'warning');
        return;
    }

    const id = Number(document.getElementById('depositGoalId').value);
    const goal = goals.find(g => g.id === id);
    if (!goal) {
        closeDepositGoalModal();
        return;
    }

    const amount = parseMoneyInput(document.getElementById('depositGoalAmount').value);
    if (amount <= 0) {
        await showThemeAlert('Nominal setoran wajib lebih besar dari Rp0.', 'Validasi Setoran', 'warning');
        return;
    }

    const sourceAccId = goal.sourceFromId || userSettings.accounts[0].id;
    const sourceName = goal.sourceFromName || getAccountNameById(sourceAccId);

    const balances = calculateAccountBalances();
    const currentBal = balances[sourceAccId] || 0;
    if (amount > currentBal) {
        const ok = await showVerificationConfirmModal({
            title: 'Saldo Sumber Tidak Mencukupi',
            message: `Saldo "${sourceName}" hanya ${formatRupiah(currentBal, false)}. Tetap setor ${formatRupiah(amount, false)} ke tabungan impian?`,
                                                      confirmLabel: 'Ya, Tetap Setor'
        });
        if (!ok) return;
    }

    const btn = document.getElementById('btnSubmitDepositGoalModal');
    if (btn) btn.disabled = true;

    try {
        dailyLogs.unshift(sanitizeLogObject({
            id: generateUniqueNumericId(),
                                            date: getLocalDateString(),
                                            type: 'TABUNGAN_GOAL',
                                            accountId: sourceAccId,
                                            category: `GOAL_${goal.id}`,
                                            title: `Setoran Impian: ${goal.name}`,
                                            amount: amount,
                                            notes: `Disimpan di ${goal.storeIn || 'Kas'}`
        }));

        goal.current = sanitizeFiniteAmount((Number(goal.current) || 0) + amount);

        await saveData();
        refreshAllViews();
        closeDepositGoalModal();
    } finally {
        if (btn) btn.disabled = false;
    }
}

// =========================================================================
// 11. EXPORT PDF & EXCEL (FORMULA-INJECTION SAFE)
// =========================================================================
function exportPDF() {
    closeProfileModal();
    ensureDefaultAccount();

    const todayStr = new Date().toLocaleDateString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    document.getElementById('pdfPrintDate').textContent = todayStr;
    document.getElementById('pdfPrintFilter').textContent = document.getElementById('recapPeriodTitle').textContent || 'Semua Data';

    const balances = calculateAccountBalances();
    const isMulti = userSettings.savingsMode === 'MULTI';
    const activeAccounts = isMulti ? userSettings.accounts : [userSettings.accounts[0]];
    const balanceBody = document.getElementById('pdfPrintBalanceBody');
    balanceBody.textContent = '';

    let totalAllBalances = 0;

    activeAccounts.forEach((acc, idx) => {
        const bal = Number(balances[acc.id]) || 0;
        totalAllBalances += bal;

        const tr = document.createElement('tr');

        const tdNo = document.createElement('td');
        tdNo.className = 'text-center';
        tdNo.textContent = String(idx + 1);

        const tdName = document.createElement('td');
        tdName.className = 'font-bold';
        tdName.textContent = acc.name;

        const tdType = document.createElement('td');
        tdType.textContent = acc.type;

        const tdBal = document.createElement('td');
        tdBal.className = 'text-right font-bold';
        tdBal.textContent = formatRupiah(bal);

        tr.append(tdNo, tdName, tdType, tdBal);
        balanceBody.appendChild(tr);
    });

    document.getElementById('pdfPrintTotalBalance').textContent = formatRupiah(totalAllBalances);

    const selectedType = document.getElementById('dailyFilterType').value;
    let filtered = getFilteredLogs();
    if (selectedType !== 'ALL') {
        filtered = filtered.filter(l => l.type === selectedType);
    }

    let sumIncome = 0;
    let sumExpense = 0;
    let sumGoal = 0;

    filtered.forEach(log => {
        const amt = Number(log.amount) || 0;
        if (log.type === 'PEMASUKAN') sumIncome += amt;
        else if (log.type === 'PENGELUARAN') sumExpense += amt;
        else if (log.type === 'TABUNGAN_GOAL') sumGoal += amt;
    });

        document.getElementById('pdfPrintPeriodIncome').textContent = formatRupiah(sumIncome);
        document.getElementById('pdfPrintPeriodExpense').textContent = formatRupiah(sumExpense);
        document.getElementById('pdfPrintPeriodGoal').textContent = formatRupiah(sumGoal);

        setTimeout(() => window.print(), 120);
}

async function exportExcel() {
    if (typeof XLSX === 'undefined') {
        await showThemeAlert('Modul ekspor Excel belum siap. Pastikan koneksi internet aktif saat memuat halaman.', 'Modul Belum Siap', 'warning');
        return;
    }
    const filtered = getFilteredLogs();
    if (filtered.length === 0) {
        await showThemeAlert('Tidak ada data mutasi pada periode terpilih untuk diekspor.', 'Data Kosong', 'info');
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
            const gid = Number(String(l.category).replace('GOAL_', ''));
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

        const allocText = (Array.isArray(l.goalAllocations) && l.goalAllocations.length > 0)
        ? `Alokasi: ${l.goalAllocations.map(a => `${a.goalName} (${formatRupiah(a.amount, false)})`).join('; ')}`
        : '';
        const mergedNotes = [allocText, l.notes].filter(Boolean).join(' | ') || '-';

        wsData.push([
            { v: index + 1, t: 'n', s: { ...cellStyle, alignment: { horizontal: "center" } } },
            { v: sanitizeExcelCellText(l.date), t: 's', s: { ...cellStyle, alignment: { horizontal: "center" } } },
                    { v: sanitizeExcelCellText(l.type), t: 's', s: typeBadgeStyle },
                    { v: sanitizeExcelCellText(getAccountNameById(l.accountId, l)), t: 's', s: cellStyle },
                    { v: sanitizeExcelCellText(displayCat), t: 's', s: cellStyle },
                    { v: sanitizeExcelCellText(l.title), t: 's', s: cellStyle },
                    { v: l.amount, t: 'n', s: numStyle },
                    { v: sanitizeExcelCellText(mergedNotes), t: 's', s: cellStyle }
        ]);
    });

    const summaryLabelStyle = {
        font: { bold: true, sz: 10, color: { rgb: "0F172A" } },
        fill: { fgColor: { rgb: "E2E8F0" } },
        alignment: { horizontal: "right" }
    };

    wsData.push(
        [],
        ["", "", "", "", "", { v: "TOTAL PEMASUKAN", t: 's', s: summaryLabelStyle }, { v: totalIncome, t: 'n', s: { font: { bold: true, color: { rgb: "166534" } }, fill: { fgColor: { rgb: "DCFCE7" } }, numFmt: "#,##0" } }, ""],
        ["", "", "", "", "", { v: "TOTAL PENGELUARAN", t: 's', s: summaryLabelStyle }, { v: totalExpense, t: 'n', s: { font: { bold: true, color: { rgb: "991B1B" } }, fill: { fgColor: { rgb: "FEE2E2" } }, numFmt: "#,##0" } }, ""],
        ["", "", "", "", "", { v: "TOTAL ALOKASI TABUNGAN IMPIAN", t: 's', s: summaryLabelStyle }, { v: totalGoalAlloc, t: 'n', s: { font: { bold: true, color: { rgb: "6B21A8" } }, fill: { fgColor: { rgb: "F3E8FF" } }, numFmt: "#,##0" } }, ""]
    );

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } }
    ];
    ws['!cols'] = [
        { wch: 5 }, { wch: 13 }, { wch: 18 }, { wch: 20 },
        { wch: 24 }, { wch: 30 }, { wch: 18 }, { wch: 28 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Mutasi Keuangan");
    XLSX.writeFile(wb, `MoNa_Laporan_${getLocalDateString()}.xlsx`);
}

// =========================================================================
// 12. ANALYTICS CHARTS & OVERSPENDING NOTIFICATION ENGINE
// =========================================================================
function evaluateOverspendingAlert() {
    const alertBox = document.getElementById('spendingAlertBanner');
    if (!alertBox) return;

    const todayStr = getLocalDateString();
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
        btnCfg.addEventListener('click', () => openProfileModal('PREFS'));

        alertBox.append(textWrap, btnCfg);
    } else {
        alertBox.style.display = 'none';
    }
}

function renderDynamicAnalytics(categoryExpenses) {
    if (window.innerWidth < 768) return;

    const isDark = document.body.classList.contains('dark-mode');
    const isRetro = document.body.classList.contains('retro-mode');
    const labelColor = isDark ? '#cbd5e1' : (isRetro ? '#2c221e' : '#475569');
    const barColor = isDark ? '#3b82f6' : (isRetro ? '#b45309' : '#1e3a8a');

    const canvasCat = document.getElementById('categoryChart');
    if (canvasCat && canvasCat.getContext) {
        const ctx = canvasCat.getContext('2d');
        const w = canvasCat.width;
        const h = canvasCat.height;
        ctx.clearRect(0, 0, w, h);

        const categories = Object.keys(categoryExpenses);
        const values = Object.values(categoryExpenses);
        const maxVal = Math.max(...values, 100000);
        const count = Math.max(1, categories.length);

        const paddingX = 16;
        const usableWidth = w - paddingX * 2;
        const slotWidth = usableWidth / count;
        const barWidth = Math.max(14, Math.min(32, slotWidth * 0.62));

        categories.forEach((cat, idx) => {
            const val = values[idx];
            const barHeight = Math.min(105, (val / maxVal) * 105);
            const startX = paddingX + idx * slotWidth + (slotWidth - barWidth) / 2;

            ctx.fillStyle = barColor;
            ctx.fillRect(startX, 132 - barHeight, barWidth, barHeight);

            ctx.fillStyle = labelColor;
            ctx.font = '10px sans-serif';
            ctx.fillText(cat.substring(0, 6), startX, 150);
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
            const dateStr = getLocalDateString(d);
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
        ctx.strokeStyle = isRetro ? '#0f766e' : '#7c3aed';
        ctx.lineWidth = 2.5;
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();

        points.forEach((p, idx) => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = (dLimit > 0 && p.val > dLimit) ? '#dc2626' : (isRetro ? '#0f766e' : '#7c3aed');
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
    const uniqueMonths = new Set();

    filteredLogs.forEach(l => {
        uniqueDates.add(l.date);
        if (isValidIsoDate(l.date)) uniqueMonths.add(l.date.substring(0, 7));
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

    const activeDaysCount = Math.max(1, uniqueDates.size);
    const recapBody = document.getElementById('recapTableBody');
    recapBody.textContent = '';

    Object.keys(categoryExpenses).forEach(cat => {
        const spent = categoryExpenses[cat];
        const dailyAvg = spent / activeDaysCount;
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

    const timelineBody = document.getElementById('timelineTableBody');
    timelineBody.textContent = '';

    let accumSavings = totalRemainingBalance;
    const monthSpanCount = Math.max(1, uniqueMonths.size);
    const estMonthlyIncome = mode === 'WEEKLY'
    ? periodIncome * 4.33
    : (mode === 'MONTHLY' ? periodIncome : (periodIncome / monthSpanCount));
    const estMonthlyOutflow = mode === 'WEEKLY'
    ? periodExpense * 4.33
    : (mode === 'MONTHLY' ? periodExpense : (periodExpense / monthSpanCount));
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
// 14. EVENT LISTENERS BINDING & KEYBOARD MODAL ACCESSIBILITY
// =========================================================================
function bindStaticEventListeners() {
    document.getElementById('headerAvatarBox').addEventListener('click', () => openProfileModal('PROFILE'));
    document.getElementById('userAuthStatus').addEventListener('click', () => openProfileModal('PROFILE'));
    document.getElementById('btnBannerOpenLogin').addEventListener('click', () => openAuthModal('LOGIN'));
    document.getElementById('btnCloseGuestNotice').addEventListener('click', dismissGuestNotice);
    document.getElementById('btnProfileOpenLogin').addEventListener('click', () => openAuthModal('LOGIN'));
    document.getElementById('btnSecurityOpenLogin').addEventListener('click', () => openAuthModal('LOGIN'));
    document.getElementById('btnExportPDF').addEventListener('click', exportPDF);
    document.getElementById('btnExportExcel').addEventListener('click', exportExcel);

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (document.getElementById('systemAlertModal')?.classList.contains('active')) return;
        if (document.getElementById('confirmActionModal')?.classList.contains('active')) return;
        if (document.getElementById('depositGoalModal')?.classList.contains('active')) closeDepositGoalModal();
        else if (document.getElementById('editAccountModal')?.classList.contains('active')) closeEditAccountModal();
        else if (document.getElementById('editLogModal')?.classList.contains('active')) closeEditLogModal();
        else if (document.getElementById('goalModal')?.classList.contains('active')) closeGoalModal();
        else if (document.getElementById('authModal')?.classList.contains('active')) closeAuthModal();
        else if (document.getElementById('profileModal')?.classList.contains('active')) closeProfileModal();
    });

        document.getElementById('timeFilterMode').addEventListener('change', toggleFilterModeControls);
        document.getElementById('filterMonthVal').addEventListener('change', updateAllCalculations);
        document.getElementById('filterWeekVal').addEventListener('change', updateAllCalculations);
        document.getElementById('filterStartDate').addEventListener('change', updateAllCalculations);
        document.getElementById('filterEndDate').addEventListener('change', updateAllCalculations);

        document.querySelectorAll('#mainTabsHeader .tab-btn').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab, btn));
        });

        document.getElementById('dailyForm').addEventListener('submit', handleDailySubmit);
        document.getElementById('dailyType').addEventListener('change', updateTransactionFormOptions);
        document.getElementById('btnToggleUseGoalFunds').addEventListener('click', toggleExpenseGoalSource);
        document.getElementById('dailyFilterType').addEventListener('change', renderDailyLogs);

        document.getElementById('btnTabAddGoal').addEventListener('click', openAddGoalModal);

        document.getElementById('btnCloseProfileModal').addEventListener('click', closeProfileModal);
        document.querySelectorAll('[data-prof-sec]').forEach(tab => {
            tab.addEventListener('click', () => switchProfileSection(tab.dataset.profSec));
        });

        document.getElementById('btnCloseAuthModal').addEventListener('click', closeAuthModal);
        document.querySelectorAll('[data-auth-mode]').forEach(tab => {
            tab.addEventListener('click', () => switchAuthMode(tab.dataset.authMode));
        });

        document.querySelectorAll('.btn-toggle-eye').forEach(btn => {
            btn.innerHTML = SVG_EYE_OPEN;
            btn.addEventListener('click', () => togglePasswordVisibility(btn.dataset.eyeTarget, btn));
        });

        document.getElementById('avatarFileInput').addEventListener('change', handleSecureAvatarUpload);
        document.getElementById('btnRemoveAvatar').addEventListener('click', removeProfileAvatar);
        document.getElementById('formEditProfileIdentity').addEventListener('submit', handleUpdateProfileIdentity);

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

        document.getElementById('savingsModeSelect').addEventListener('change', handleSavingsModeChange);
        document.getElementById('btnAddSavingsAccount').addEventListener('click', handleAddSavingsAccount);
        document.getElementById('btnCloseEditAccountModal').addEventListener('click', closeEditAccountModal);
        document.getElementById('btnCancelEditAccountModal').addEventListener('click', closeEditAccountModal);
        document.getElementById('formEditAccountModal').addEventListener('submit', saveEditAccountModal);

        document.getElementById('btnThemeLight').addEventListener('click', () => setTheme('light'));
        document.getElementById('btnThemeDark').addEventListener('click', () => setTheme('dark'));
        document.getElementById('btnThemeRetro').addEventListener('click', () => setTheme('retro'));
        document.getElementById('btnSaveSpendingLimits').addEventListener('click', handleSaveSpendingLimits);
        document.getElementById('btnResetAppData').addEventListener('click', handleResetAppData);

        document.getElementById('modalGoalStoreIn').addEventListener('change', function() {
            document.getElementById('customGoalStoreGroup').style.display = (this.value === '__CUSTOM__') ? 'block' : 'none';
        });
        document.getElementById('btnCloseGoalModal').addEventListener('click', closeGoalModal);
        document.getElementById('btnCancelGoalModal').addEventListener('click', closeGoalModal);
        document.getElementById('btnSaveGoalModal').addEventListener('click', saveGoalModal);

        document.getElementById('btnCloseDepositGoalModal').addEventListener('click', closeDepositGoalModal);
        document.getElementById('btnCancelDepositGoalModal').addEventListener('click', closeDepositGoalModal);
        document.getElementById('formDepositGoalModal').addEventListener('submit', submitDepositGoalModal);

        document.getElementById('editLogType').addEventListener('change', () => updateEditTransactionFormOptions());
        document.getElementById('btnCloseEditLogModal').addEventListener('click', closeEditLogModal);
        document.getElementById('btnCancelEditLogModal').addEventListener('click', closeEditLogModal);
        document.getElementById('btnSaveEditLogModal').addEventListener('click', saveEditLogModal);
    
        const goalToggleBtn = document.getElementById('btnToggleUseGoalFunds');
        const goalToggleLbl = document.getElementById('lblToggleUseGoalFunds');
        if (goalToggleBtn) {
            goalToggleBtn.addEventListener('click', toggleExpenseGoalSource);
            goalToggleBtn.addEventListener('keydown', (e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    toggleExpenseGoalSource(e);
                }
            });
        }
        if (goalToggleLbl) {
            goalToggleLbl.addEventListener('click', (e) => {
                e.preventDefault();
                toggleExpenseGoalSource(e);
            });
        }
}

window.addEventListener('DOMContentLoaded', () => {
    bindStaticEventListeners();
    setupMoneyInputFormatting();
    initApp();
});

window.addEventListener('resize', () => {
    updateAllCalculations();
});
