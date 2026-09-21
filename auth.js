/* ==========================================================================
   TMWA PDC WAREHOUSE — auth.js
   Gerbang login sebelum aplikasi utama tampil. Menggunakan Supabase Auth untuk produksi. Mode passcode lokal hanya boleh
   digunakan pada localhost untuk development dan otomatis diblokir pada host publik.
   ========================================================================== */
(function () {
  const SESSION_KEY = 'tmwa_pdc_session';
  const hasSupabaseConfig = typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL &&
                             typeof SUPABASE_ANON_KEY !== 'undefined' && SUPABASE_ANON_KEY;
  const localHost = ['localhost','127.0.0.1'].includes(location.hostname);
  const localModeAllowed = !hasSupabaseConfig && !!ALLOW_LOCAL_MODE && localHost;
  let currentProfile = null;
  let supabaseClient = null;

  const $ = (s) => document.querySelector(s);

  function showApp() {
    $('#loginScreen').classList.add('hidden');
    $('#appShell').classList.remove('hidden');
  }
  // The app shell may be prepared before the first cloud render, but the
  // boot loader remains visible until app.js finishes the authoritative
  // initial render. This prevents a blank white frame between loader and app.
  document.addEventListener('tmwa-app-ready', () => {
    document.body.classList.remove('auth-booting');
  });
  function showLogin() {
    $('#loginScreen').classList.remove('hidden');
    const shell = $('#appShell');
    shell.classList.add('hidden');
    // Reset navigation state, otherwise a menu left open before logout stays
    // open behind the login screen and reappears on the next sign-in.
    shell.classList.remove('sidebar-open');
    const toggle = $('#sidebarToggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    const pm = $('#profileMenu');
    if (pm) pm.classList.add('hidden');
  }
  function setModeLabel() {
    const el = $('#loginMode');
    if (!el) return;
    el.textContent = hasSupabaseConfig
      ? 'Masuk menggunakan akun Supabase'
      : (localModeAllowed ? 'Mode development lokal' : 'Konfigurasi Supabase belum siap — akses produksi dikunci');
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
    if (window.__tmwaSupabaseClient) {
      supabaseClient = window.__tmwaSupabaseClient;
      return supabaseClient;
    }
    if (!window.__tmwaSupabaseClientPromise) {
      window.__tmwaSupabaseClientPromise = loadSupabaseSdk().then(sb => {
        const existing = window.tmwaSupabaseClient || window.__tmwaSupabaseClient;
        const client = existing || sb.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        window.__tmwaSupabaseClient = client;
        window.tmwaSupabaseClient = client;
        return client;
      });
    }
    supabaseClient = await window.__tmwaSupabaseClientPromise;
    window.tmwaSupabaseClient = supabaseClient;
    return supabaseClient;
  }

  async function getProfile(sb, userId) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await sb.from('user_profiles').select('id,email,full_name,role,status,created_at,updated_at,approved_at').eq('id', userId).maybeSingle();
      if (!error) return data || null;
      lastError = error;
      await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
    }
    throw lastError || new Error('Profil pengguna belum dapat dibaca.');
  }

  async function requireApprovedProfile(sb, userId) {
    const profile = await getProfile(sb, userId);
    currentProfile = profile;
    if (!profile) { await sb.auth.signOut().catch(()=>{}); throw new Error('Profil akses belum tersedia. Hubungi admin.'); }
    if (profile.status === 'pending') { await sb.auth.signOut().catch(()=>{}); throw new Error('Akun sudah terdaftar tetapi masih menunggu persetujuan admin.'); }
    if (profile.status === 'suspended') { await sb.auth.signOut().catch(()=>{}); throw new Error('Akun Anda sedang dinonaktifkan. Hubungi admin.'); }
    if (profile.status !== 'approved') { await sb.auth.signOut().catch(()=>{}); throw new Error('Akses akun belum aktif. Hubungi admin.'); }
    return profile;
  }

  async function doLogin(user, pass) {
    if (hasSupabaseConfig) {
      const sb = await getSupabaseClient();
      const { data, error } = await sb.auth.signInWithPassword({ email: user, password: pass });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email atau password salah.' : error.message);
      const session = data?.session;
      if (!session?.user) throw new Error('Login berhasil tetapi sesi Supabase belum siap. Coba lagi.');
      await sb.auth.getSession();
      const profile = await requireApprovedProfile(sb, session.user.id);
      localStorage.setItem(SESSION_KEY, JSON.stringify({ mode: 'supabase', user: session.user.email || user, userId: session.user.id, role: profile.role, at: Date.now() }));
      return profile;
    }
    if (!localModeAllowed) throw new Error('Akses produksi dikunci. Hubungi administrator untuk menyiapkan Supabase Auth.');
    if (pass !== LOCAL_ACCESS_CODE) throw new Error('Passcode salah.');
    currentProfile = { id: null, email: user || '', full_name: user || 'Pengguna Lokal', role: 'admin', status: 'approved' };
    localStorage.setItem(SESSION_KEY, JSON.stringify({ mode: 'local', user: user || 'Pengguna', role: 'admin', at: Date.now() }));
    return currentProfile;
  }

  async function doSignup(name, email, pass) {
    if (!hasSupabaseConfig) throw new Error('Pendaftaran akun membutuhkan konfigurasi Supabase.');
    const sb = await getSupabaseClient();
    if (pass.length < 10) throw new Error('Password minimal 10 karakter untuk akun perusahaan.');
    const { data, error } = await sb.auth.signUp({
      email,
      password: pass,
      options: { data: { full_name: name } }
    });
    if (error) throw new Error(error.message);
    // New accounts are always pending. Even if Supabase returns a session,
    // the user must wait for an administrator to approve the profile.
    if (data?.session) await sb.auth.signOut();
    return { signedIn: false, message: 'Pendaftaran berhasil. Akun menunggu persetujuan admin. Anda akan dapat masuk setelah status akun disetujui.' };
  }

  async function doForgotPassword(email) {
    if (!hasSupabaseConfig) throw new Error('Reset password membutuhkan konfigurasi Supabase.');
    const sb = await getSupabaseClient();
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw new Error(error.message);
  }

  async function doResetPassword(pass) {
    if (!hasSupabaseConfig) throw new Error('Reset password membutuhkan konfigurasi Supabase.');
    const sb = await getSupabaseClient();
    const { error } = await sb.auth.updateUser({ password: pass });
    if (error) throw new Error(error.message);
  }

  function isLoggedIn() {
    try { return !!JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return false; }
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    // Cloud data is not deleted. Only local browser cache is cleared so the
    // next user on a shared workstation cannot read the previous session's data.
    ['tmwa-pdc-v2-data','tmwa-pdc-v2-settings','tmwa-pdc-v2-master'].forEach(k => localStorage.removeItem(k));
    currentProfile = null;
    if (supabaseClient) supabaseClient.auth.signOut().catch(() => {});
    showLogin();
  }
  window.tmwaAuth = {
    logout,
    isLoggedIn,
    getClient: () => supabaseClient,
    getProfile: () => currentProfile,
    getRole: () => { const r=currentProfile?.role; return r ? String(r).trim().toLowerCase() : (localModeAllowed ? 'admin' : null); },
    isApproved: () => currentProfile?.status === 'approved'
  };

  setModeLabel();
  const loginForm = $('#loginForm');
  const signupForm = $('#signupForm');
  const forgotForm = $('#forgotForm');
  const resetForm = $('#resetForm');
  const showLoginBtn = $('#showLoginBtn');
  const showSignupBtn = $('#showSignupBtn');
  const showForgotBtn = $('#showForgotBtn');
  const backToLoginBtn = $('#backToLoginBtn');
  const authSwitch = document.querySelector('.login-switch');

  function showAuthTab(mode) {
    const forms = { login: loginForm, signup: signupForm, forgot: forgotForm, reset: resetForm };
    Object.entries(forms).forEach(([key, form]) => { if (form) form.classList.toggle('hidden', key !== mode); });
    if (showLoginBtn) showLoginBtn.classList.toggle('active', mode === 'login');
    if (showSignupBtn) showSignupBtn.classList.toggle('active', mode === 'signup');
    // The Masuk/Buat Akun tab strip only makes sense for those two modes.
    if (authSwitch) authSwitch.classList.toggle('hidden', mode === 'forgot' || mode === 'reset');
    const authTitle = $('#authTitle');
    const authSubtitle = $('#authSubtitle');
    const titles = {
      login: ['Selamat Datang', 'Masukkan username dan password'],
      signup: ['Buat Akun Baru', 'Lengkapi data berikut'],
      forgot: ['Lupa Password', 'Masukkan email akun Anda untuk menerima link reset'],
      reset: ['Buat Password Baru', 'Sesi reset terverifikasi — silakan buat password baru'],
    };
    if (authTitle) authTitle.textContent = titles[mode][0];
    if (authSubtitle) authSubtitle.textContent = titles[mode][1];
    $('#loginError').classList.add('hidden');
    $('#loginError').textContent = '';
  }

  showLoginBtn.addEventListener('click', () => showAuthTab('login'));
  showSignupBtn.addEventListener('click', () => showAuthTab('signup'));
  if (showForgotBtn) showForgotBtn.addEventListener('click', () => showAuthTab('forgot'));
  if (backToLoginBtn) backToLoginBtn.addEventListener('click', () => showAuthTab('login'));
  // Defensive initialization: always open on the Login tab.
  showAuthTab('login');

  // A password-recovery link lands back here with a Supabase auth event
  // rather than a normal page state. When it fires, skip straight to the
  // "set a new password" form instead of showing the login screen.
  if (hasSupabaseConfig) {
    getSupabaseClient().then(sb => {
      sb.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') {
          document.body.classList.remove('auth-booting');
          showLogin();
          showAuthTab('reset');
        }
      });
    }).catch(() => {});
  }

  async function restoreAuthSession() {
    if (!hasSupabaseConfig) {
      if (!localModeAllowed) {
        localStorage.removeItem(SESSION_KEY);
        showLogin();
        return;
      }
      if (isLoggedIn()) {
        currentProfile = { id: null, email: '', role: 'admin', status: 'approved' };
        showApp();
        document.dispatchEvent(new CustomEvent('tmwa-auth-ready'));
      } else showLogin();
      return;
    }
    try {
      const sb = await getSupabaseClient();
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      if (data?.session?.user) {
        const profile = await requireApprovedProfile(sb, data.session.user.id);
        localStorage.setItem(SESSION_KEY, JSON.stringify({ mode: 'supabase', user: data.session.user.email || '', userId: data.session.user.id, role: profile.role, status: profile.status, at: Date.now() }));
        showApp();
        document.dispatchEvent(new CustomEvent('tmwa-auth-ready'));
      } else {
        currentProfile = null;
        localStorage.removeItem(SESSION_KEY);
        showLogin();
      }
    } catch (err) {
      console.error('Supabase session restore failed:', err);
      // IMPORTANT: do not sign the user out on a transient profile/network error.
      // A page refresh must not destroy a valid Supabase session just because
      // user_profiles was temporarily unavailable. Only explicit access states
      // (pending/suspended/no profile) are signed out by requireApprovedProfile.
      try {
        const sb = await getSupabaseClient();
        const { data: retry } = await sb.auth.getSession();
        if (retry?.session?.user) {
          // Keep the Supabase session alive and let the middleware retry its guard.
          currentProfile = null;
          showLogin();
          return;
        }
      } catch (_) {}
      currentProfile = null;
      localStorage.removeItem(SESSION_KEY);
      showLogin();
    }
  }

  const isRecoveryLink = /type=recovery/.test(window.location.hash);

  restoreAuthSession();
  // A recovery link carries its own short-lived session. Do not let the
  // normal restore flow above race it into the main app — force the
  // reset-password tab the moment we can see it in the URL.
  if (isRecoveryLink) {
    showLogin();
    showAuthTab('reset');
    document.body.classList.remove('auth-booting');
  }

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
      document.body.classList.add('auth-booting');
      showApp();
      document.dispatchEvent(new CustomEvent('tmwa-auth-ready'));
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
        document.dispatchEvent(new CustomEvent('tmwa-auth-ready'));
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
      (window.tmwaDialog?.confirm('Sesi Anda akan diakhiri dan kembali ke halaman login.',{title:'Keluar dari aplikasi?',confirmText:'Keluar',danger:true})||Promise.resolve(false)).then(ok=>{if(ok)logout();});
    }
  });

  if (forgotForm) forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    const errEl = $('#loginError');
    errEl.classList.add('hidden'); errEl.textContent = '';
    const email = $('#forgotEmail').value.trim();
    btn.disabled = true; const original = btn.textContent; btn.textContent = 'Mengirim...';
    try {
      await doForgotPassword(email);
      errEl.textContent = 'Link reset password telah dikirim ke ' + email + '. Periksa inbox (dan folder spam) lalu klik link tersebut.';
      errEl.classList.remove('hidden');
      forgotForm.reset();
    } catch (err) {
      errEl.textContent = err.message || 'Gagal mengirim link reset. Coba lagi.';
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false; btn.textContent = original;
    }
  });

  if (resetForm) resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    const errEl = $('#loginError');
    errEl.classList.add('hidden'); errEl.textContent = '';
    const pass = $('#resetPass').value;
    const confirmPass = $('#resetPassConfirm').value;
    if (pass.length < 6) { errEl.textContent = 'Password minimal 6 karakter.'; errEl.classList.remove('hidden'); return; }
    if (pass !== confirmPass) { errEl.textContent = 'Konfirmasi password tidak sama.'; errEl.classList.remove('hidden'); return; }
    btn.disabled = true; const original = btn.textContent; btn.textContent = 'Menyimpan...';
    try {
      await doResetPassword(pass);
      // Sign out of the short-lived recovery session and ask the user to log
      // in fresh with the new password — simpler and safer than trying to
      // carry the recovery session straight into the approval-gated app.
      if (supabaseClient) await supabaseClient.auth.signOut().catch(() => {});
      currentProfile = null;
      resetForm.reset();
      history.replaceState(null, '', window.location.pathname + window.location.search);
      showAuthTab('login');
      errEl.textContent = 'Password berhasil diubah. Silakan masuk dengan password baru Anda.';
      errEl.classList.remove('hidden');
    } catch (err) {
      errEl.textContent = err.message || 'Gagal menyimpan password baru. Coba lagi.';
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false; btn.textContent = original;
    }
  });
})();
