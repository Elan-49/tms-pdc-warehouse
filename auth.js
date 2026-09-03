/* ==========================================================================
   TMS PDC WAREHOUSE — auth.js
   Gerbang login sebelum aplikasi utama tampil. Mendukung 2 mode (lihat
   auth-config.js): Passcode Lokal (default), atau Supabase (akun & password
   sungguhan) — otomatis dipilih tergantung apakah SUPABASE_URL/ANON_KEY diisi.
   ========================================================================== */
(function () {
  const SESSION_KEY = 'tms_pdc_session';
  const hasSupabaseConfig = typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL &&
                             typeof SUPABASE_ANON_KEY !== 'undefined' && SUPABASE_ANON_KEY;
  let supabaseClient = null;

  const $ = (s) => document.querySelector(s);

  function showApp() {
    $('#loginScreen').classList.add('hidden');
    $('#appShell').classList.remove('hidden');
  }
  function showLogin() {
    $('#loginScreen').classList.remove('hidden');
    $('#appShell').classList.add('hidden');
  }
  function setModeLabel() {
    const el = $('#loginMode');
    if (!el) return;
    el.textContent = hasSupabaseConfig
      ? 'Masuk menggunakan akun Supabase'
      : 'Masuk menggunakan passcode lokal — hubungi admin jika lupa';
  }

  function loadSupabaseSdk() {
    if (window.supabase) return Promise.resolve(window.supabase);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      s.onload = () => resolve(window.supabase);
      s.onerror = () => reject(new Error('Gagal memuat Supabase. Periksa koneksi internet Anda.'));
      document.head.appendChild(s);
    });
  }

  async function doLogin(user, pass) {
    if (hasSupabaseConfig) {
      const sb = await loadSupabaseSdk();
      if (!supabaseClient) supabaseClient = sb.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const { error } = await supabaseClient.auth.signInWithPassword({ email: user, password: pass });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email atau password salah.' : error.message);
      localStorage.setItem(SESSION_KEY, JSON.stringify({ mode: 'supabase', user, at: Date.now() }));
      return;
    }
    if (pass !== LOCAL_ACCESS_CODE) throw new Error('Passcode salah. Hubungi admin jika lupa.');
    localStorage.setItem(SESSION_KEY, JSON.stringify({ mode: 'local', user: user || 'Pengguna', at: Date.now() }));
  }

  function isLoggedIn() {
    try { return !!JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return false; }
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    if (supabaseClient) supabaseClient.auth.signOut().catch(() => {});
    showLogin();
  }
  window.tmsAuth = { logout, isLoggedIn };

  setModeLabel();
  if (isLoggedIn()) showApp(); else showLogin();

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    const errEl = $('#loginError');
    errEl.classList.add('hidden'); errEl.textContent = '';
    const user = $('#loginUser').value.trim();
    const pass = $('#loginPass').value;
    btn.disabled = true; const original = btn.textContent; btn.textContent = 'Memeriksa...';
    try {
      await doLogin(user, pass);
      showApp();
    } catch (err) {
      errEl.textContent = err.message || 'Login gagal. Coba lagi.';
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false; btn.textContent = original;
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'logoutBtn') {
      if (confirm('Keluar dari aplikasi?')) logout();
    }
  });
})();
