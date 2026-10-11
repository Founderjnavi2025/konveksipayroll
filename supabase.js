/* ═══════════════════════════════════════════════════════════
   DATA LAYER — Adapter Supabase / localStorage
   ═══════════════════════════════════════════════════════════
   Cara pakai:
   1. Biarkan SUPABASE_URL kosong → mode DEMO (localStorage).
      Semua fitur jalan penuh, data tersimpan di browser.
   2. Isi SUPABASE_URL + SUPABASE_ANON_KEY → mode ONLINE.
      Data tersimpan di Supabase, bisa diakses dari perangkat lain.
   ═══════════════════════════════════════════════════════════ */

const SUPABASE_URL      = ''; // ← isi dari Settings → API → Project URL
const SUPABASE_ANON_KEY = ''; // ← isi dari Settings → API → anon public

/* ───── Deteksi mode ───── */
export const isOnline = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

let sb = null;
if (isOnline && window.supabase) {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/* ═══════════════════════════════════════════════════════════
   HELPERS localStorage
   ═══════════════════════════════════════════════════════════ */
const LS = {
  users:   'kh_users',        // [{id, email, password, nama, role}]
  session: 'kh_session',      // {id}
  rooms:   'kh_rooms',        // [{...}]
  members: 'kh_members',      // [{room_id, user_id, role}]
  data:    rid => `kh_data_${rid}`,   // {workers, jobs, tarifs}
};

function lsRead(key, fallback){
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function lsWrite(key, val){ localStorage.setItem(key, JSON.stringify(val)); }

function lsRoomData(roomId){
  const d = lsRead(LS.data(roomId), null);
  if (d) return d;
  const init = { workers: [], jobs: [], tarifs: {} };
  lsWrite(LS.data(roomId), init);
  return init;
}

/* ═══════════════════════════════════════════════════════════
   AUTH
   ═══════════════════════════════════════════════════════════ */
export const auth = {
  async currentUser(){
    if (isOnline){
      const { data } = await sb.auth.getUser();
      if (!data.user) return null;
      return { id: data.user.id, email: data.user.email };
    }
    // local
    const sess = lsRead(LS.session, null);
    if (!sess) return null;
    const users = lsRead(LS.users, []);
    const u = users.find(x => x.id === sess.id);
    return u ? { id: u.id, email: u.email } : null;
  },

  async login(email, password){
    if (isOnline){
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return { id: data.user.id, email: data.user.email };
    }
    // local
    const users = lsRead(LS.users, []);
    const u = users.find(x => x.email.toLowerCase() === email.toLowerCase());
    if (!u) throw new Error('Email tidak terdaftar');
    if (u.password !== password) throw new Error('Password salah');
    lsWrite(LS.session, { id: u.id });
    return { id: u.id, email: u.email };
  },

  async signup(email, password, nama){
    if (isOnline){
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { nama } }
      });
      if (error) throw error;
      // Kalau email confirmation aktif, user mungkin belum login
      return { id: data.user?.id, email };
    }
    // local
    const users = lsRead(LS.users, []);
    if (users.some(x => x.email.toLowerCase() === email.toLowerCase()))
      throw new Error('Email sudah terdaftar');
    const isFirst = users.length === 0;
    const u = {
      id: 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6),
      email, password, nama: nama || email.split('@')[0],
      role: isFirst ? 'super_admin' : 'owner',
    };
    users.push(u); lsWrite(LS.users, users);
    lsWrite(LS.session, { id: u.id });
    return { id: u.id, email: u.email };
  },

  // Dipakai Super Admin untuk membuat akun pemilik room
  async createUserByAdmin(email, password, nama){
    if (isOnline){
      // Di Supabase, admin bikin user harus via service_role.
      // Untuk MVP, pakai signUp biasa (user bisa login setelah confirm email).
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { nama } }
      });
      if (error) throw error;
      // Kalau ada session (confirm email off), sign out supaya admin tetap login
      if (data.session) await sb.auth.signOut();
      return { id: data.user.id, email };
    }
    // local
    const users = lsRead(LS.users, []);
    if (users.some(x => x.email.toLowerCase() === email.toLowerCase()))
      throw new Error('Email sudah terdaftar');
    const u = {
      id: 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6),
      email, password, nama: nama || email.split('@')[0],
      role: 'owner',
    };
    users.push(u); lsWrite(LS.users, users);
    return { id: u.id, email: u.email };
  },

  async logout(){
    if (isOnline) await sb.auth.signOut();
    else localStorage.removeItem(LS.session);
  },
};

/* ═══════════════════════════════════════════════════════════
   DB
   ═══════════════════════════════════════════════════════════ */
export const DB = {

  /* ───── PROFILES ───── */
  async getProfile(userId){
    if (isOnline){
      const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
      if (!data) return null;
      return { id: data.id, nama: data.nama, role: data.role };
    }
    const users = lsRead(LS.users, []);
    const u = users.find(x => x.id === userId);
    return u ? { id: u.id, nama: u.nama, role: u.role } : null;
  },

  async updateProfile(userId, patch){
    if (isOnline){
      await sb.from('profiles').update(patch).eq('id', userId);
      return;
    }
    const users = lsRead(LS.users, []);
    const i = users.findIndex(x => x.id === userId);
    if (i >= 0){ users[i] = { ...users[i], ...patch }; lsWrite(LS.users, users); }
  },

  async listAllProfiles(){
    if (isOnline){
      const { data } = await sb.from('profiles').select('*');
      return (data || []).map(p => ({ id: p.id, nama: p.nama, role: p.role, email: p.email }));
    }
    return lsRead(LS.users, []).map(u => ({ id: u.id, nama: u.nama, role: u.role, email: u.email }));
  },

  async findUserByEmail(email){
    if (isOnline){
      const { data } = await sb.from('profiles').select('*').eq('email', email).maybeSingle();
      return data;
    }
    const users = lsRead(LS.users, []);
    const u = users.find(x => x.email.toLowerCase() === email.toLowerCase());
    return u ? { id: u.id, email: u.email, nama: u.nama } : null;
  },

  /* ───── ROOMS ───── */
  async listAllRooms(){
    if (isOnline){
      const { data } = await sb.from('rooms').select('*').order('created_at', { ascending:false });
      return data || [];
    }
    return lsRead(LS.rooms, []).sort((a,b) =>
      new Date(b.created_at) - new Date(a.created_at));
  },

  async listRoomsForUser(userId){
    if (isOnline){
      const { data: owned } = await sb.from('rooms').select('*').eq('pemilik_id', userId);
      const { data: members } = await sb.from('room_members').select('room_id').eq('user_id', userId);
      const memberIds = (members || []).map(m => m.room_id);
      let extra = [];
      if (memberIds.length){
        const { data } = await sb.from('rooms').select('*').in('id', memberIds);
        extra = data || [];
      }
      const map = new Map();
      [...(owned||[]), ...extra].forEach(r => map.set(r.id, r));
      return [...map.values()];
    }
    // local: room yang pemilik_id == userId, atau punya member entry
    const rooms = lsRead(LS.rooms, []);
    const members = lsRead(LS.members, []).filter(m => m.user_id === userId);
    const memberIds = new Set(members.map(m => m.room_id));
    return rooms.filter(r => r.pemilik_id === userId || memberIds.has(r.id));
  },

  async getRoom(id){
    if (isOnline){
      const { data } = await sb.from('rooms').select('*').eq('id', id).single();
      return data;
    }
    return lsRead(LS.rooms, []).find(r => r.id === id) || null;
  },

  async createRoom(payload){
    if (isOnline){
      const { data, error } = await sb.from('rooms').insert(payload).select().single();
      if (error) throw error;
      return data;
    }
    const rooms = lsRead(LS.rooms, []);
    const room = {
      id: 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6),
      ...payload,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    rooms.push(room); lsWrite(LS.rooms, rooms);
    return room;
  },

  async updateRoom(id, patch){
    if (isOnline){
      await sb.from('rooms').update(patch).eq('id', id);
      return;
    }
    const rooms = lsRead(LS.rooms, []);
    const i = rooms.findIndex(r => r.id === id);
    if (i >= 0){ rooms[i] = { ...rooms[i], ...patch, updated_at: new Date().toISOString() }; lsWrite(LS.rooms, rooms); }
  },

  async deleteRoom(id){
    if (isOnline){
      await sb.from('rooms').delete().eq('id', id);
      return;
    }
    const rooms = lsRead(LS.rooms, []).filter(r => r.id !== id);
    lsWrite(LS.rooms, rooms);
    localStorage.removeItem(LS.data(id));
    const members = lsRead(LS.members, []).filter(m => m.room_id !== id);
    lsWrite(LS.members, members);
  },

  /* ───── ROOM MEMBERS ───── */
  async addRoomMember(roomId, userId, role = 'operator'){
    if (isOnline){
      await sb.from('room_members').insert({ room_id: roomId, user_id: userId, role });
      return;
    }
    const members = lsRead(LS.members, []);
    if (!members.some(m => m.room_id === roomId && m.user_id === userId)){
      members.push({ room_id: roomId, user_id: userId, role });
      lsWrite(LS.members, members);
    }
  },

  /* ───── DATA PER ROOM ───── */
  async loadRoomData(roomId){
    if (isOnline){
      const [w, j, t] = await Promise.all([
        sb.from('workers').select('*').eq('room_id', roomId),
        sb.from('jobs').select('*').eq('room_id', roomId),
        sb.from('tarifs').select('*').eq('room_id', roomId),
      ]);
      const tarifs = {};
      (t.data || []).forEach(x => { tarifs[x.jenis] = { tarif: Number(x.tarif), satuan: x.satuan }; });
      return {
        workers: w.data || [],
        jobs: (j.data || []).map(row => ({
          ...row,
          tarif: Number(row.tarif),
          total_upah: Number(row.total_upah),
        })),
        tarifs,
      };
    }
    return lsRoomData(roomId);
  },

  async saveWorker(worker){
    if (isOnline){
      await sb.from('workers').upsert({
        id: worker.id, room_id: worker.room_id,
        nama: worker.nama, status: worker.status,
      });
      return;
    }
    const d = lsRoomData(worker.room_id);
    const i = d.workers.findIndex(x => x.id === worker.id);
    if (i >= 0) d.workers[i] = worker; else d.workers.push(worker);
    lsWrite(LS.data(worker.room_id), d);
  },

  async deleteWorker(id){
    // Cari room_id dari semua room (mahal, tapi cuma di local)
    if (isOnline){
      await sb.from('workers').delete().eq('id', id);
      return;
    }
    const rooms = lsRead(LS.rooms, []);
    for (const r of rooms){
      const d = lsRoomData(r.id);
      const i = d.workers.findIndex(x => x.id === id);
      if (i >= 0){
        d.workers.splice(i, 1);
        lsWrite(LS.data(r.id), d);
        return;
      }
    }
  },

  async saveJob(job){
    if (isOnline){
      await sb.from('jobs').upsert({
        id: job.id,
        room_id: job.room_id,
        worker_id: job.worker_id,
        barang: job.barang,
        jenis: job.jenis,
        jumlah_awal: job.jumlah_awal,
        jumlah_selesai: job.jumlah_selesai,
        tarif: job.tarif,
        satuan: job.satuan,
        total_upah: job.total_upah,
        status: job.status,
        created_at: job.created_at,
        selesai_at: job.selesai_at,
      });
      return;
    }
    const d = lsRoomData(job.room_id);
    const i = d.jobs.findIndex(x => x.id === job.id);
    if (i >= 0) d.jobs[i] = job; else d.jobs.push(job);
    lsWrite(LS.data(job.room_id), d);
  },

  async saveTarif(roomId, jenis, tarif, satuan){
    if (isOnline){
      await sb.from('tarifs').upsert({
        room_id: roomId, jenis, tarif, satuan,
        updated_at: new Date().toISOString(),
      });
      return;
    }
    const d = lsRoomData(roomId);
    d.tarifs[jenis] = { tarif, satuan };
    lsWrite(LS.data(roomId), d);
  },
};

/* ═══════════════════════════════════════════════════════════
   EKSPOR / IMPOR (untuk migrasi data lama jait.html)
   ═══════════════════════════════════════════════════════════ */
export const Migrasi = {

  // Ambil data dari localStorage KONVEKSI HUD lama (jait.html)
  bacaDataLama(){
    try {
      return {
        workers: JSON.parse(localStorage.getItem('kh_workers') || '[]'),
        jobs:    JSON.parse(localStorage.getItem('kh_jobs')    || '[]'),
        tarifs:  JSON.parse(localStorage.getItem('kh_tarif')   || '{}'),
      };
    } catch { return null; }
  },

  // Impor ke room aktif. Return report.
  async imporKeRoom(roomId, dataLama){
    const report = { workers: 0, jobs: 0, tarifs: 0, errors: [] };
    if (!dataLama) { report.errors.push('Tidak ada data lama'); return report; }

    // Tarif
    for (const [jenis, t] of Object.entries(dataLama.tarifs || {})){
      try { await DB.saveTarif(roomId, jenis, t.tarif, t.satuan); report.tarifs++; }
      catch (e) { report.errors.push('tarif ' + jenis + ': ' + e.message); }
    }

    // Pekerja + map id lama → id baru
    const idMap = {};
    for (const w of (dataLama.workers || [])){
      try {
        const newId = 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
        const nw = { id: newId, room_id: roomId, nama: w.nama, status: w.status || 'aktif', created_at: w.createdAt || nowISO() };
        await DB.saveWorker(nw);
        idMap[w.id] = newId;
        report.workers++;
      } catch (e) { report.errors.push('worker ' + w.nama + ': ' + e.message); }
    }

    // Jobs
    for (const j of (dataLama.jobs || [])){
      try {
        const newWorkerId = idMap[j.workerId];
        if (!newWorkerId){ report.errors.push('job ' + j.id + ': pekerja tidak termigrasi'); continue; }
        const nj = {
          id: 'j_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6),
          room_id: roomId,
          worker_id: newWorkerId,
          barang: j.barang,
          jenis: j.jenis,
          jumlah_awal: j.jumlahAwal,
          jumlah_selesai: j.jumlahSelesai,
          tarif: j.tarif,
          satuan: j.satuan,
          total_upah: j.totalUpah || 0,
          status: j.status,
          created_at: j.createdAt || nowISO(),
          selesai_at: j.selesaiAt || null,
        };
        await DB.saveJob(nj);
        report.jobs++;
      } catch (e) { report.errors.push('job ' + j.id + ': ' + e.message); }
    }
    return report;
  },

  // Backup seluruh data room ke JSON (unduh)
  backupRoom(data){
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'konveksi-hud-backup-' + new Date().toISOString().slice(0,10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  },
};

function nowISO(){ return new Date().toISOString(); }