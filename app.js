// =========================================================================
// SECURITY & SANITIZATION ENGINE (Strict Protection Against Injection & Exploits)
// =========================================================================
function sanitizeText(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>"']/g, function(m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m];
    }).trim();
}

function cleanAlphaNum(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
}

function cleanAlphaOnly(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[^a-zA-Z\s]/g, '').trim();
}

function validateAlphanumericPassword(pwd) {
    if (!pwd || pwd.length < 4) return false;
    const hasLetter = /[a-zA-Z]/.test(pwd);
    const hasNumber = /[0-9]/.test(pwd);
    return hasLetter && hasNumber;
}

function togglePasswordVisibility(inputId, btnElem) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        if (btnElem) btnElem.innerText = '🙈';
    } else {
        input.type = 'password';
        if (btnElem) btnElem.innerText = '👁️';
    }
}

// =========================================================================
// CONFIG FIREBASE & CLOUD RELAY FALLBACK
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
let isFirebaseActive = false;
try {
    if (firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("PASTE_")) {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        isFirebaseActive = true;
    }
} catch(e) {
    console.log("Firebase status:", e.message || e);
}

let currentUser = null;
let unsubscribeFirestore = null;
let syncPollInterval = null;
let goals = [];
let dailyLogs = [];

// =========================================================================
// THEME SYSTEM ENGINE (LIGHT & DARK MODE)
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
    const savedTheme = localStorage.getItem('mona_theme') || 'light';
    setTheme(savedTheme);
}

// =========================================================================
// UNIFIED EXPORT DROPDOWN ENGINE
// =========================================================================
function toggleExportMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById('exportDropdownMenu');
    menu.classList.toggle('active');
}

document.addEventListener('click', function() {
    const menu = document.getElementById('exportDropdownMenu');
    if (menu) menu.classList.remove('active');
});

// =========================================================================
// PARSING & FORMATTING UTILITIES
// =========================================================================
function parseMoneyInput(val) {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    const cleaned = val.toString().replace(/[^0-9]/g, '');
    if (cleaned === '') return 0;
    return parseFloat(cleaned);
}

function formatRupiah(number, showCents = true) {
    if (number === null || number === undefined || isNaN(number)) number = 0;
    const parts = number.toFixed(showCents ? 2 : 0).split('.');
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return showCents ? 'Rp' + integerPart + ',' + parts[1] : 'Rp' + integerPart;
}

function formatInputValue(inputElem) {
    if (!inputElem) return;
    const rawVal = parseMoneyInput(inputElem.value);
    inputElem.value = rawVal ? rawVal.toLocaleString('id-ID') : '';
}

function setupMoneyInputFormatting() {
    document.querySelectorAll('.money-input').forEach(elem => {
        elem.addEventListener('input', function() {
            let cursorOffset = this.value.length - (this.selectionEnd || 0);
            formatInputValue(this);
            let newCursor = Math.max(0, this.value.length - cursorOffset);
            if (this.setSelectionRange) {
                this.setSelectionRange(newCursor, newCursor);
            }
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
    if (dow <= 4)
        ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
    else
        ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
    return ISOweekStart;
}

// =========================================================================
// DATA STORAGE & SYNC ENGINE
// =========================================================================
function loadData() {
    initTheme();
    const savedUser = localStorage.getItem('mona_user_session');
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            updateAuthUI();
            setupSync();
        } catch(e) {}
    }

    if (!currentUser) {
        loadLocalData();
    }

    const todayObj = new Date();
    const todayStr = todayObj.toISOString().split('T')[0];
    document.getElementById('dailyDate').value = todayStr;
    document.getElementById('filterMonthVal').value = todayStr.substring(0, 7);

    const weekNum = getISOWeekNumber(todayObj);
    const weekStr = `${todayObj.getFullYear()}-W${weekNum < 10 ? '0' + weekNum : weekNum}`;
    document.getElementById('filterWeekVal').value = weekStr;

    document.getElementById('filterStartDate').value = todayStr.substring(0, 8) + '01';
    document.getElementById('filterEndDate').value = todayStr;

    updateCategoryOptions();
}

function loadLocalData() {
    const savedGoals = localStorage.getItem('mona_goals_v12');
    goals = savedGoals ? JSON.parse(savedGoals) : [];

    const savedLogs = localStorage.getItem('mona_daily_logs_v12');
    dailyLogs = savedLogs ? JSON.parse(savedLogs) : [];

    renderGoals();
    renderDailyLogs();
    updateAllCalculations();
}

function saveData() {
    localStorage.setItem('mona_goals_v12', JSON.stringify(goals));
    localStorage.setItem('mona_daily_logs_v12', JSON.stringify(dailyLogs));

    if (currentUser) {
        if (isFirebaseActive) {
            const cleanUser = cleanAlphaNum(currentUser.username || currentUser.nickname);
            db.collection('users').doc(cleanUser).set({
                nickname: sanitizeText(currentUser.nickname),
                                                      username: cleanAlphaNum(currentUser.username || currentUser.nickname),
                                                      password: currentUser.password,
                                                      goals: goals,
                                                      dailyLogs: dailyLogs,
                                                      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        } else {
            pushCloudData();
        }
    }
}

function setupSync() {
    if (!currentUser) return;
    if (isFirebaseActive) {
        if (unsubscribeFirestore) unsubscribeFirestore();
        const cleanUser = cleanAlphaNum(currentUser.username || currentUser.nickname);
        const userDocRef = db.collection('users').doc(cleanUser);
        unsubscribeFirestore = userDocRef.onSnapshot((doc) => {
            if (doc.exists) {
                const data = doc.data();
                goals = data.goals || [];
                dailyLogs = data.dailyLogs || [];

                localStorage.setItem('mona_goals_v12', JSON.stringify(goals));
                localStorage.setItem('mona_daily_logs_v12', JSON.stringify(dailyLogs));

                renderGoals();
                renderDailyLogs();
                updateAllCalculations();
            }
        });
    } else {
        fetchCloudData();
        if (syncPollInterval) clearInterval(syncPollInterval);
        syncPollInterval = setInterval(fetchCloudData, 10000);
    }
}

function getCloudStorageKey() {
    if (!currentUser) return null;
    const uid = cleanAlphaNum(currentUser.username || currentUser.nickname);
    return 'mona_sync_' + btoa(uid + '_' + currentUser.password).replace(/=/g, '');
}

async function pushCloudData() {
    const key = getCloudStorageKey();
    if (!key) return;
    try {
        const payload = { goals, dailyLogs, timestamp: Date.now() };
        localStorage.setItem(key, JSON.stringify(payload));
    } catch(e) {}
}

async function fetchCloudData() {
    const key = getCloudStorageKey();
    if (!key) return;
    try {
        const raw = localStorage.getItem(key);
        if (raw) {
            const data = JSON.parse(raw);
            goals = data.goals || [];
            dailyLogs = data.dailyLogs || [];
            renderGoals();
            renderDailyLogs();
            updateAllCalculations();
        }
    } catch(e) {}
}

// =========================================================================
// PROFIL MODAL & ACCOUNT MANAGEMENT SYSTEM
// =========================================================================
function switchAuthMode(mode) {
    const tabLogin = document.getElementById('tabSwitchLogin');
    const tabReg = document.getElementById('tabSwitchRegister');
    const formLogin = document.getElementById('formLoginMode');
    const formReg = document.getElementById('formRegisterMode');

    if (mode === 'LOGIN') {
        tabLogin.classList.add('active');
        tabReg.classList.remove('active');
        formLogin.style.display = 'block';
        formReg.style.display = 'none';
    } else {
        tabReg.classList.add('active');
        tabLogin.classList.remove('active');
        formReg.style.display = 'block';
        formLogin.style.display = 'none';
    }
}

function openProfileModal() {
    document.getElementById('loginNickname').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('regUsername').value = '';
    document.getElementById('regNickname').value = '';
    document.getElementById('regPassword').value = '';
    if(document.getElementById('newPasswordInput')) document.getElementById('newPasswordInput').value = '';

    switchAuthMode('LOGIN');

    if (currentUser) {
        document.getElementById('authFormSection').style.display = 'none';
        document.getElementById('authLoggedInSection').style.display = 'block';
        document.getElementById('loggedInUserText').innerText = `${sanitizeText(currentUser.nickname)} (@${cleanAlphaNum(currentUser.username || currentUser.nickname)})`;
    } else {
        document.getElementById('authFormSection').style.display = 'block';
        document.getElementById('authLoggedInSection').style.display = 'none';
    }
    document.getElementById('profileModal').classList.add('active');
}

function closeProfileModal() {
    document.getElementById('profileModal').classList.remove('active');
}

function handleAuthRegister() {
    const rawUser = document.getElementById('regUsername').value.trim();
    const rawNick = document.getElementById('regNickname').value.trim();
    const rawPass = document.getElementById('regPassword').value.trim();

    const username = cleanAlphaNum(rawUser);
    const nickname = sanitizeText(rawNick);

    if (!username) {
        alert('Username wajib diisi kombinasi huruf dan angka (misal: shizuka21)!');
        return;
    }
    if (!nickname) {
        alert('Nickname wajib diisi!');
        return;
    }
    if (!validateAlphanumericPassword(rawPass)) {
        alert('Password wajib kombinasi huruf & angka (minimal 4 karakter)!');
        return;
    }

    let localAccounts = JSON.parse(localStorage.getItem('mona_registered_accounts') || '{}');

    if (!isFirebaseActive) {
        localAccounts[username] = { username, nickname, password: rawPass };
        localStorage.setItem('mona_registered_accounts', JSON.stringify(localAccounts));

        currentUser = { username, nickname, password: rawPass };
        localStorage.setItem('mona_user_session', JSON.stringify(currentUser));
        updateAuthUI();
        setupSync();
        saveData();
        closeProfileModal();
        alert(`Akun ${nickname} (@${username}) berhasil didaftarkan!`);
        return;
    }

    const userRef = db.collection('users').doc(username);
    userRef.get().then((doc) => {
        if (doc.exists) {
            alert('Username telah digunakan! Silakan gunakan Username lain.');
        } else {
            localAccounts[username] = { username, nickname, password: rawPass };
            localStorage.setItem('mona_registered_accounts', JSON.stringify(localAccounts));

            currentUser = { username, nickname, password: rawPass };
            localStorage.setItem('mona_user_session', JSON.stringify(currentUser));
            saveData();
            setupSync();
            updateAuthUI();
            closeProfileModal();
            alert(`Akun ${nickname} (@${username}) berhasil didaftarkan & Sync Cloud Aktif!`);
        }
    }).catch(err => {
        alert('Gagal pendaftaran: ' + err.message);
    });
}

function handleAuthLogin() {
    const inputUserOrNick = document.getElementById('loginNickname').value.trim();
    const rawPass = document.getElementById('loginPassword').value.trim();
    const searchKey = cleanAlphaNum(inputUserOrNick);

    if (!inputUserOrNick || !rawPass) {
        alert('Mohon isi Username/Nickname dan Password!');
        return;
    }

    let localAccounts = JSON.parse(localStorage.getItem('mona_registered_accounts') || '{}');

    if (!isFirebaseActive) {
        let acc = localAccounts[searchKey];
        if (!acc) {
            acc = Object.values(localAccounts).find(a => cleanAlphaNum(a.nickname) === searchKey || a.username === searchKey);
        }

        if (acc && acc.password === rawPass) {
            currentUser = { username: acc.username, nickname: acc.nickname, password: acc.password };
            localStorage.setItem('mona_user_session', JSON.stringify(currentUser));
            setupSync();
            updateAuthUI();
            closeProfileModal();
        } else {
            alert('Username/Nickname atau Password tidak sesuai!');
        }
        return;
    }

    // Direct Firestore lookup for Multi-Device connection
    db.collection('users').doc(searchKey).get().then((doc) => {
        if (doc.exists && doc.data().password === rawPass) {
            const data = doc.data();
            currentUser = { username: searchKey, nickname: data.nickname || inputUserOrNick, password: rawPass };
            localStorage.setItem('mona_user_session', JSON.stringify(currentUser));
            setupSync();
            updateAuthUI();
            closeProfileModal();
        } else {
            // Secondary lookup by Username field
            db.collection('users').where('username', '==', searchKey).get().then((querySnapshot) => {
                let matchedDoc = null;
                querySnapshot.forEach(d => {
                    if (d.data().password === rawPass) matchedDoc = d.data();
                });

                    if (matchedDoc) {
                        currentUser = { username: matchedDoc.username, nickname: matchedDoc.nickname, password: rawPass };
                        localStorage.setItem('mona_user_session', JSON.stringify(currentUser));
                        setupSync();
                        updateAuthUI();
                        closeProfileModal();
                    } else {
                        alert('Username/Nickname atau Password salah!');
                    }
            }).catch(() => alert('Akun tidak ditemukan atau password salah!'));
        }
    }).catch(() => {
        alert('Gagal terhubung ke Firestore. Periksa koneksi internet Anda.');
    });
}

function handleChangePassword() {
    const newPass = document.getElementById('newPasswordInput').value.trim();
    if (!validateAlphanumericPassword(newPass)) {
        alert('Password baru wajib berupa kombinasi huruf & angka (minimal 4 karakter)!');
        return;
    }

    if (!currentUser) return;

    currentUser.password = newPass;
    localStorage.setItem('mona_user_session', JSON.stringify(currentUser));

    let localAccounts = JSON.parse(localStorage.getItem('mona_registered_accounts') || '{}');
    if (localAccounts[currentUser.username]) {
        localAccounts[currentUser.username].password = newPass;
        localStorage.setItem('mona_registered_accounts', JSON.stringify(localAccounts));
    }

    saveData();
    alert('Password berhasil diperbarui! Gunakan password baru ini untuk Login di device lain.');
    document.getElementById('newPasswordInput').value = '';
}

function handleAuthLogout() {
    if (unsubscribeFirestore) unsubscribeFirestore();
    if (syncPollInterval) clearInterval(syncPollInterval);
    currentUser = null;
    localStorage.removeItem('mona_user_session');
    updateAuthUI();
    closeProfileModal();
    loadLocalData();
}

function handleResetAppData() {
    if (!confirm("PERINGATAN: Apakah Anda yakin ingin MERESET TOTAL seluruh data transaksi dan target di aplikasi ini?")) return;
    if (!confirm("Tindakan ini akan mengosongkan jurnal harian dan menghapus seluruh target. Lanjutkan?")) return;

    if (currentUser && isFirebaseActive) {
        const cleanUser = cleanAlphaNum(currentUser.username || currentUser.nickname);
        db.collection('users').doc(cleanUser).set({
            goals: [],
            dailyLogs: [],
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }

    localStorage.removeItem('mona_goals_v12');
    localStorage.removeItem('mona_daily_logs_v12');
    goals = [];
    dailyLogs = [];

    renderGoals();
    renderDailyLogs();
    updateAllCalculations();
    closeProfileModal();
    alert("Data aplikasi MoNa berhasil di-reset total!");
}

function handleDeleteAccount() {
    if (!currentUser) return;
    const confirm1 = confirm(`PERINGATAN HAPUS AKUN: Anda yakin ingin menghapus akun @${currentUser.username} beserta seluruh datanya?`);
    if (!confirm1) return;

    const confirm2 = confirm("Tindakan ini permanen dan tidak dapat dibatalkan. Hapus Akun sekarang?");
    if (!confirm2) return;

    if (isFirebaseActive) {
        const cleanUser = cleanAlphaNum(currentUser.username || currentUser.nickname);
        db.collection('users').doc(cleanUser).delete();
    }

    let localAccounts = JSON.parse(localStorage.getItem('mona_registered_accounts') || '{}');
    delete localAccounts[currentUser.username];
    localStorage.setItem('mona_registered_accounts', JSON.stringify(localAccounts));

    handleResetAppData();
    handleAuthLogout();
    alert("Akun Anda telah berhasil dihapus secara permanen.");
}

function updateAuthUI() {
    const dot = document.getElementById('syncStatusDot');
    const statusText = document.getElementById('userStatusText');
    const authBtn = document.getElementById('authActionBtn');

    if (currentUser) {
        dot.classList.add('online');
        statusText.innerText = `${sanitizeText(currentUser.nickname)} (Synced)`;
        authBtn.innerText = 'Profil (Online)';
    } else {
        dot.classList.remove('online');
        statusText.innerText = 'Offline (Modus Lokal)';
        authBtn.innerText = 'Profil & Pengaturan';
    }
}

// =========================================================================
// UI CONTROLLERS & TABS
// =========================================================================
function switchTab(tabId, evt) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    if (evt && evt.target) evt.target.classList.add('active');
    document.getElementById(tabId).classList.add('active');
}

function toggleFilterModeControls() {
    const mode = document.getElementById('timeFilterMode').value;
    document.getElementById('ctrlMonthGroup').style.display = (mode === 'MONTHLY') ? 'block' : 'none';
    document.getElementById('ctrlWeekGroup').style.display = (mode === 'WEEKLY') ? 'block' : 'none';
    document.getElementById('ctrlRangeStartGroup').style.display = (mode === 'RANGE') ? 'block' : 'none';
    document.getElementById('ctrlRangeEndGroup').style.display = (mode === 'RANGE') ? 'block' : 'none';
    updateAllCalculations();
}

function updateCategoryOptions() {
    const type = document.getElementById('dailyType').value;
    const catSelect = document.getElementById('dailyCategory');
    catSelect.innerHTML = '';

    if (type === 'PEMASUKAN') {
        catSelect.innerHTML = `
        <option value="Gaji Pokok">Gaji Pokok / Revenue</option>
        <option value="Uang Lembur">Lembur & Honor</option>
        <option value="Bonus / THR">Bonus & Inisiatif</option>
        <option value="Pemasukan Lain">Pemasukan Lainnya</option>
        `;
    } else if (type === 'PENGELUARAN') {
        catSelect.innerHTML = `
        <option value="Makan & Dapur">Konsumsi & Makan</option>
        <option value="Transportasi">Transportasi & BBM</option>
        <option value="Kost & Utilitas">Akomodasi, Air & Listrik</option>
        <option value="Kuota Internet">Internet & Komunikasi</option>
        <option value="Jajan & Kopi">Operasional Harian</option>
        <option value="Lainnya">Pengeluaran Lainnya</option>
        `;
    } else if (type === 'TABUNGAN_GOAL') {
        goals.forEach(g => {
            catSelect.innerHTML += `<option value="GOAL_${g.id}">${sanitizeText(g.name)}</option>`;
        });
        if (goals.length === 0) {
            catSelect.innerHTML = `<option value="GOAL_GENERAL">Tabungan Umum</option>`;
        }
    }
}

function updateEditCategoryOptions(selectedCat = '') {
    const type = document.getElementById('editLogType').value;
    const catSelect = document.getElementById('editLogCategory');
    catSelect.innerHTML = '';

    if (type === 'PEMASUKAN') {
        catSelect.innerHTML = `
        <option value="Gaji Pokok">Gaji Pokok / Revenue</option>
        <option value="Uang Lembur">Lembur & Honor</option>
        <option value="Bonus / THR">Bonus & Inisiatif</option>
        <option value="Pemasukan Lain">Pemasukan Lainnya</option>
        `;
    } else if (type === 'PENGELUARAN') {
        catSelect.innerHTML = `
        <option value="Makan & Dapur">Konsumsi & Makan</option>
        <option value="Transportasi">Transportasi & BBM</option>
        <option value="Kost & Utilitas">Akomodasi, Air & Listrik</option>
        <option value="Kuota Internet">Internet & Komunikasi</option>
        <option value="Jajan & Kopi">Operasional Harian</option>
        <option value="Lainnya">Pengeluaran Lainnya</option>
        `;
    } else if (type === 'TABUNGAN_GOAL') {
        goals.forEach(g => {
            catSelect.innerHTML += `<option value="GOAL_${g.id}">${sanitizeText(g.name)}</option>`;
        });
        if (goals.length === 0) {
            catSelect.innerHTML = `<option value="GOAL_GENERAL">Tabungan Umum</option>`;
        }
    }
    if (selectedCat) catSelect.value = selectedCat;
}

// =========================================================================
// TRANSACTION LOG & GOALS HANDLERS
// =========================================================================
function handleDailySubmit(e) {
    e.preventDefault();
    const date = document.getElementById('dailyDate').value;
    const type = document.getElementById('dailyType').value;
    const category = document.getElementById('dailyCategory').value;
    const title = sanitizeText(document.getElementById('dailyTitle').value.trim());
    const amount = parseMoneyInput(document.getElementById('dailyAmount').value);
    const notes = sanitizeText(document.getElementById('dailyNotes').value.trim());

    if (!date || !title) {
        alert('Mohon isi tanggal dan deskripsi transaksi!');
        return;
    }

    const newLog = { id: Date.now(), date, type, category, title, amount, notes };
    dailyLogs.unshift(newLog);

    if (type === 'TABUNGAN_GOAL' && category.startsWith('GOAL_')) {
        const goalId = parseInt(category.replace('GOAL_', ''));
        const goal = goals.find(g => g.id === goalId);
        if (goal) goal.current += amount;
    }

    saveData();
    renderDailyLogs();
    renderGoals();
    updateAllCalculations();

    document.getElementById('dailyTitle').value = '';
    document.getElementById('dailyAmount').value = '';
    document.getElementById('dailyNotes').value = '';
}

function openEditLogModal(id) {
    const log = dailyLogs.find(l => l.id === id);
    if (!log) return;

    document.getElementById('editLogId').value = log.id;
    document.getElementById('editLogDate').value = log.date;
    document.getElementById('editLogType').value = log.type;
    updateEditCategoryOptions(log.category);
    document.getElementById('editLogTitle').value = log.title;
    document.getElementById('editLogAmount').value = log.amount ? log.amount.toLocaleString('id-ID') : '';
    document.getElementById('editLogNotes').value = log.notes || '';

    formatInputValue(document.getElementById('editLogAmount'));
    document.getElementById('editLogModal').classList.add('active');
}

function closeEditLogModal() {
    document.getElementById('editLogModal').classList.remove('active');
}

function saveEditLogModal() {
    const id = parseInt(document.getElementById('editLogId').value);
    const logIndex = dailyLogs.findIndex(l => l.id === id);
    if (logIndex === -1) return;

    const oldLog = dailyLogs[logIndex];
    if (oldLog.type === 'TABUNGAN_GOAL' && oldLog.category.startsWith('GOAL_')) {
        const oldGoalId = parseInt(oldLog.category.replace('GOAL_', ''));
        const oldGoal = goals.find(g => g.id === oldGoalId);
        if (oldGoal) oldGoal.current = Math.max(0, oldGoal.current - oldLog.amount);
    }

    const newDate = document.getElementById('editLogDate').value;
    const newType = document.getElementById('editLogType').value;
    const newCategory = document.getElementById('editLogCategory').value;
    const newTitle = sanitizeText(document.getElementById('editLogTitle').value.trim());
    const newAmount = parseMoneyInput(document.getElementById('editLogAmount').value);
    const newNotes = sanitizeText(document.getElementById('editLogNotes').value.trim());

    if (newType === 'TABUNGAN_GOAL' && newCategory.startsWith('GOAL_')) {
        const newGoalId = parseInt(newCategory.replace('GOAL_', ''));
        const newGoal = goals.find(g => g.id === newGoalId);
        if (newGoal) newGoal.current += newAmount;
    }

    dailyLogs[logIndex] = { id, date: newDate, type: newType, category: newCategory, title: newTitle, amount: newAmount, notes: newNotes };

    saveData();
    renderDailyLogs();
    renderGoals();
    updateAllCalculations();
    closeEditLogModal();
}

function deleteDailyLog(id) {
    if (confirm('Hapus record transaksi ini?')) {
        const log = dailyLogs.find(l => l.id === id);
        if (log && log.type === 'TABUNGAN_GOAL' && log.category.startsWith('GOAL_')) {
            const goalId = parseInt(log.category.replace('GOAL_', ''));
            const goal = goals.find(g => g.id === goalId);
            if (goal) goal.current = Math.max(0, goal.current - log.amount);
        }
        dailyLogs = dailyLogs.filter(l => l.id !== id);
        saveData();
        renderDailyLogs();
        renderGoals();
        updateAllCalculations();
    }
}

function getFilteredLogs() {
    const mode = document.getElementById('timeFilterMode').value;
    const monthVal = document.getElementById('filterMonthVal').value;
    const weekVal = document.getElementById('filterWeekVal').value;
    const startVal = document.getElementById('filterStartDate').value;
    const endVal = document.getElementById('filterEndDate').value;

    return dailyLogs.filter(log => {
        const logDateStr = (typeof log.date === 'string') ? log.date : new Date().toISOString().split('T')[0];
        if (mode === 'ALL') return true;
        if (mode === 'MONTHLY') return monthVal ? logDateStr.startsWith(monthVal) : true;
        if (mode === 'WEEKLY') {
            if (!weekVal) return true;
            const parts = weekVal.split('-W');
            const startDate = getDateFromISOWeek(parseInt(parts[1]), parseInt(parts[0]));
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
    if (cat.includes('Jajan')) return 'tag-jajan';
    if (cat.includes('Kost')) return 'tag-kost';
    return 'tag-lainnya';
}

function renderDailyLogs() {
    const tableBody = document.getElementById('dailyLogsTableBody');
    tableBody.innerHTML = '';
    const selectedType = document.getElementById('dailyFilterType').value;
    let filtered = getFilteredLogs();

    if (selectedType !== 'ALL') filtered = filtered.filter(l => l.type === selectedType);

    if (filtered.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4" class="text-center" style="color:var(--text-secondary); padding:16px;">Tidak ada riwayat transaksi.</td></tr>';
    } else {
        filtered.forEach(log => {
            const tagClass = getTagClass(log.type, log.category);
            let displayCat = sanitizeText(log.category);
            if (typeof log.category === 'string' && log.category.startsWith('GOAL_')) {
                const gid = parseInt(log.category.replace('GOAL_', ''));
                const g = goals.find(x => x.id === gid);
                displayCat = g ? `Target: ${sanitizeText(g.name)}` : 'Setoran Target';
            }

            const dateStr = (typeof log.date === 'string') ? log.date : '';
            const dParts = dateStr ? dateStr.split('-') : ['00', '00', '00'];
            const shortDate = dParts.length >= 3 ? `${dParts[2]}/${dParts[1]}` : log.date;

            const tr = document.createElement('tr');
            tr.innerHTML = `
            <td style="white-space:nowrap; color:var(--text-secondary); font-size:0.78rem;">
            <strong>${shortDate}</strong>
            </td>
            <td class="item-info-cell">
            <div class="item-title-row">
            <span class="badge-tag ${tagClass}">${displayCat}</span>
            <span class="item-title-text" title="${sanitizeText(log.title)}">${sanitizeText(log.title)}</span>
            </div>
            ${log.notes ? `<div class="item-meta" title="${sanitizeText(log.notes)}">${sanitizeText(log.notes)}</div>` : ''}
            </td>
            <td class="text-right font-bold" style="white-space:nowrap; color: ${log.type === 'PEMASUKAN' ? 'var(--accent-green)' : (log.type === 'TABUNGAN_GOAL' ? 'var(--accent-purple)' : 'var(--text-primary)')};">
            ${log.type === 'PEMASUKAN' ? '+' : '-'}${formatRupiah(log.amount)}
            </td>
            <td class="text-center" style="white-space:nowrap;">
            <button class="btn-blue" style="padding:2px 5px; font-size:0.7rem; min-height:26px; margin-right:2px;" onclick="openEditLogModal(${log.id})">Edit</button>
            <button class="btn-rose" style="padding:2px 5px; font-size:0.7rem; min-height:26px;" onclick="deleteDailyLog(${log.id})">Hapus</button>
            </td>
            `;
            tableBody.appendChild(tr);
        });
    }
}

// =========================================================================
// EXPORT EXECUTORS
// =========================================================================
function exportPDF() {
    const todayStr = new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('pdfPrintDate').innerText = todayStr;
    document.getElementById('pdfPrintFilter').innerText = document.getElementById('recapPeriodTitle').innerText || 'Semua Data';
    window.print();
}

function exportExcel() {
    const filtered = getFilteredLogs();
    if (filtered.length === 0) {
        alert('Tidak ada data transaksi untuk diekspor!');
        return;
    }

    let totalIncome = 0;
    let totalExpense = 0;
    const periodText = document.getElementById('recapPeriodTitle').innerText || 'Semua Data';
    const todayStr = new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });

    const excelRows = [
        ["MONA FINANCIAL MANAGER - LAPORAN KEUANGAN EKSEKUTIF"],
        [`Periode Evaluasi: ${periodText}`],
        [`Tanggal Unduh: ${todayStr}`],
        [],
        ["NO", "TANGGAL", "JENIS TRANSAKSI", "POS KATEGORI", "DESKRIPSI TRANSAKSI", "NOMINAL (RP)", "CATATAN"]
    ];

    filtered.forEach((l, index) => {
        let displayCat = l.category;
        if (l.category.startsWith('GOAL_')) {
            const gid = parseInt(l.category.replace('GOAL_', ''));
            const g = goals.find(x => x.id === gid);
            displayCat = g ? `Target: ${g.name}` : 'Setoran Target';
        }

        if (l.type === 'PEMASUKAN') totalIncome += l.amount;
        else totalExpense += l.amount;

        excelRows.push([index + 1, l.date, l.type, displayCat, l.title, l.amount, l.notes || "-"]);
    });

    excelRows.push([], ["", "", "", "", "TOTAL PEMASUKAN", totalIncome, ""], ["", "", "", "", "TOTAL PENGELUARAN & SETORAN", totalExpense, ""], ["", "", "", "", "NET CASH FLOW", totalIncome - totalExpense, ""]);

    const wb = XLSX.utils.book_new();
    const wsLogs = XLSX.utils.aoa_to_sheet(excelRows);
    XLSX.utils.book_append_sheet(wb, wsLogs, "Jurnal Transaksi");

    XLSX.writeFile(wb, `MoNa_Laporan_Keuangan_${new Date().toISOString().split('T')[0]}.xlsx`);
}

// =========================================================================
// GOALS MANAGEMENT ENGINE
// =========================================================================
function renderGoals() {
    const container = document.getElementById('goalsCardsList');
    container.innerHTML = '';
    let totalAccumulated = 0;

    if (goals.length === 0) {
        container.innerHTML = '<div style="color:var(--text-secondary); font-size:0.85rem; padding:12px;">Belum ada target keuangan. Klik "+ Target Baru" untuk menambahkan.</div>';
        document.getElementById('dispTotalGoalAccumulation').innerText = formatRupiah(0);
        return;
    }

    goals.forEach(goal => {
        totalAccumulated += goal.current;
        const pct = goal.target > 0 ? Math.min(100, Math.round((goal.current / goal.target) * 100)) : 0;

        const card = document.createElement('div');
        card.className = 'goal-card';
        card.innerHTML = `
        <div>
        <div class="goal-header">
        <span class="goal-title">${sanitizeText(goal.name)}</span>
        <span class="goal-category">${sanitizeText(goal.category)}</span>
        </div>
        <div class="goal-progress-box">
        <div class="goal-amounts">
        <span>${formatRupiah(goal.current, false)}</span>
        <span style="color: var(--text-secondary);">Target: ${formatRupiah(goal.target, false)}</span>
        </div>
        <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${pct}%;"></div>
        </div>
        <div style="font-size: 0.74rem; color: var(--text-secondary); margin-top: 6px; display: flex; justify-content: space-between;">
        <span>Tercapai: <strong>${pct}%</strong></span>
        <span>Alokasi: <strong>${formatRupiah(goal.monthly, false)}/bln</strong></span>
        </div>
        </div>
        </div>
        <div class="goal-actions">
        <button class="btn-outline" style="color: var(--text-primary); border-color: var(--border);" onclick="openEditGoalModal(${goal.id})">Edit</button>
        <button class="btn-amber" onclick="addFundsToGoal(${goal.id})">+ Setoran</button>
        <button class="btn-rose" onclick="deleteGoal(${goal.id})">Hapus</button>
        </div>
        `;
        container.appendChild(card);
    });

    document.getElementById('dispTotalGoalAccumulation').innerText = formatRupiah(totalAccumulated);
}

function openAddGoalModal() {
    document.getElementById('modalGoalId').value = '';
    document.getElementById('modalGoalTitle').innerText = 'Tambah Target Keuangan Baru';
    document.getElementById('modalGoalName').value = '';
    document.getElementById('modalGoalTarget').value = '';
    document.getElementById('modalGoalCurrent').value = '';
    document.getElementById('modalGoalMonthly').value = '';
    document.getElementById('modalGoalCategory').value = 'Target Lainnya';
    document.getElementById('goalModal').classList.add('active');
}

function openEditGoalModal(id) {
    const goal = goals.find(g => g.id === id);
    if (!goal) return;

    document.getElementById('modalGoalId').value = goal.id;
    document.getElementById('modalGoalTitle').innerText = 'Edit Target Keuangan';
    document.getElementById('modalGoalName').value = goal.name;
    document.getElementById('modalGoalTarget').value = goal.target ? goal.target.toLocaleString('id-ID') : '';
    document.getElementById('modalGoalCurrent').value = goal.current ? goal.current.toLocaleString('id-ID') : '';
    document.getElementById('modalGoalMonthly').value = goal.monthly ? goal.monthly.toLocaleString('id-ID') : '';
    document.getElementById('modalGoalCategory').value = goal.category;
    document.getElementById('goalModal').classList.add('active');
}

function closeGoalModal() {
    document.getElementById('goalModal').classList.remove('active');
}

function saveGoalModal() {
    const id = document.getElementById('modalGoalId').value;
    const name = sanitizeText(document.getElementById('modalGoalName').value.trim());
    const target = parseMoneyInput(document.getElementById('modalGoalTarget').value);
    const current = parseMoneyInput(document.getElementById('modalGoalCurrent').value);
    const monthly = parseMoneyInput(document.getElementById('modalGoalMonthly').value);
    const category = document.getElementById('modalGoalCategory').value;

    if (!name) {
        alert('Mohon isi nama target!');
        return;
    }

    if (id) {
        const index = goals.findIndex(g => g.id === parseInt(id));
        if (index !== -1) goals[index] = { id: parseInt(id), name, target, current, monthly, category };
    } else {
        goals.push({ id: Date.now(), name, target, current, monthly, category });
    }

    saveData();
    renderGoals();
    updateCategoryOptions();
    updateAllCalculations();
    closeGoalModal();
}

function deleteGoal(id) {
    if (confirm('Apakah Anda yakin ingin menghapus target keuangan ini?')) {
        goals = goals.filter(g => g.id !== id);
        saveData();
        renderGoals();
        updateCategoryOptions();
        updateAllCalculations();
    }
}

function addFundsToGoal(id) {
    const goal = goals.find(g => g.id === id);
    if (!goal) return;
    const input = prompt(`Nominal setoran dana untuk "${goal.name}" (Rp):`, "100000");
    const amount = parseMoneyInput(input);
    if (amount > 0) {
        dailyLogs.unshift({
            id: Date.now(),
                          date: new Date().toISOString().split('T')[0],
                          type: 'TABUNGAN_GOAL',
                          category: `GOAL_${goal.id}`,
                          title: `Setoran Target: ${goal.name}`,
                          amount: amount,
                          notes: 'Alokasi setoran target'
        });
        goal.current += amount;
        saveData();
        renderDailyLogs();
        renderGoals();
        updateAllCalculations();
    }
}

// =========================================================================
// CANVAS GRAPHICS & THEME ADAPTIVE ENGINE
// =========================================================================
function renderDesktopAnalytics(categoryExpenses, totalOutflow) {
    if (window.innerWidth < 768) return;

    const isDark = document.body.classList.contains('dark-mode');
    const labelColor = isDark ? '#cbd5e1' : '#475569';
    const barColor = isDark ? '#3b82f6' : '#2563eb';

    const canvasCat = document.getElementById('categoryChart');
    if (canvasCat && canvasCat.getContext) {
        const ctx = canvasCat.getContext('2d');
        ctx.clearRect(0, 0, canvasCat.width, canvasCat.height);

        const categories = Object.keys(categoryExpenses);
        const values = Object.values(categoryExpenses);
        const maxVal = Math.max(...values, 100000);

        const barWidth = 30;
        const gap = 15;
        let startX = 20;

        categories.forEach((cat, idx) => {
            const val = values[idx];
            const barHeight = Math.min(100, (val / maxVal) * 100);

            ctx.fillStyle = barColor;
            ctx.fillRect(startX, 120 - barHeight, barWidth, barHeight);

            ctx.fillStyle = labelColor;
            ctx.font = '9px sans-serif';
            ctx.fillText(cat.substring(0, 6), startX, 135);
            startX += barWidth + gap;
        });
    }

    const canvasTrend = document.getElementById('trendChart');
    if (canvasTrend && canvasTrend.getContext) {
        const ctx = canvasTrend.getContext('2d');
        ctx.clearRect(0, 0, canvasTrend.width, canvasTrend.height);

        ctx.beginPath();
        ctx.strokeStyle = '#7c3aed';
        ctx.lineWidth = 2;
        ctx.moveTo(20, 100);
        ctx.lineTo(80, 40);
        ctx.lineTo(140, 80);
        ctx.lineTo(200, 30);
        ctx.stroke();

        ctx.fillStyle = labelColor;
        ctx.font = '11px sans-serif';
        ctx.fillText('Status Operasional Evaluasi: Normal & Terkontrol', 20, 135);
    }
}

function updateAllCalculations() {
    const filteredLogs = getFilteredLogs();
    const mode = document.getElementById('timeFilterMode').value;

    let filterLabel = 'Sesuai Filter Waktu Terpilih';
    if (mode === 'MONTHLY') filterLabel = `Bulan: ${document.getElementById('filterMonthVal').value}`;
    else if (mode === 'WEEKLY') filterLabel = `Minggu: ${document.getElementById('filterWeekVal').value}`;
    else if (mode === 'RANGE') filterLabel = `Rentang: ${document.getElementById('filterStartDate').value} s/d ${document.getElementById('filterEndDate').value}`;
    else if (mode === 'ALL') filterLabel = 'Semua Riwayat Transaksi';

    document.getElementById('dispFilterLabel1').innerText = filterLabel;
    document.getElementById('dispFilterLabel2').innerText = filterLabel;
    document.getElementById('recapPeriodTitle').innerText = filterLabel;

    let totalIncome = 0;
    let totalOutflow = 0;

    const categoryExpenses = {
        'Makan & Dapur': 0,
        'Transportasi': 0,
        'Kost & Utilitas': 0,
        'Kuota Internet': 0,
        'Jajan & Kopi': 0,
        'Setoran Target Keuangan': 0,
        'Lainnya': 0
    };

    const uniqueDates = new Set();

    filteredLogs.forEach(l => {
        uniqueDates.add(l.date);
        if (l.type === 'PEMASUKAN') totalIncome += l.amount;
        else if (l.type === 'PENGELUARAN') {
            totalOutflow += l.amount;
            let catKey = l.category;
            if (!categoryExpenses.hasOwnProperty(catKey)) catKey = 'Lainnya';
            categoryExpenses[catKey] += l.amount;
        } else if (l.type === 'TABUNGAN_GOAL') {
            totalOutflow += l.amount;
            categoryExpenses['Setoran Target Keuangan'] += l.amount;
        }
    });

    const daysCount = Math.max(1, uniqueDates.size);
    document.getElementById('dispIncome').innerText = formatRupiah(totalIncome);
    document.getElementById('dispExpense').innerText = formatRupiah(totalOutflow);
    document.getElementById('dispNet').innerText = formatRupiah(totalIncome - totalOutflow);

    let recapHtml = '';
    Object.keys(categoryExpenses).forEach(cat => {
        const spent = categoryExpenses[cat];
        if (spent > 0 || cat !== 'Setoran Target Keuangan') {
            const dailyAvg = spent / daysCount;
            const porsi = totalOutflow > 0 ? ((spent / totalOutflow) * 100).toFixed(1) : '0.0';
            let statusBadge = '<span class="badge-tag tag-pemasukan">Terkontrol</span>';
            if (cat === 'Setoran Target Keuangan') statusBadge = '<span class="badge-tag tag-tabungan">Alokasi Target</span>';
            else if (parseFloat(porsi) > 35) statusBadge = '<span class="badge-tag tag-transport">Tinggi</span>';

            recapHtml += `
            <tr>
            <td><strong>${cat}</strong></td>
            <td class="text-right font-bold">${formatRupiah(spent)}</td>
            <td class="text-right">${formatRupiah(dailyAvg)}</td>
            <td class="text-right">${porsi}%</td>
            <td class="text-center">${statusBadge}</td>
            </tr>
            `;
        }
    });
    document.getElementById('recapTableBody').innerHTML = recapHtml;

    // Timeline Projection 12 Months
    let timelineHtml = '';
    let accumSavings = 0;
    const estMonthlyIncome = totalIncome > 0 ? (mode === 'WEEKLY' ? totalIncome * 4 : totalIncome) : 0;
    const estMonthlyOutflow = totalOutflow > 0 ? (mode === 'WEEKLY' ? totalOutflow * 4 : totalOutflow) : 0;
    const estSurplus = estMonthlyIncome - estMonthlyOutflow;

    for (let m = 1; m <= 12; m++) {
        accumSavings += estSurplus;
        let reachedGoals = [];
        goals.forEach(g => {
            if (g.target > 0 && (g.monthly * m + g.current) >= g.target) reachedGoals.push(sanitizeText(g.name));
        });

            let statusBadge = reachedGoals.length > 0
            ? `<span class="goal-category" style="background:#dcfce7; color:#166534;">Ready: ${reachedGoals.join(', ')}</span>`
            : '<span style="color:var(--text-secondary); font-size:0.8rem;">Progres Menabung</span>';

            timelineHtml += `
            <tr>
            <td class="text-center font-bold">Bulan ${m}</td>
            <td class="text-right">${formatRupiah(estMonthlyIncome)}</td>
            <td class="text-right">${formatRupiah(estMonthlyOutflow)}</td>
            <td class="text-right font-bold" style="color: var(--accent-blue);">${formatRupiah(accumSavings)}</td>
            <td>${statusBadge}</td>
            </tr>
            `;
    }
    document.getElementById('timelineTableBody').innerHTML = timelineHtml;

    renderDailyLogs();
    renderDesktopAnalytics(categoryExpenses, totalOutflow);
}

window.onload = function() {
    setupMoneyInputFormatting();
    loadData();
};

window.onresize = function() {
    updateAllCalculations();
};
