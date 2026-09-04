/* ==========================================================================
   TMS PDC WAREHOUSE — auth.js
   Gerbang login sebelum aplikasi utama tampil. Menggunakan Supabase Auth untuk produksi. Mode passcode lokal hanya boleh
   digunakan pada localhost untuk development dan otomatis diblokir pada host publik.
   ========================================================================== */
(function () {
  const SESSION_KEY = 'tms_pdc_session';
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
  function showLogin() {
    $('#loginScreen').classList.remove('hidden');
    $('#appShell').classList.add('hidden');
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

  async function getProfile(sb, userId) {
    const { data, error } = await sb.from('user_profiles').select('id,email,full_name,role,status,created_at,updated_at,approved_at').eq('id', userId).maybeSingle();
    if (error) throw error;
    return data || null;
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

  function isLoggedIn() {
    try { return !!JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return false; }
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    // Cloud data is not deleted. Only local browser cache is cleared so the
    // next user on a shared workstation cannot read the previous session's data.
    ['tms-pdc-v2-data','tms-pdc-v2-settings','tms-pdc-v2-master'].forEach(k => localStorage.removeItem(k));
    currentProfile = null;
    if (supabaseClient) supabaseClient.auth.signOut().catch(() => {});
    showLogin();
  }
  window.tmsAuth = {
    logout,
    isLoggedIn,
    getClient: () => supabaseClient,
    getProfile: () => currentProfile,
    getRole: () => currentProfile?.role || (localModeAllowed ? 'admin' : null),
    isApproved: () => currentProfile?.status === 'approved'
  };

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
      if (!localModeAllowed) {
        localStorage.removeItem(SESSION_KEY);
        showLogin();
        return;
      }
      if (isLoggedIn()) {
        currentProfile = { id: null, email: '', role: 'admin', status: 'approved' };
        showApp();
        document.dispatchEvent(new CustomEvent('tms-auth-ready'));
      } else showLogin();
      return;
    }
    try {
      const sb = await getSupabaseClient();
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      if (data?.session?.user) {
        const profile = await requireApprovedProfile(sb, data.session.user.id);
        localStorage.setItem(SESSION_KEY, JSON.stringify({ mode: 'supabase', user: data.session.user.email || '', userId: data.session.user.id, role: profile.role, at: Date.now() }));
        showApp();
        document.dispatchEvent(new CustomEvent('tms-auth-ready'));
      } else {
        currentProfile = null;
        localStorage.removeItem(SESSION_KEY);
        showLogin();
      }
    } catch (err) {
      console.error('Supabase session restore failed:', err);
      currentProfile = null;
      localStorage.removeItem(SESSION_KEY);
      try { const sb = await getSupabaseClient(); await sb.auth.signOut(); } catch (_) {}
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
