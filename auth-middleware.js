/* TMS PDC Warehouse — Auth Middleware
   Guard untuk memastikan session autentikasi siap sebelum operasi cloud.
   Ini bukan pengganti RLS Supabase; RLS tetap menjadi lapisan keamanan utama. */
(function () {
  const SESSION_KEY = 'tms_pdc_session';
  const configured = typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL &&
    typeof SUPABASE_ANON_KEY !== 'undefined' && SUPABASE_ANON_KEY;

  let client = null;
  let currentSession = null;
  let readyResolve;
  const readyPromise = new Promise(resolve => { readyResolve = resolve; });

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function localSessionExists() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      return value?.mode === 'local';
    } catch (_) {
      return false;
    }
  }

  async function loadSdk() {
    if (window.supabase) return window.supabase;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      script.onload = () => resolve(window.supabase);
      script.onerror = () => reject(new Error('Gagal memuat Supabase SDK.'));
      document.head.appendChild(script);
    });
    return window.supabase;
  }

  async function getClient() {
    if (!configured) return null;
    if (client) return client;
    const sb = await loadSdk();
    client = window.tmsSupabaseClient || sb.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.tmsSupabaseClient = client;
    return client;
  }

  async function readSession() {
    const sb = await getClient();
    if (!sb) return null;

    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const { data, error } = await sb.auth.getSession();
        if (error) throw error;
        if (data?.session?.user) {
          currentSession = data.session;
          return data.session;
        }
        currentSession = null;
        return null;
      } catch (error) {
        lastError = error;
        await sleep(150 * (attempt + 1));
      }
    }
    throw lastError || new Error('Sesi Supabase belum dapat dibaca.');
  }

  function persistSession(session) {
    if (session?.user) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        mode: 'supabase',
        user: session.user.email || '',
        at: Date.now()
      }));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  }

  async function initialize() {
    try {
      if (!configured) {
        readyResolve({ mode: 'local', session: null });
        return;
      }
      const session = await readSession();
      persistSession(session);
      readyResolve({ mode: 'supabase', session });
    } catch (error) {
      console.error('Auth middleware initialization failed:', error);
      currentSession = null;
      localStorage.removeItem(SESSION_KEY);
      readyResolve({ mode: 'supabase', session: null, error });
    }
  }

  async function waitUntilReady() {
    return readyPromise;
  }

  async function requireSession() {
    const state = await waitUntilReady();

    if (!configured) {
      if (localSessionExists()) return { mode: 'local', session: null };
      const error = new Error('Sesi login lokal tidak ditemukan.');
      error.code = 'AUTH_SESSION_REQUIRED';
      throw error;
    }

    // Baca ulang session supaya race condition setelah sign-in tidak memicu 401.
    const session = await readSession();
    if (session?.user) {
      persistSession(session);
      return { mode: 'supabase', session };
    }

    currentSession = state?.session || null;
    if (currentSession?.user) return { mode: 'supabase', session: currentSession };

    const error = new Error('Sesi Supabase belum siap. Silakan login ulang.');
    error.code = 'AUTH_SESSION_REQUIRED';
    throw error;
  }

  function handleSignedOut() {
    currentSession = null;
    persistSession(null);
    const login = document.querySelector('#loginScreen');
    const app = document.querySelector('#appShell');
    if (login) login.classList.remove('hidden');
    if (app) app.classList.add('hidden');
    document.dispatchEvent(new CustomEvent('tms-auth-required'));
  }

  async function startListener() {
    if (!configured) return;
    try {
      const sb = await getClient();
      sb.auth.onAuthStateChange((event, session) => {
        if (session?.user) {
          currentSession = session;
          persistSession(session);
          return;
        }
        if (event === 'SIGNED_OUT') handleSignedOut();
      });
    } catch (error) {
      console.warn('Auth middleware listener failed:', error);
    }
  }

  window.tmsAuthMiddleware = {
    enabled: !!configured,
    waitUntilReady,
    requireSession,
    getClient,
    getSession: async () => {
      await waitUntilReady();
      if (!configured) return localSessionExists() ? null : null;
      return readSession();
    }
  };

  initialize().finally(startListener);
})();
