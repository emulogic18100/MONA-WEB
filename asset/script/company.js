// =========================================================================
// MONA COMPANY PROFILE - EXTERNAL THEME CONTROLLER (STRICT CSP COMPLIANT)
// =========================================================================
(function () {
    const VALID_THEMES = ['light', 'dark', 'retro'];

    function readSavedTheme() {
        try {
            return localStorage.getItem('mona_theme') || 'light';
        } catch (e) {
            return 'light';
        }
    }

    function saveThemePreference(theme) {
        try {
            localStorage.setItem('mona_theme', theme);
        } catch (e) {
            // Tetap izinkan perubahan tema di memori meski storage diblokir browser
        }
    }

    function applyCompanyTheme(theme) {
        const chosen = VALID_THEMES.includes(theme) ? theme : 'light';
        document.body.classList.remove('dark-mode', 'retro-mode');
        if (chosen === 'dark') document.body.classList.add('dark-mode');
        if (chosen === 'retro') document.body.classList.add('retro-mode');

        saveThemePreference(chosen);

        document.querySelectorAll('[data-cp-theme]').forEach((btn) => {
            const isActive = btn.dataset.cpTheme === chosen;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-cp-theme]').forEach((btn) => {
            btn.addEventListener('click', () => applyCompanyTheme(btn.dataset.cpTheme));
        });
        applyCompanyTheme(readSavedTheme());
    });
})();
