/* ═══════════════════════════════════════════════════════════
   KONVEKSI HUD MULTI-ROOM — Logic Utama
   ═══════════════════════════════════════════════════════════ */
import { DB, auth, isOnline } from './supabase.js';

/* ────────── STATE GLOBAL ────────── */
const S = {
  user: null,          // { id, email }
  profile: null,       // { id, nama, role }
  rooms: [],           // daftar room milik user / semua (super admin)
  room: null,          // room aktif
  workers: [],
  jobs: [],
  tarifs: {},
  editingWorkerId: null,
  editingRoomId: null,
  currentDoneJobId: null,
  gajiWeekFilter: '',
  gajiWorkerFilter: '',
  riwayatWeekFilter: '',
  riwayatWorkerFilter: '',
};

/* ═══════════════════════════════════════════════════════════
   UTIL
   ═══════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const rp = n => 'Rp' + Math.round(n).toLocaleString('id-ID');
const fmtNum = n => n.toLocaleString('id-ID', {maximumFractionDigits:2});
const nowISO = () => new Date().toISOString();
const esc = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function fmtDate(iso){
  if(!iso) return '—';
  const d = new Date(iso);
  const bln = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const jam = String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  return d.getDate()+' '+bln[d.getMonth()]+' '+d.getFullYear()+' • '+jam;
}
function toast(msg, err){
  const t = $('toast');
  t.textContent = msg;
  t.className = err ? 'show err' : 'show';
  clearTimeout(t._t);
  t._t = setTimeout(()=>{ t.className=''; }, 2400);
}
const openModal = id => $(id).classList.add('show');
const closeModal = id => $(id).classList.remove('show');

/* ────────── HITUNG UPAH (port dari jait.html) ────────── */
function hitungUpah(pcs, tarif, satuan){
  if(!pcs || !tarif) return 0;
  if(satuan === 'lusin') return (pcs / 12) * tarif;
  return pcs * tarif;
}
function pcsKeLusin(pcs){
  return { lusinPenuh: Math.floor(pcs/12), sisa: pcs % 12, lusinDesimal: pcs/12 };
}
function fmtJumlahLusinPcs(pcs){
  const { sisa, lusinDesimal } = pcsKeLusin(pcs);
  let s = fmtNum(lusinDesimal) + ' lusin';
  if(sisa > 0) s += ' + ' + sisa + ' pcs';
  return s + ' = ' + pcs + ' pcs';
}

/* ────────── MINGGU KERJA (Senin–Minggu) ────────── */
function getWeekStart(d){
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  dt.setDate(dt.getDate() + diff); dt.setHours(0,0,0,0);
  return dt;
}
function getWeekEnd(d){
  const s = getWeekStart(d);
  s.setDate(s.getDate()+6); s.setHours(23,59,59,999);
  return s;
}
function weekKey(d){
  const s = getWeekStart(d);
  return s.getFullYear()+'-'+String(s.getMonth()+1).padStart(2,'0')+'-'+String(s.getDate()).padStart(2,'0');
}
function weekLabel(d){
  const s = getWeekStart(d), e = getWeekEnd(d);
  const bln = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  return s.getDate()+' '+bln[s.getMonth()]+' – '+e.getDate()+' '+bln[e.getMonth()];
}

/* ═══════════════════════════════════════════════════════════
   CLOCK
   ═══════════════════════════════════════════════════════════ */
function tickClock(){
  const d = new Date();
  const t = String(d.getHours()).padStart(2,'0')+':'+
            String(d.getMinutes()).padStart(2,'0')+':'+
            String(d.getSeconds()).padStart(2,'0');
  ['clock','saClock','roomClock'].forEach(id => { const el = $(id); if(el) el.textContent = t; });
}

/* ═══════════════════════════════════════════════════════════
   PAGE SWITCHING
   ═══════════════════════════════════════════════════════════ */
function showPage(id){
  ['page-login','page-superadmin','page-roompicker','page-room'].forEach(p => {
    const el = $(p); if(el) el.style.display = (p === id ? '' : 'none');
  });
}
function switchRoomPage(p){
  document.querySelectorAll('#page-room .page').forEach(el => el.classList.remove('active'));
  $('page-'+p).classList.add('active');
  document.querySelectorAll('#page-room nav button').forEach(b => {
    b.classList.toggle('active', b.dataset.page === p);
  });
  if(p === 'hud') renderHUD();
  if(p === 'gaji') renderGaji();
  if(p === 'pekerja'){ renderWorkers(); renderRiwayat(); }
}

/* ═══════════════════════════════════════════════════════════
   AUTH
   ═══════════════════════════════════════════════════════════ */
let signupMode = false;

window.doLogin = async function(){
  const email = $('loginEmail').value.trim();
  const pass  = $('loginPassword').value;
  if(!email || !pass){ toast('Isi email dan password', true); return; }
  try{
    $('btnLogin').textContent = 'MEMUAT...';
    const user = await auth.login(email, pass);
    await bootAfterLogin(user);
  }catch(e){
    toast('Login gagal: ' + e.message, true);
    $('btnLogin').textContent = 'MASUK';
  }
};

window.doSignup = async function(){
  if(!signupMode){
    // ganti ke mode signup
    signupMode = true;
    $('loginSub').textContent = 'Daftar akun baru';
    $('btnLogin').textContent = 'DAFTAR';
    $('btnLogin').setAttribute('onclick', 'doSignupSubmit()');
    $('btnSignup').textContent = 'SUDAH PUNYA AKUN? MASUK';
    $('btnSignup').setAttribute('onclick', 'doLoginMode()');
    return;
  }
};

window.doSignupSubmit = async function(){
  const email = $('loginEmail').value.trim();
  const pass  = $('loginPassword').value;
  if(!email || !pass){ toast('Isi email dan password', true); return; }
  if(pass.length < 6){ toast('Password minimal 6 karakter', true); return; }
  try{
    $('btnLogin').textContent = 'MEMBUAT...';
    const user = await auth.signup(email, pass, email.split('@')[0]);
    toast('Akun dibuat. Silakan login.');
    doLoginMode();
  }catch(e){
    toast('Gagal daftar: ' + e.message, true);
    $('btnLogin').textContent = 'DAFTAR';
  }
};

window.doLoginMode = function(){
  signupMode = false;
  $('loginSub').textContent = 'Masuk ke akun Anda';
  $('btnLogin').textContent = 'MASUK';
  $('btnLogin').setAttribute('onclick', 'doLogin()');
  $('btnSignup').textContent = 'BELUM PUNYA AKUN? DAFTAR';
  $('btnSignup').setAttribute('onclick', 'doSignup()');
};

window.doLogout = async function(){
  await auth.logout();
  S.user = null; S.profile = null; S.room = null;
  S.workers = []; S.jobs = []; S.tarifs = {};
  showPage('page-login');
  toast('Keluar');
};

/* ═══════════════════════════════════════════════════════════
   BOOT SETELAH LOGIN
   ═══════════════════════════════════════════════════════════ */
async function bootAfterLogin(user){
  S.user = user;
  S.profile = await DB.getProfile(user.id);
  if(!S.profile){
    toast('Profil tidak ditemukan', true); return;
  }

  // Kalau belum ada super admin di sistem DAN ini user pertama → jadikan super admin
  // (hanya di mode local; di Supabase, role diatur manual / via Edge Function)
  if(!isOnline){
    const all = await DB.listAllProfiles();
    const hasSuper = all.some(p => p.role === 'super_admin');
    if(!hasSuper){
      await DB.updateProfile(S.user.id, { role: 'super_admin' });
      S.profile.role = 'super_admin';
      toast('Anda menjadi Super Admin (akun pertama)');
    }
  }

  if(S.profile.role === 'super_admin'){
    await loadSuperAdmin();
    showPage('page-superadmin');
  }else{
    await loadRoomPicker();
    showPage('page-roompicker');
  }
}

/* ═══════════════════════════════════════════════════════════
   SUPER ADMIN — Dashboard & CRUD Room
   ═══════════════════════════════════════════════════════════ */
async function loadSuperAdmin(){
  const rooms = await DB.listAllRooms();
  const profiles = await DB.listAllProfiles();

  // Statistik
  let totalWorkers = 0, totalJobs = 0;
  for(const r of rooms){
    const data = await DB.loadRoomData(r.id);
    totalWorkers += data.workers.length;
    totalJobs += data.jobs.length;
  }

  $('saStats').innerHTML = `
    <div class="stat-card"><div class="lbl">Total Room</div><div class="val">${rooms.length}</div></div>
    <div class="stat-card"><div class="lbl">Total Pekerja</div><div class="val">${totalWorkers}</div></div>
    <div class="stat-card"><div class="lbl">Total Pekerjaan</div><div class="val">${totalJobs}</div></div>
    <div class="stat-card"><div class="lbl">User Terdaftar</div><div class="val">${profiles.length}</div></div>
  `;

  renderSuperAdminRooms(rooms, profiles);
}

function renderSuperAdminRooms(rooms, profiles){
  const wrap = $('saRoomList');
  if(rooms.length === 0){
    wrap.innerHTML = '<div class="empty"><span class="big">⬢</span>Belum ada room.<br>Tekan + BUAT ROOM BARU.</div>';
    return;
  }
  wrap.innerHTML = rooms.map(r => {
    const owner = profiles.find(p => p.id === r.pemilik_id);
    const ownerName = owner ? owner.nama : '(belum ditetapkan)';
    const ownerEmail = owner ? owner.email : '—';
    const statusClass = r.status === 'aktif' ? 'aktif' : 'off';
    const berakhir = r.berakhir_at ? new Date(r.berakhir_at) : null;
    const now = new Date();
    let sisaHari = '';
    if(berakhir){
      const diff = Math.ceil((berakhir - now) / 86400000);
      sisaHari = diff < 0 ? ` <span style="color:var(--danger)">(kedaluwarsa)</span>`
              : diff < 7 ? ` <span style="color:var(--warn)">(${diff} hari lagi)</span>`
              : ` (${diff} hari lagi)`;
    }
    return `<div class="room-card">
      <div class="rname">${esc(r.nama).toUpperCase()}
        <span class="tag ${statusClass}">${r.status.toUpperCase()}</span>
      </div>
      <div class="rslug">/${esc(r.slug)}</div>
      <div class="rmeta">
        <b>Pemilik:</b> ${esc(ownerName)} • ${esc(ownerEmail)}<br>
        <b>Paket:</b> ${esc(r.paket)} • <b>Berakhir:</b> ${r.berakhir_at || '—'}${sisaHari}
      </div>
      <div class="ractions">
        <button class="btn btn-sm btn-primary" onclick="editRoom('${r.id}')">UBAH</button>
        <button class="btn btn-sm btn-ghost" onclick="toggleRoomStatus('${r.id}')">
          ${r.status === 'aktif' ? 'TANGGUHKAN' : 'AKTIFKAN'}
        </button>
        <button class="btn btn-sm btn-danger" onclick="deleteRoom('${r.id}')">HAPUS</button>
      </div>
    </div>`;
  }).join('');
}

window.openRoomModal = function(){
  S.editingRoomId = null;
  $('rm_title').textContent = 'Buat Room Baru';
  $('rm_nama').value = '';
  $('rm_slug').value = '';
  $('rm_owner').value = '';
  $('rm_email').value = '';
  $('rm_password').value = 'konveksi123';
  $('rm_kontak').value = '';
  $('rm_paket').value = 'basic';
  const today = new Date().toISOString().slice(0,10);
  const plus30 = new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  $('rm_mulai').value = today;
  $('rm_berakhir').value = plus30;
  $('rm_status').value = 'aktif';
  openModal('roomModal');
};

window.editRoom = async function(id){
  const rooms = await DB.listAllRooms();
  const r = rooms.find(x => x.id === id);
  if(!r) return;
  S.editingRoomId = id;
  $('rm_title').textContent = 'Ubah Room';
  $('rm_nama').value = r.nama;
  $('rm_slug').value = r.slug;
  $('rm_owner').value = '';
  $('rm_email').value = '';
  $('rm_password').value = '';
  $('rm_kontak').value = r.kontak || '';
  $('rm_paket').value = r.paket || 'basic';
  $('rm_mulai').value = r.mulai_at || '';
  $('rm_berakhir').value = r.berakhir_at || '';
  $('rm_status').value = r.status || 'aktif';
  openModal('roomModal');
};

window.saveRoom = async function(){
  const nama = $('rm_nama').value.trim();
  const slug = $('rm_slug').value.trim();
  if(!nama){ toast('Isi nama konveksi', true); return; }
  if(!slug || !/^[a-z0-9-]{3,40}$/.test(slug)){ toast('Slug tidak valid', true); return; }

  if(S.editingRoomId){
    // Update
    await DB.updateRoom(S.editingRoomId, {
      nama, slug,
      kontak: $('rm_kontak').value.trim(),
      paket: $('rm_paket').value,
      mulai_at: $('rm_mulai').value,
      berakhir_at: $('rm_berakhir').value,
      status: $('rm_status').value,
    });
    toast('✓ Room diubah');
  }else{
    // Buat baru
    const ownerEmail = $('rm_email').value.trim();
    const ownerNama = $('rm_owner').value.trim();
    const ownerPass = $('rm_password').value.trim();
    if(!ownerEmail){ toast('Isi email pemilik', true); return; }
    if(ownerPass.length < 6){ toast('Password minimal 6 karakter', true); return; }

    // Cek slug unik
    const all = await DB.listAllRooms();
    if(all.some(x => x.slug === slug)){ toast('Slug sudah dipakai', true); return; }

    // Buat / ambil akun pemilik
    let ownerId = null;
    try{
      const existing = await DB.findUserByEmail(ownerEmail);
      if(existing){
        ownerId = existing.id;
      }else{
        const newUser = await auth.createUserByAdmin
          ? await auth.createUserByAdmin(ownerEmail, ownerPass, ownerNama)
          : await auth.signup(ownerEmail, ownerPass, ownerNama);
        ownerId = newUser.id;
      }
    }catch(e){
      toast('Gagal buat akun pemilik: ' + e.message, true); return;
    }

    // Buat room
    const room = await DB.createRoom({
      nama, slug,
      pemilik_id: ownerId,
      kontak: $('rm_kontak').value.trim(),
      paket: $('rm_paket').value,
      mulai_at: $('rm_mulai').value,
      berakhir_at: $('rm_berakhir').value,
      status: $('rm_status').value,
    });

    // Tambahkan pemilik sebagai member
    if(ownerId){
      await DB.addRoomMember(room.id, ownerId, 'owner');
    }

    toast('✓ Room dibuat. Pemilik: ' + ownerEmail);
  }

  closeModal('roomModal');
  await loadSuperAdmin();
};

window.toggleRoomStatus = async function(id){
  const rooms = await DB.listAllRooms();
  const r = rooms.find(x => x.id === id);
  if(!r) return;
  const newStatus = r.status === 'aktif' ? 'ditangguhkan' : 'aktif';
  await DB.updateRoom(id, { status: newStatus });
  toast(newStatus === 'aktif' ? '✓ Room diaktifkan' : '⚠ Room ditangguhkan');
  await loadSuperAdmin();
};

window.deleteRoom = async function(id){
  if(!confirm('Hapus room ini beserta SEMUA data (pekerja, pekerjaan, riwayat)?')) return;
  await DB.deleteRoom(id);
  toast('Room dihapus');
  await loadSuperAdmin();
};

/* ═══════════════════════════════════════════════════════════
   ROOM PICKER (untuk owner)
   ═══════════════════════════════════════════════════════════ */
async function loadRoomPicker(){
  const rooms = await DB.listRoomsForUser(S.user.id);
  const wrap = $('pickerList');
  if(rooms.length === 0){
    wrap.innerHTML = '';
    $('pickerEmpty').style.display = 'block';
    return;
  }
  $('pickerEmpty').style.display = 'none';
  wrap.innerHTML = rooms.map(r => {
    const statusClass = r.status === 'aktif' ? 'aktif' : 'off';
    const blocked = r.status !== 'aktif';
    return `<div class="room-card" style="${blocked ? 'opacity:0.6;' : 'cursor:pointer;'}"
                 ${blocked ? '' : `onclick="enterRoom('${r.id}')"`}>
      <div class="rname">${esc(r.nama).toUpperCase()}
        <span class="tag ${statusClass}">${r.status.toUpperCase()}</span>
      </div>
      <div class="rmeta">
        Paket: ${esc(r.paket)} • Berakhir: ${r.berakhir_at || '—'}
        ${blocked ? '<br><span style="color:var(--danger)">Room tidak aktif. Hubungi Super Admin.</span>' : ''}
      </div>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════
   ENTER ROOM — Load data & tampilkan HUD obras
   ═══════════════════════════════════════════════════════════ */
window.enterRoom = async function(roomId){
  const room = await DB.getRoom(roomId);
  if(!room){ toast('Room tidak ditemukan', true); return; }
  if(room.status !== 'aktif'){ toast('Room tidak aktif', true); return; }

  S.room = room;
  const data = await DB.loadRoomData(room.id);
  S.workers = data.workers;
  S.jobs = data.jobs;
  S.tarifs = data.tarifs;

  // Kalau tarif kosong, isi default (hanya sekali)
  if(Object.keys(S.tarifs).length === 0){
    S.tarifs = {
      obras:   { tarif: 8000, satuan: 'lusin' },
      jahit:   { tarif: 6000, satuan: 'lusin' },
      kam:     { tarif: 5000, satuan: 'lusin' },
      kancing: { tarif: 300,  satuan: 'pcs'   },
    };
    for(const [jenis, t] of Object.entries(S.tarifs)){
      await DB.saveTarif(room.id, jenis, t.tarif, t.satuan);
    }
  }

  $('roomTitle').textContent = room.nama.toUpperCase();
  $('roomSub').textContent = '/' + room.slug + ' • ' + (S.profile.nama || '');

  showPage('page-room');
  switchRoomPage('hud');
};

window.exitRoom = function(){
  S.room = null; S.workers = []; S.jobs = []; S.tarifs = {};
  if(S.profile.role === 'super_admin'){
    loadSuperAdmin(); showPage('page-superadmin');
  }else{
    loadRoomPicker(); showPage('page-roompicker');
  }
};

/* ═══════════════════════════════════════════════════════════
   HUD — Pekerjaan Aktif
   ═══════════════════════════════════════════════════════════ */
function renderHUD(){
  const wrap = $('hudList');
  const aktif = S.jobs.filter(j => j.status === 'aktif');
  if(aktif.length === 0){
    wrap.innerHTML = '<div class="empty"><span class="big">⬢</span>Tidak ada pekerjaan aktif.<br>Tekan ＋ KASIH BARANG untuk mulai.</div>';
    return;
  }
  const byWorker = {};
  aktif.forEach(j => { (byWorker[j.worker_id] ||= []).push(j); });

  wrap.innerHTML = Object.keys(byWorker).map(wid => {
    const w = S.workers.find(x => x.id === wid);
    const nama = w ? w.nama : 'Tanpa Nama';
    const list = byWorker[wid];
    const jobsHtml = list.map(j => `
      <div class="job-block">
        <div class="job-line"><span class="lbl">Pekerjaan:</span> <b>${esc(j.jenis)} ${esc(j.barang)}</b></div>
        <div class="job-line"><span class="lbl">Jumlah:</span> <span class="job-amt">${j.jumlah_awal} pcs</span></div>
        <div class="job-line"><span class="lbl">Tarif:</span> ${rp(j.tarif)} / ${j.satuan}</div>
        <button class="btn btn-done" onclick="openDone('${j.id}')">✓ SUDAH SELESAI</button>
      </div>`).join('');
    return `<div class="hud-panel">
      <div class="hud-name">${esc(nama).toUpperCase()}</div>
      <div class="hud-status busy">● SEDANG BEKERJA (${list.length} tugas)</div>
      ${jobsHtml}
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════
   MODAL KASIH BARANG
   ═══════════════════════════════════════════════════════════ */
window.openJobModal = function(){
  const aktifW = S.workers.filter(w => w.status === 'aktif');
  $('jm_worker').innerHTML = '<option value="">— Pilih Pekerja —</option>' +
    aktifW.map(w => `<option value="${w.id}">${esc(w.nama)}</option>`).join('');
  $('jm_newWorker').value = '';

  const allJenis = [...new Set(['obras','jahit','kam','kancing', ...Object.keys(S.tarifs)])];
  $('jm_jenis').innerHTML = allJenis.map(j => `<option value="${j}">${esc(j)}</option>`).join('') +
    '<option value="__baru__">+ Jenis baru...</option>';
  $('jm_newJenis').value = ''; $('jm_newJenis').style.display = 'none';

  $('jm_barang').value = ''; $('jm_jumlah').value = ''; $('jm_tarif').value = '';
  $('jm_satuan').value = 'lusin'; $('jm_preview').style.display = 'none';

  updateTarifFromJenis();
  openModal('jobModal');
};

function updateTarifFromJenis(){
  const jenis = $('jm_jenis').value;
  const t = S.tarifs[jenis];
  if(t){
    $('jm_tarif').value = t.tarif;
    $('jm_satuan').value = t.satuan;
    $('jm_tarifHint').textContent = `Tarif tersimpan: ${rp(t.tarif)} per ${t.satuan}. Bisa diubah.`;
  }else{
    $('jm_tarifHint').textContent = 'Belum ada tarif tersimpan. Isi tarif baru.';
  }
  updateJobPreview();
}

function updateJobPreview(){
  const pcs = parseInt($('jm_jumlah').value) || 0;
  const tarif = parseFloat($('jm_tarif').value) || 0;
  const satuan = $('jm_satuan').value;
  const box = $('jm_preview');
  if(pcs > 0 && tarif > 0){
    const total = hitungUpah(pcs, tarif, satuan);
    let detail;
    if(satuan === 'lusin'){
      detail = `${pcs} ÷ 12 = ${fmtNum(pcs/12)} lusin<br>${fmtNum(pcs/12)} × ${rp(tarif)} = <b>${rp(total)}</b>`;
    }else{
      detail = `${pcs} × ${rp(tarif)} = <b>${rp(total)}</b>`;
    }
    box.innerHTML = `Perhitungan otomatis:<br>${detail}`;
    box.style.display = 'block';
  }else{ box.style.display = 'none'; }
}

window.simpanPekerjaan = async function(){
  if(!S.room){ toast('Room tidak aktif', true); return; }
  let workerId = $('jm_worker').value;
  const newWorkerName = $('jm_newWorker').value.trim();

  if(newWorkerName){
    const w = { id: uid(), room_id: S.room.id, nama: newWorkerName, status: 'aktif', created_at: nowISO() };
    await DB.saveWorker(w);
    S.workers.push(w);
    workerId = w.id;
  }else if(workerId){
    if(!S.workers.find(x => x.id === workerId)){ toast('Pekerja tidak ditemukan', true); return; }
  }else{
    toast('Pilih pekerja atau isi nama baru', true); return;
  }

  let jenis = $('jm_jenis').value;
  const newJenis = $('jm_newJenis').value.trim().toLowerCase();
  if(jenis === '__baru__'){
    if(!newJenis){ toast('Isi jenis baru', true); return; }
    jenis = newJenis;
  }

  const barang = $('jm_barang').value.trim();
  if(!barang){ toast('Isi nama barang', true); return; }

  const pcs = parseInt($('jm_jumlah').value);
  if(!pcs || pcs <= 0){ toast('Jumlah pcs tidak valid', true); return; }

  const tarif = parseFloat($('jm_tarif').value);
  if(!tarif || tarif <= 0){ toast('Tarif tidak valid', true); return; }

  const satuan = $('jm_satuan').value;
  S.tarifs[jenis] = { tarif, satuan };
  await DB.saveTarif(S.room.id, jenis, tarif, satuan);

  const job = {
    id: uid(),
    room_id: S.room.id,
    worker_id: workerId,
    barang, jenis,
    jumlah_awal: pcs,
    jumlah_selesai: null,
    tarif, satuan,
    total_upah: 0,
    status: 'aktif',
    created_at: nowISO(),
    selesai_at: null,
  };
  await DB.saveJob(job);
  S.jobs.push(job);

  toast('✓ Pekerjaan tersimpan');
  closeModal('jobModal');
  renderAll();
};

/* ═══════════════════════════════════════════════════════════
   KONFIRMASI SELESAI
   ═══════════════════════════════════════════════════════════ */
window.openDone = function(jobId){
  const job = S.jobs.find(j => j.id === jobId);
  if(!job || job.status !== 'aktif'){ toast('Pekerjaan tidak aktif', true); return; }
  S.currentDoneJobId = jobId;
  const w = S.workers.find(x => x.id === job.worker_id);
  $('doneInfo').innerHTML = `
    <div class="info-line"><span>Pekerja</span><span>${esc(w ? w.nama : '-')}</span></div>
    <div class="info-line"><span>Barang</span><span>${esc(job.barang)}</span></div>
    <div class="info-line"><span>Pekerjaan</span><span>${esc(job.jenis)}</span></div>
    <div class="info-line"><span>Jumlah awal</span><span>${job.jumlah_awal} pcs</span></div>
    <div class="info-line"><span>Tarif</span><span>${rp(job.tarif)} / ${job.satuan}</span></div>`;
  $('done_jumlah').value = job.jumlah_awal;
  updateDonePreview();
  openModal('doneModal');
};

function updateDonePreview(){
  const job = S.jobs.find(j => j.id === S.currentDoneJobId);
  if(!job) return;
  const pcs = parseInt($('done_jumlah').value) || 0;
  const selisih = pcs - job.jumlah_awal;
  const selEl = $('done_selisih'), prev = $('done_preview');

  if(selisih === 0){ selEl.textContent = 'Jumlah sama dengan awal.'; selEl.style.color = 'var(--dim)'; }
  else if(selisih < 0){ selEl.textContent = `⚠ Kurang ${Math.abs(selisih)} pcs dari awal.`; selEl.style.color = 'var(--warn)'; }
  else{ selEl.textContent = `⚠ Lebih ${selisih} pcs dari awal.`; selEl.style.color = 'var(--warn)'; }

  const total = hitungUpah(pcs, job.tarif, job.satuan);
  let detail = job.satuan === 'lusin'
    ? `${pcs} ÷ 12 = ${fmtNum(pcs/12)} lusin × ${rp(job.tarif)} = <b>${rp(total)}</b>`
    : `${pcs} × ${rp(job.tarif)} = <b>${rp(total)}</b>`;
  prev.innerHTML = `Total upah: ${detail}`;
}

window.konfirmasiSelesai = async function(){
  const job = S.jobs.find(j => j.id === S.currentDoneJobId);
  if(!job || job.status !== 'aktif'){ toast('Pekerjaan sudah selesai', true); closeModal('doneModal'); return; }
  const pcs = parseInt($('done_jumlah').value);
  if(!pcs || pcs <= 0){ toast('Jumlah tidak valid', true); return; }

  const total = hitungUpah(pcs, job.tarif, job.satuan);
  job.jumlah_selesai = pcs;
  job.total_upah = total;
  job.status = 'selesai';
  job.selesai_at = nowISO();
  await DB.saveJob(job);

  closeModal('doneModal');
  toast('✓ Selesai — ' + rp(total) + ' masuk buku gaji');
  S.currentDoneJobId = null;
  renderAll();
  setTimeout(()=>openJobModal(), 350);
};

/* ═══════════════════════════════════════════════════════════
   BUKU GAJI
   ═══════════════════════════════════════════════════════════ */
function buildWeekChips(containerId, onSelect, current){
  const container = $(containerId);
  const weeks = {};
  S.jobs.filter(j => j.status === 'selesai' && j.selesai_at).forEach(j => {
    weeks[weekKey(new Date(j.selesai_at))] = true;
  });
  weeks[weekKey(new Date())] = true;
  const sorted = Object.keys(weeks).sort().reverse();
  container.innerHTML =
    `<div class="chip ${!current?'active':''}" onclick="${onSelect}('')">Semua</div>` +
    sorted.map(k => {
      const d = new Date(k+'T00:00:00');
      return `<div class="chip ${current===k?'active':''}" onclick="${onSelect}('${k}')">${weekLabel(d)}</div>`;
    }).join('');
}

window.setGajiWeek = function(k){
  S.gajiWeekFilter = k;
  buildWeekChips('gajiWeekChips','setGajiWeek',k);
  renderGaji();
};
window.setRiwayatWeek = function(k){
  S.riwayatWeekFilter = k;
  buildWeekChips('riwayatWeekChips','setRiwayatWeek',k);
  renderRiwayat();
};

function isInWeek(iso, key){
  if(!key) return true;
  return weekKey(new Date(iso)) === key;
}

function renderGaji(){
  const sel = $('gajiWorkerFilter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Semua Pekerja —</option>' +
    S.workers.map(w => `<option value="${w.id}">${esc(w.nama)}</option>`).join('');
  sel.value = cur;

  buildWeekChips('gajiWeekChips','setGajiWeek',S.gajiWeekFilter);

  let list = S.jobs.filter(j => j.status === 'selesai' && j.selesai_at);
  if(S.gajiWorkerFilter) list = list.filter(j => j.worker_id === S.gajiWorkerFilter);
  if(S.gajiWeekFilter) list = list.filter(j => isInWeek(j.selesai_at, S.gajiWeekFilter));
  list.sort((a,b) => new Date(a.selesai_at) - new Date(b.selesai_at));

  const wrap = $('gajiList'), totalWrap = $('gajiTotal');
  if(list.length === 0){
    wrap.innerHTML = '<div class="empty"><span class="big">▤</span>Belum ada catatan upah.</div>';
    totalWrap.innerHTML = '';
  }else{
    wrap.innerHTML = list.map(j => {
      const w = S.workers.find(x => x.id === j.worker_id);
      const nama = w ? w.nama : '(pekerja dihapus)';
      return `<div class="pay-item">
        <div class="pay-name">${esc(nama).toUpperCase()}</div>
        <div class="pay-title"><b>${esc(j.barang)}</b> — ${esc(j.jenis)}</div>
        <div class="pay-row">Jumlah: <span class="v">${j.jumlah_selesai} pcs</span></div>
        <div class="pay-row">${fmtJumlahLusinPcs(j.jumlah_selesai)}</div>
        <div class="pay-row">Tarif: <span class="v">${rp(j.tarif)} / ${j.satuan}</span></div>
        <div class="pay-total">Total: ${rp(j.total_upah)}</div>
        <div class="pay-date">Selesai: ${fmtDate(j.selesai_at)}</div>
      </div>`;
    }).join('');

    const total = list.reduce((s,j) => s + j.total_upah, 0);
    const totalPcs = list.reduce((s,j) => s + j.jumlah_selesai, 0);
    totalWrap.innerHTML = `<div class="grand-total">
      <div class="lbl">TOTAL GAJI ${S.gajiWorkerFilter ? 'PEKERJA' : 'SEMUA'} ${S.gajiWeekFilter ? '• '+weekLabel(new Date(S.gajiWeekFilter+'T00:00:00')).toUpperCase() : ''}</div>
      <div class="val">${rp(total)}</div>
      <div class="lbl" style="margin-top:4px;">${list.length} pekerjaan • ${totalPcs} pcs</div>
    </div>`;
  }

  renderRekap();
}

function renderRekap(){
  const wrap = $('gajiRekap');
  let list = S.jobs.filter(j => j.status === 'selesai' && j.selesai_at);
  if(S.gajiWeekFilter) list = list.filter(j => isInWeek(j.selesai_at, S.gajiWeekFilter));

  const byWorker = {};
  list.forEach(j => {
    const w = S.workers.find(x => x.id === j.worker_id);
    const nama = w ? w.nama : '(pekerja dihapus)';
    if(!byWorker[j.worker_id]) byWorker[j.worker_id] = { nama, total: 0, count: 0 };
    byWorker[j.worker_id].total += j.total_upah;
    byWorker[j.worker_id].count++;
  });
  const arr = Object.values(byWorker).sort((a,b) => b.total - a.total);
  if(arr.length === 0){
    wrap.innerHTML = '<div class="empty" style="padding:20px;">Belum ada data.</div>';
    return;
  }
  wrap.innerHTML = arr.map(x => `
    <div class="worker-sum">
      <span class="n">${esc(x.nama).toUpperCase()} <span style="color:var(--dim);font-size:.7rem;">(${x.count}x)</span></span>
      <span class="t">${rp(x.total)}</span>
    </div>`).join('');
}

/* ═══════════════════════════════════════════════════════════
   PEKERJA & RIWAYAT
   ═══════════════════════════════════════════════════════════ */
function renderWorkers(){
  const wrap = $('workerList');
  if(S.workers.length === 0){
    wrap.innerHTML = '<div class="empty"><span class="big">☰</span>Belum ada pekerja.</div>';
    return;
  }
  wrap.innerHTML = S.workers.map(w => {
    const aktifCount = S.jobs.filter(j => j.worker_id === w.id && j.status === 'aktif').length;
    const selesaiCount = S.jobs.filter(j => j.worker_id === w.id && j.status === 'selesai').length;
    const totalMinggu = S.jobs
      .filter(j => j.worker_id === w.id && j.status === 'selesai' && j.selesai_at && weekKey(new Date(j.selesai_at)) === weekKey(new Date()))
      .reduce((s,j) => s + j.total_upah, 0);
    return `<div class="worker-card">
      <div class="wname">${esc(w.nama).toUpperCase()}
        <span class="tag ${w.status === 'aktif' ? 'aktif' : 'off'}">${w.status.toUpperCase()}</span>
      </div>
      <div class="wmeta">
        Tugas aktif: <b style="color:var(--neon2)">${aktifCount}</b> • Selesai: ${selesaiCount} • Upah minggu ini: <b style="color:var(--ok)">${rp(totalMinggu)}</b>
      </div>
      <div style="margin-top:8px;">
        <button class="btn btn-ghost btn-sm" onclick="editWorker('${w.id}')">UBAH</button>
        <button class="btn btn-danger btn-sm" onclick="deleteWorker('${w.id}')">HAPUS</button>
      </div>
    </div>`;
  }).join('');
}

window.openWorkerModal = function(){
  S.editingWorkerId = null;
  $('wm_title').textContent = 'Tambah Pekerja';
  $('wm_nama').value = ''; $('wm_status').value = 'aktif';
  openModal('workerModal');
};
window.editWorker = function(id){
  const w = S.workers.find(x => x.id === id);
  if(!w) return;
  S.editingWorkerId = id;
  $('wm_title').textContent = 'Ubah Pekerja';
  $('wm_nama').value = w.nama; $('wm_status').value = w.status;
  openModal('workerModal');
};
window.simpanWorker = async function(){
  const nama = $('wm_nama').value.trim();
  const status = $('wm_status').value;
  if(!nama){ toast('Isi nama', true); return; }

  if(S.editingWorkerId){
    const w = S.workers.find(x => x.id === S.editingWorkerId);
    w.nama = nama; w.status = status;
    await DB.saveWorker(w);
  }else{
    const w = { id: uid(), room_id: S.room.id, nama, status, created_at: nowISO() };
    await DB.saveWorker(w);
    S.workers.push(w);
  }
  closeModal('workerModal');
  toast('✓ Tersimpan');
  renderAll();
};
window.deleteWorker = async function(id){
  const aktif = S.jobs.filter(j => j.worker_id === id && j.status === 'aktif').length;
  if(aktif > 0){ toast('Tidak bisa hapus, masih ada '+aktif+' tugas aktif', true); return; }
  if(!confirm('Hapus pekerja ini? Riwayat pekerjaan tetap tersimpan.')) return;
  await DB.deleteWorker(id);
  S.workers = S.workers.filter(x => x.id !== id);
  toast('Pekerja dihapus');
  renderAll();
};

function renderRiwayat(){
  const sel = $('riwayatWorkerFilter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Semua Pekerja —</option>' +
    S.workers.map(w => `<option value="${w.id}">${esc(w.nama)}</option>`).join('');
  sel.value = cur;

  buildWeekChips('riwayatWeekChips','setRiwayatWeek',S.riwayatWeekFilter);

  let list = S.jobs.slice();
  if(S.riwayatWorkerFilter) list = list.filter(j => j.worker_id === S.riwayatWorkerFilter);
  if(S.riwayatWeekFilter) list = list.filter(j => isInWeek(j.selesai_at || j.created_at, S.riwayatWeekFilter));
  list.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

  const wrap = $('riwayatList');
  if(list.length === 0){
    wrap.innerHTML = '<div class="empty"><span class="big">⌛</span>Belum ada riwayat.</div>';
    return;
  }
  wrap.innerHTML = list.map(j => {
    const w = S.workers.find(x => x.id === j.worker_id);
    const nama = w ? w.nama : '(pekerja dihapus)';
    const statusTag = j.status === 'selesai'
      ? '<span class="tag aktif">SELESAI</span>'
      : '<span class="tag status">AKTIF</span>';
    return `<div class="pay-item" style="border-left-color:${j.status==='selesai'?'var(--ok)':'var(--neon2)'}">
      <div class="pay-name">${esc(nama).toUpperCase()} ${statusTag}</div>
      <div class="pay-title"><b>${esc(j.barang)}</b> — ${esc(j.jenis)}</div>
      <div class="pay-row">Jumlah awal: <span class="v">${j.jumlah_awal} pcs</span></div>
      ${j.status==='selesai' ? `<div class="pay-row">Jumlah selesai: <span class="v">${j.jumlah_selesai} pcs</span></div>` : ''}
      <div class="pay-row">Tarif: <span class="v">${rp(j.tarif)} / ${j.satuan}</span></div>
      ${j.status==='selesai' ? `<div class="pay-total">Total: ${rp(j.total_upah)}</div>` : ''}
      <div class="pay-date">Dibuat: ${fmtDate(j.created_at)}${j.selesai_at ? ' • Selesai: '+fmtDate(j.selesai_at) : ''}</div>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════
   RENDER ALL
   ═══════════════════════════════════════════════════════════ */
function renderAll(){
  renderHUD();
  renderGaji();
  renderWorkers();
  renderRiwayat();
}

/* ═══════════════════════════════════════════════════════════
   EVENT LISTENERS (dipanggil setelah DOM ready)
   ═══════════════════════════════════════════════════════════ */
function bindEvents(){
  // Job modal
  $('jm_jenis').addEventListener('change', e => {
    const v = e.target.value;
    $('jm_newJenis').style.display = v === '__baru__' ? 'block' : 'none';
    updateTarifFromJenis();
  });
  $('jm_jumlah').addEventListener('input', updateJobPreview);
  $('jm_tarif').addEventListener('input', updateJobPreview);
  $('jm_satuan').addEventListener('change', updateJobPreview);
  $('done_jumlah').addEventListener('input', updateDonePreview);

  // Filter
  $('gajiWorkerFilter').addEventListener('change', e => {
    S.gajiWorkerFilter = e.target.value; renderGaji();
  });
  $('riwayatWorkerFilter').addEventListener('change', e => {
    S.riwayatWorkerFilter = e.target.value; renderRiwayat();
  });

  // Klik luar modal
  document.querySelectorAll('.modal-bg').forEach(bg => {
    bg.addEventListener('click', e => { if(e.target === bg) bg.classList.remove('show'); });
  });

  // Enter = login
  $('loginPassword').addEventListener('keydown', e => {
    if(e.key === 'Enter') $('btnLogin').click();
  });
}

/* ═══════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  tickClock(); setInterval(tickClock, 1000);

  // Mode note
  if(!isOnline){
    $('authModeNote').style.display = 'block';
    $('authModeNote').textContent = '⚠ Mode demo (localStorage). Isi kredensial Supabase di supabase.js untuk online.';
  }

  // Cek session
  try{
    const user = await auth.currentUser();
    if(user){
      await bootAfterLogin(user);
    }else{
      showPage('page-login');
    }
  }catch(e){
    console.warn('session check error', e);
    showPage('page-login');
  }
  $('bootScreen').style.display = 'none';
});