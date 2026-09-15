/* Profile menu: mobile tap reliability + account actions.
   Kept in its own script so app.js stays untouched. */
(function(){
  var toggle = document.getElementById('profileToggle');
  var menu = document.getElementById('profileMenu');
  if(!toggle || !menu) return;

  function closeMenu(){
    menu.classList.add('hidden');
    toggle.setAttribute('aria-expanded','false');
  }

  toggle.addEventListener('click', function(){
    var isOpen = !menu.classList.contains('hidden');
    menu.classList.toggle('hidden', isOpen);
    toggle.setAttribute('aria-expanded', String(!isOpen));
    if(window.syncProfileUI) window.syncProfileUI();
  });

  /* Close on outside tap (touch devices don't always emit the click app.js listens for). */
  document.addEventListener('pointerdown', function(e){
    if(menu.classList.contains('hidden')) return;
    if(e.target.closest('#profileMenu') || e.target.closest('#profileToggle')) return;
    closeMenu();
  });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeMenu(); });

  var logoutBtn = document.getElementById('profileLogout');
  if(logoutBtn) logoutBtn.addEventListener('click', function(){
    closeMenu();
    if(confirm('Keluar dari aplikasi?')) window.tmsAuth && window.tmsAuth.logout && window.tmsAuth.logout();
  });

  var pwBtn = document.getElementById('profileChangePw');
  if(pwBtn) pwBtn.addEventListener('click', async function(){
    closeMenu();
    var client = window.tmsAuth && window.tmsAuth.getClient && window.tmsAuth.getClient();
    if(!client){
      alert('Ganti password hanya tersedia saat login memakai akun cloud (Supabase).');
      return;
    }
    var pw = prompt('Masukkan password baru (minimal 6 karakter):');
    if(pw === null) return;
    pw = pw.trim();
    if(pw.length < 6){ alert('Password minimal 6 karakter.'); return; }
    var confirmPw = prompt('Ketik ulang password baru untuk konfirmasi:');
    if(confirmPw === null) return;
    if(pw !== confirmPw.trim()){ alert('Konfirmasi password tidak cocok. Tidak ada perubahan.'); return; }
    try{
      var res = await client.auth.updateUser({ password: pw });
      if(res && res.error) throw new Error(res.error.message);
      alert('Password berhasil diubah.');
    }catch(err){
      alert('Gagal mengubah password: ' + (err && err.message ? err.message : 'terjadi kesalahan'));
    }
    });
})();
