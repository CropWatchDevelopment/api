(function () {
  var STORAGE_KEY = 'cw-swagger-theme';
  var DARK_CLASS = 'cw-swagger-dark';
  var BUTTON_ID = 'cw-swagger-theme-toggle';

  function getSavedTheme() {
    try {
      var saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') {
        return saved;
      }
    } catch (_e) {}
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  function persistTheme(theme) {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch (_e) {}
  }

  function setTheme(theme) {
    var isDark = theme === 'dark';
    document.documentElement.classList.toggle(DARK_CLASS, isDark);
    if (document.body) {
      document.body.classList.toggle(DARK_CLASS, isDark);
    }
    persistTheme(isDark ? 'dark' : 'light');

    var toggle = document.getElementById(BUTTON_ID);
    if (!toggle) {
      return;
    }

    toggle.classList.toggle('is-dark', isDark);
    toggle.setAttribute('aria-pressed', String(isDark));
    toggle.setAttribute(
      'title',
      isDark ? 'Switch to light mode' : 'Switch to dark mode'
    );
  }

  function mountToggleButton() {
    var topbar = document.querySelector('.swagger-ui .topbar');
    if (!topbar) {
      return false;
    }

    var toggle = document.getElementById(BUTTON_ID);
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.id = BUTTON_ID;
      toggle.type = 'button';
      toggle.className = 'dark-mode-toggle';
      toggle.setAttribute('aria-label', 'Toggle dark mode');
      toggle.textContent = '\ud83d\udca1';
      toggle.addEventListener('click', function () {
        var nowDark = document.documentElement.classList.contains(DARK_CLASS);
        setTheme(nowDark ? 'light' : 'dark');
      });
    }

    if (toggle.parentElement !== topbar) {
      topbar.appendChild(toggle);
    }

    setTheme(document.documentElement.classList.contains(DARK_CLASS) ? 'dark' : 'light');
    return true;
  }

  function bootstrap() {
    setTheme(getSavedTheme());

    if (mountToggleButton()) {
      return;
    }

    var attempts = 0;
    var interval = window.setInterval(function () {
      attempts += 1;
      if (mountToggleButton() || attempts > 100) {
        window.clearInterval(interval);
      }
    }, 150);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
