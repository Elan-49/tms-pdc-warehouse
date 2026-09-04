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

  async function getSupabaseClient() {
    if (!hasSupabaseConfig) {
      throw new Error('Pendaftaran akun membutuhkan konfigurasi Supabase.');
    }
    if (window.__tmsSupabaseClient) {
      supabaseClient = window.__tmsSupabaseClient;
      return supabaseClient;
    }
    if (!window.__tmsSupabaseClientPromise) {
      window.__tmsSupabaseClientPromise = loadSupabaseSdk().then(sb => {
        const existing = window.tmsSupabaseClient || window.__tmsSupabaseClient;
        const client = existing || sb.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        window.__tmsSupabaseClient = client;
        window.tmsSupabaseClient = client;
        return client;
      });
    }
    supabaseClient = await window.__tmsSupabaseClientPromise;
    window.tmsSupabaseClient = supabaseClient;
    return supabaseClient;
  }

  async function doLogin(user, pass) {
    if (hasSupabaseConfig) {
      const sb = await getSupabaseClient();
      const { data, error } = await sb.auth.signInWithPassword({ email: user, password: pass });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email atau password salah.' : error.message);
      const session = data?.session;
      if (!session?.user) throw new Error('Login berhasil tetapi sesi Supabase belum siap. Coba lagi.');
      localStorage.setItem(SESSION_KEY, JSON.stringify({ mode: 'supabase', user: session.user.email || user, at: Date.now() }));
      // Pastikan token sudah tersimpan dan dapat dipakai request berikutnya.
      const { data: verified } = await sb.auth.getSession();
      if (!verified?.session?.user) throw new Error('Sesi Supabase belum siap. Silakan coba lagi.');
      return;
    }
    if (pass !== LOCAL_ACCESS_CODE) throw new Error('Passcode salah. Hubungi admin jika lupa.');
    localStorage.setItem(SESSION_KEY, JSON.stringify({ mode: 'local', user: user || 'Pengguna', at: Date.now() }));
  }

  async function doSignup(name, email, pass) {
    const sb = await getSupabaseClient();
    if (pass.length < 6) throw new Error('Password minimal 6 karakter.');
    const { data, error } = await sb.auth.signUp({
      email,
      password: pass,
      options: { data: { full_name: name } }
    });
    if (error) throw new Error(error.message);

    // Jika email confirmation aktif, session bisa masih null. Dalam kondisi ini
    // tampilkan pesan agar pengguna memeriksa email sebelum login.
    if (data.session) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ mode: 'supabase', user: email, at: Date.now() }));
      return { signedIn: true, message: 'Akun berhasil dibuat. Anda sudah masuk.' };
    }
    return { signedIn: false, message: 'Akun berhasil dibuat. Cek email Anda untuk verifikasi sebelum masuk.' };
  }

  function isLoggedIn() {
    try { return !!JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return false; }
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    if (supabaseClient) supabaseClient.auth.signOut().catch(() => {});
    showLogin();
  }
  window.tmsAuth = { logout, isLoggedIn, getClient: () => supabaseClient };

  setModeLabel();
  const loginForm = $('#loginForm');
  const signupForm = $('#signupForm');
  const showLoginBtn = $('#showLoginBtn');
  const showSignupBtn = $('#showSignupBtn');

  function showAuthTab(mode) {
    const signup = mode === 'signup';
    loginForm.classList.toggle('hidden', signup);
    signupForm.classList.toggle('hidden', !signup);
    showLoginBtn.classList.toggle('active', !signup);
    showSignupBtn.classList.toggle('active', signup);
    $('#loginError').classList.add('hidden');
    $('#loginError').textContent = '';
  }

  showLoginBtn.addEventListener('click', () => showAuthTab('login'));
  showSignupBtn.addEventListener('click', () => showAuthTab('signup'));
  // Defensive initialization: always open on the Login tab.
  showAuthTab('login');

  async function restoreAuthSession() {
    if (!hasSupabaseConfig) {
      if (isLoggedIn()) {
        showApp();
        document.dispatchEvent(new CustomEvent('tms-auth-ready'));
      } else {
        showLogin();
      }
      return;
    }

    try {
      const sb = await getSupabaseClient();
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      if (data?.session?.user) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
          mode: 'supabase',
          user: data.session.user.email || '',
          at: Date.now()
        }));
        showApp();
        document.dispatchEvent(new CustomEvent('tms-auth-ready'));
      } else {
        localStorage.removeItem(SESSION_KEY);
        showLogin();
      }
    } catch (err) {
      console.error('Supabase session restore failed:', err);
      localStorage.removeItem(SESSION_KEY);
      showLogin();
    }
  }

  restoreAuthSession();

  loginForm.addEventListener('submit', async (e) => {
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
      document.dispatchEvent(new CustomEvent('tms-auth-ready'));
    } catch (err) {
      errEl.textContent = err.message || 'Login gagal. Coba lagi.';
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false; btn.textContent = original;
    }
  });

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    const errEl = $('#loginError');
    errEl.classList.add('hidden'); errEl.textContent = '';
    const name = $('#signupName').value.trim();
    const email = $('#signupEmail').value.trim();
    const pass = $('#signupPass').value;
    const confirm = $('#signupPassConfirm').value;
    if (pass !== confirm) {
      errEl.textContent = 'Konfirmasi password tidak sama.';
      errEl.classList.remove('hidden');
      return;
    }
    btn.disabled = true; const original = btn.textContent; btn.textContent = 'Membuat akun...';
    try {
      const result = await doSignup(name, email, pass);
      errEl.textContent = result.message;
      errEl.classList.remove('hidden');
      if (result.signedIn) {
        showApp();
        document.dispatchEvent(new CustomEvent('tms-auth-ready'));
      } else {
        signupForm.reset();
        showAuthTab('login');
      }
    } catch (err) {
      errEl.textContent = err.message || 'Pendaftaran akun gagal. Coba lagi.';
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
