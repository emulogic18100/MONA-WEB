// =========================================================================
// UI ANIMATIONS, SVG ICONS & ACCESSIBLE CONFIRMATION MODAL ENGINE
// =========================================================================
const SVG_EYE_OPEN = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
const SVG_EYE_CLOSED = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
const SVG_TRASH_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';

let activeConfirmResolver = null;

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

function animatePanelEntrance(container) {
    if (!container) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    container.classList.remove('anim-fade-slide');
    void container.offsetWidth;
    container.classList.add('anim-fade-slide');
}

function showVerificationConfirmModal({ title, message, confirmLabel = 'Ya, Hapus', cancelLabel = 'Batal' }) {
    if (activeConfirmResolver) {
        activeConfirmResolver(false);
        activeConfirmResolver = null;
    }

    return new Promise((resolve) => {
        const overlay = document.getElementById('confirmActionModal');
        if (!overlay) {
            resolve(window.confirm(message));
            return;
        }

        const previouslyFocused = document.activeElement;
        const titleEl = document.getElementById('confirmModalTitle');
        const msgEl = document.getElementById('confirmModalMessage');
        const btnOk = document.getElementById('btnConfirmModalYes');
        const btnCancel = document.getElementById('btnConfirmModalNo');

        if (titleEl) titleEl.textContent = title || 'Konfirmasi Tindakan';
        if (msgEl) msgEl.textContent = message || 'Apakah Anda yakin?';
        if (btnOk) btnOk.textContent = confirmLabel;
        if (btnCancel) btnCancel.textContent = cancelLabel;

        overlay.classList.add('active');
        if (btnCancel) btnCancel.focus();

        const cleanup = (result) => {
            overlay.classList.remove('active');
            btnOk.removeEventListener('click', onYes);
            btnCancel.removeEventListener('click', onNo);
            document.removeEventListener('keydown', onKeyDown);
            activeConfirmResolver = null;
            if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                previouslyFocused.focus();
            }
            resolve(result);
        };

        activeConfirmResolver = cleanup;

        const onYes = () => cleanup(true);
        const onNo = () => cleanup(false);
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                cleanup(false);
            }
        };

        btnOk.addEventListener('click', onYes);
        btnCancel.addEventListener('click', onNo);
        document.addEventListener('keydown', onKeyDown);
    });
}
