/* Học AI mỗi ngày — giao diện chạy trên GitHub Pages, gọi API Google Apps Script. */
'use strict';

const CFG = window.APP_CONFIG || {};
const TOKEN_KEY = 'aimaster_session';

let token = '', user = null, videos = [], current = null;
let player = null, playerReady = false, watchTimer = null, lastServerPosition = 0, lastSaved = 0;
let quizQuestions = [], adminData = null, passScore = 70;

/* ---------------- API ---------------- */

function apiConfigured() {
  return CFG.API_URL && /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/.test(CFG.API_URL) && CFG.API_URL.indexOf('DAN_URL') < 0;
}

/** Gọi hàm trong Code.gs. Dùng text/plain để không phát sinh CORS preflight. */
async function api(action, ...args) {
  if (!apiConfigured()) throw new Error('Chưa cấu hình API_URL trong config.js.');
  let res;
  try {
    res = await fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, args }),
      redirect: 'follow',
      keepalive: action === 'recordWatch'
    });
  } catch (e) {
    throw new Error('Không kết nối được máy chủ. Kiểm tra mạng hoặc URL Web App.');
  }
  let json;
  try { json = await res.json(); }
  catch (e) { throw new Error('Máy chủ trả về dữ liệu không hợp lệ. Kiểm tra quyền truy cập Web App ("Anyone").'); }
  if (!json.ok) {
    const err = new Error(json.error || 'Lỗi không xác định.');
    err.code = json.code || '';
    if (err.code === 'SESSION' && action !== 'getBootstrap') { toast(err.message, true); signOut(true); }
    throw err;
  }
  return json.data;
}

/* ---------------- KHỞI ĐỘNG ---------------- */

window.addEventListener('DOMContentLoaded', async () => {
  if (CFG.TEACHER_IMAGE_URL) {
    ['teacherPhoto', 'teacherThumb'].forEach(id => { const im = $(id); im.src = CFG.TEACHER_IMAGE_URL; im.classList.remove('hidden'); });
    $('photoPlaceholder').classList.add('hidden');
  }
  const mail = CFG.CONTACT_EMAIL || '';
  $('contactLink').href = mail ? 'mailto:' + mail : '#';
  $('contactLink').textContent = '✉ ' + mail;
  if (!apiConfigured()) { $('apiWarn').classList.remove('hidden'); return; }

  const saved = sessionStorage.getItem(TOKEN_KEY);
  if (saved) {
    msg('loginMsg', 'Đang khôi phục phiên đăng nhập...');
    try { onBootstrap(await api('getBootstrap', saved)); }
    catch (e) { sessionStorage.removeItem(TOKEN_KEY); msg('loginMsg', ''); }
  }
});

async function loginByPhone() {
  const phone = String(val('phoneLogin') || '').replace(/[^0-9]/g, '');
  if (!/^0[0-9]{9}$/.test(phone)) { msg('loginMsg', 'Vui lòng nhập số điện thoại gồm 10 chữ số.'); return; }
  const pass = val('adminPass');
  msg('loginMsg', 'Đang kiểm tra số điện thoại...');
  busy('loginBtn', true);
  try {
    onBootstrap(await api('loginWithPhone', phone, pass));
    setv('adminPass', '');
  } catch (e) {
    if (e.code === 'ADMIN_PASSWORD_REQUIRED') { $('adminPass').classList.remove('hidden'); $('adminPass').focus(); }
    msg('loginMsg', e.message);
  } finally { busy('loginBtn', false); }
}

function onBootstrap(d) {
  token = d.sessionToken || token;
  sessionStorage.setItem(TOKEN_KEY, token);
  user = d.user; videos = d.videos || []; passScore = d.passScore || 70;
  $('userPill').innerHTML = esc(user.name || user.phone) + '　' + (user.role === 'admin' ? '<b class="gold">Quản trị viên</b>' : '') + ' <button class="outline" onclick="signOut()">Đăng xuất</button>';
  msg('loginMsg', 'Đã đăng nhập bằng số điện thoại: ' + user.phone);
  $('loginArea').classList.add('hidden');
  $('course').classList.remove('hidden');
  $('adminNav').classList.toggle('hidden', user.role !== 'admin');
  $('exportNav').classList.toggle('hidden', user.role !== 'admin');
  renderAll();
}

async function refreshApp() {
  try { const d = await api('getBootstrap', token); videos = d.videos || []; renderAll(); }
  catch (e) { toast(e.message, true); }
}

/* ---------------- LỘ TRÌNH ---------------- */

function isFree() { return user && (user.role === 'admin' || (current && current.status === 'completed')); }

function renderAll() {
  renderLessons(); updateStats();
  if (!current) { const first = videos.find(v => v.status !== 'completed') || videos[0]; if (first) selectVideo(first.videoId); }
  else { const v = videos.find(x => x.videoId === current.videoId); if (v) { current = v; renderIntro(); } }
}

function renderLessons() {
  const el = $('lessonList'); el.innerHTML = '';
  const search = (val('searchLessons') || '').toLowerCase();
  let last = '';
  videos.filter(v => (v.title + ' ' + v.topic).toLowerCase().includes(search)).forEach(v => {
    if (v.topic !== last) { const t = document.createElement('div'); t.className = 'topic'; t.textContent = v.topic || 'BÀI HỌC'; el.appendChild(t); last = v.topic; }
    const b = document.createElement('button');
    b.className = 'lesson' + (current && current.videoId === v.videoId ? ' selected' : '');
    b.onclick = () => selectVideo(v.videoId);
    const check = document.createElement('span'); check.className = 'check'; check.textContent = v.status === 'completed' ? '✓' : '▶';
    const body = document.createElement('span'); body.className = 'lessonbody';
    const sm = document.createElement('small'); sm.textContent = 'Bài ' + v.sortOrder + (v.bestScore ? ' · Điểm cao nhất ' + v.bestScore : '');
    const strong = document.createElement('strong'); strong.textContent = v.title;
    const em = document.createElement('em');
    em.textContent = v.status === 'completed' ? '✓ Đã hoàn thành · Cho phép tua' : user && user.role === 'admin' ? 'Quản trị viên · Tua tự do' : '◉ Chưa hoàn thành · Đã xem ' + Math.round((v.watchRatio || 0) * 100) + '%';
    body.append(sm, strong, em); b.append(check, body); el.appendChild(b);
  });
  $('courseStats').textContent = videos.length + ' bài học';
  $('lessonCounts').textContent = 'Tất cả (' + videos.length + ')';
  $('completedCount').textContent = videos.filter(v => v.status === 'completed').length + ' đã xong';
}

function updateStats() {
  const done = videos.filter(v => v.status === 'completed').length;
  const ratio = videos.length ? Math.round(done / videos.length * 100) : 0;
  $('sideProgress').textContent = ratio + '%';
  $('heroProgress').textContent = ratio + '%';
  $('heroLessons').textContent = done + '/' + videos.length + ' bài đã xong';
  $('heroXP').textContent = done * 100;
}

function selectVideo(id) {
  const v = videos.find(x => x.videoId === id); if (!v) return;
  saveProgress('SWITCH_VIDEO');
  current = v; lastServerPosition = Number(v.lastPosition || 0);
  renderLessons(); renderIntro();
  $('quizArea').classList.add('hidden');
  loadPlayer();
}

function renderIntro() {
  if (!current) return;
  $('lessonIntro').innerHTML = '<div class="flex"><span class="eyebrow">' + esc(current.topic || 'LỘ TRÌNH HỌC TẬP') + '</span><span class="tag">Mã bài: ' + esc(current.videoId) + '</span><span class="tag ' + (current.status === 'completed' ? 'green' : '') + '">' + (current.status === 'completed' ? '✓ Đã hoàn thành' : 'Đang học') + '</span></div><h2>' + esc(current.title) + '</h2><p>' + esc(current.description || 'Học video theo tiến độ, hoàn thành bài kiểm tra để lưu thành tích và theo dõi lịch sử học tập.') + '</p>';
  $('watchCard').classList.remove('hidden');
  $('watchStatus').textContent = current.status === 'completed' ? '♧ Đã hoàn thành · Cho phép tua & xem lại tự do' : user.role === 'admin' ? '♧ Quản trị viên · Không giới hạn tua' : '♧ Chưa hoàn thành · Chỉ tua đến đoạn đã xem';
  $('watchMessage').textContent = 'Xem tối thiểu 90% video, sau đó làm bài kiểm tra (đạt từ ' + passScore + ' điểm) để hoàn thành bài.';
}

/* ---------------- VIDEO ---------------- */

function loadPlayer() {
  if (watchTimer) clearInterval(watchTimer);
  if (player && player.destroy) { try { player.destroy(); } catch (e) {} }
  player = null; playerReady = false;
  const wrap = $('playerWrap');
  wrap.innerHTML = '<div id="player"></div>';
  if (!current.youtubeId) { wrap.innerHTML = '<div class="empty">Quản trị viên chưa nhập link YouTube cho bài này.</div>'; return; }
  if (!window.YT || !YT.Player) { setTimeout(loadPlayer, 400); return; }
  player = new YT.Player('player', {
    videoId: current.youtubeId,
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 1, disablekb: 1, origin: location.origin },
    events: { onReady: onPlayerReady, onStateChange: onPlayerState }
  });
}

function onPlayerReady() {
  playerReady = true;
  const p = Number(current.lastPosition || 0);
  if (p > 0) player.seekTo(isFree() ? p : Math.max(0, p - 1), true);
  watchTimer = setInterval(tick, 1000);
}

function onPlayerState(ev) {
  if (ev.data === YT.PlayerState.PAUSED) saveProgress('PAUSE');
  if (ev.data === YT.PlayerState.ENDED) {
    saveProgress('ENDED');
    if (current.status !== 'completed') setTimeout(loadQuiz, 800);
  }
}

function tick() {
  if (!playerReady || !player || !current) return;
  try {
    const pos = player.getCurrentTime() || 0, dur = player.getDuration() || 0;
    if (!dur) return;
    if (!isFree() && pos > lastServerPosition + 3) { player.seekTo(Math.max(0, lastServerPosition), true); toast('Bài chưa hoàn thành — không thể tua vượt đoạn chưa xem.'); return; }
    if (pos > lastServerPosition) lastServerPosition = pos;
    $('watchBar').style.width = Math.min(100, pos / dur * 100) + '%';
    $('watchTime').textContent = fmt(pos) + ' / ' + fmt(dur);
    if (Date.now() - lastSaved > 10000) saveProgress('WATCH_PROGRESS');
  } catch (e) {}
}

function saveProgress(eventType) {
  if (!playerReady || !player || !current || !token) return;
  let pos, dur;
  try { pos = player.getCurrentTime() || 0; dur = player.getDuration() || 0; } catch (e) { return; }
  if (!dur) return;
  lastSaved = Date.now();
  const v = current;
  api('recordWatch', token, v.videoId, pos, dur, eventType).then(r => {
    if (r && r.progress) {
      v.lastPosition = r.progress.lastPosition; v.duration = dur; v.watchRatio = r.progress.watchRatio;
      if (v === current && !isFree()) lastServerPosition = Math.max(lastServerPosition, Number(r.progress.lastPosition || 0));
    }
  }).catch(() => {});
}

window.addEventListener('beforeunload', () => saveProgress('LEAVE'));

function nextVideo() {
  const i = videos.findIndex(v => v.videoId === current.videoId);
  if (i < videos.length - 1) selectVideo(videos[i + 1].videoId); else toast('Đây là bài cuối cùng của lộ trình.');
}

/* ---------------- BÀI KIỂM TRA ---------------- */

async function loadQuiz() {
  if (!current) return;
  const el = $('quizArea');
  el.classList.remove('hidden');
  el.innerHTML = '<p class="muted">Đang tải câu hỏi...</p>';
  try {
    const qs = await api('getQuiz', token, current.videoId);
    quizQuestions = qs || [];
    el.innerHTML = '<h3>Kiểm tra nhanh sau bài học</h3>';
    if (!quizQuestions.length) { el.innerHTML += '<p class="muted">Bài này chưa có câu hỏi. Hãy liên hệ quản trị viên.</p>'; return; }
    quizQuestions.forEach((q, i) => {
      const box = document.createElement('div'); box.className = 'question'; box.id = 'q_' + q.quizId;
      const p = document.createElement('strong'); p.textContent = (i + 1) + '. ' + q.question; box.appendChild(p);
      ['A', 'B', 'C', 'D'].forEach((letter, j) => {
        if (!q.options[j]) return;
        const l = document.createElement('label');
        const inp = document.createElement('input'); inp.type = 'radio'; inp.name = q.quizId; inp.value = letter;
        const span = document.createElement('span'); span.textContent = letter + '. ' + q.options[j];
        l.append(inp, span); box.appendChild(l);
      });
      el.appendChild(box);
    });
    const btn = document.createElement('button'); btn.id = 'submitQuizBtn'; btn.textContent = 'Nộp bài kiểm tra'; btn.onclick = submitQuiz;
    el.appendChild(btn);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { el.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; }
}

async function submitQuiz() {
  const answers = {};
  for (const q of quizQuestions) {
    const x = document.querySelector('input[name="' + CSS.escape(q.quizId) + '"]:checked');
    if (!x) { toast('Vui lòng trả lời tất cả câu hỏi.', true); return; }
    answers[q.quizId] = x.value;
  }
  let ratio = Number(current.watchRatio || 0);
  try { if (playerReady && player) ratio = Math.max(ratio, player.getCurrentTime() / Math.max(player.getDuration(), 1)); } catch (e) {}
  busy('submitQuizBtn', true);
  try {
    const r = await api('submitQuiz', token, current.videoId, answers, ratio);
    const el = $('quizArea');
    (r.review || []).forEach(rv => {
      const box = $('q_' + rv.quizId); if (!box) return;
      box.classList.add(rv.chosen === rv.correct ? 'ok' : 'bad');
      box.querySelectorAll('input').forEach(i => i.disabled = true);
      const ex = document.createElement('div'); ex.className = 'exp';
      ex.textContent = (rv.chosen === rv.correct ? '✓ Đúng. ' : '✗ Đáp án đúng: ' + rv.correct + '. ') + (rv.explanation || '');
      box.appendChild(ex);
    });
    const s = document.createElement('div');
    s.className = 'scoreBox ' + (r.passed ? 'pass' : 'fail');
    s.textContent = 'Điểm: ' + r.score + '/100 (' + r.correct + '/' + r.total + ' câu đúng). ' + (r.passed ? '🎉 Đã hoàn thành bài học!' : 'Chưa đạt ' + r.passScore + ' điểm — hãy ôn tập và thử lại.');
    el.insertBefore(s, el.children[1] || null);
    $('submitQuizBtn').remove();
    const again = document.createElement('button'); again.className = 'secondary'; again.textContent = r.passed ? 'Bài tiếp theo ›' : 'Làm lại bài kiểm tra';
    again.onclick = r.passed ? nextVideo : loadQuiz; el.appendChild(again);
    videos = r.videos || videos; renderAll();
    s.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) { toast(e.message, true); busy('submitQuizBtn', false); }
}

/* ---------------- BẢNG XẾP HẠNG / LỊCH SỬ ---------------- */

async function showLeaderboard() {
  if (!token) { scrollLogin(); return; }
  try {
    const rows = await api('getLeaderboard', token);
    showDash('Bảng Xếp Hạng Học Tập', rows.map(r => ({ 'Hạng': r.rank, 'Học viên': r.name, 'Đơn vị': r.unit, 'Bài hoàn thành': r.completed, 'Điểm trung bình': r.averageScore, 'XP': r.points })));
  } catch (e) { toast(e.message, true); }
}

async function showHistory() {
  if (!token) { scrollLogin(); return; }
  try {
    const d = await api('getMyHistory', token);
    const title = id => { const v = videos.find(x => x.videoId === String(id)); return v ? v.title : id; };
    showDash('Lịch Sử Học Tập', (d.history || []).map(r => ({ 'Thời gian': fmtDate(r.createdAt), 'Bài học': title(r.videoId), 'Sự kiện': eventName(r.eventType), 'Vị trí': fmt(r.position), 'Điểm': r.score, 'Chi tiết': r.details })));
  } catch (e) { toast(e.message, true); }
}

function eventName(t) {
  return ({ WATCH_PROGRESS: 'Xem video', PAUSE: 'Tạm dừng', ENDED: 'Xem hết video', LEAVE: 'Rời trang', SWITCH_VIDEO: 'Chuyển bài', QUIZ_SUBMITTED: 'Nộp bài kiểm tra' })[t] || t;
}

function showDash(title, rows) {
  hideSections(); $('dashboard').classList.remove('hidden');
  $('dashboardTitle').textContent = title;
  renderTable('dashboardBody', rows);
  $('dashboard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------------- QUẢN TRỊ ---------------- */

async function showAdmin(tab) {
  if (!user || user.role !== 'admin') return;
  hideSections(); $('admin').classList.remove('hidden');
  $('adminContent').innerHTML = '<div class="empty">Đang tải dữ liệu quản trị...</div>';
  try { adminData = await api('adminList', token); adminTab(tab || 'videos'); }
  catch (e) { $('adminContent').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}

function adminTab(tab) {
  if (!adminData) return;
  document.querySelectorAll('#adminTabs button').forEach(b => b.classList.toggle('secondary', b.dataset.tab !== tab));
  const el = $('adminContent');
  el.classList.remove('adminTable');
  if (tab === 'videos') renderAdminVideos(el);
  else if (tab === 'quizzes') renderAdminQuizzes(el);
  else if (tab === 'students') renderAdminStudents(el);
  else renderTable(el, (adminData.history || []).map(h => ({ 'Thời gian': fmtDate(h.createdAt), 'Học viên': h.email, 'Mã bài': h.videoId, 'Sự kiện': eventName(h.eventType), 'Vị trí': fmt(h.position), 'Điểm': h.score, 'Chi tiết': h.details })));
}

function renderAdminVideos(el) {
  el.innerHTML = '<div class="adminGrid"><div class="adminBox"><h3>Thêm / chỉnh sửa bài học</h3>' +
    '<label class="label">Mã bài (để trống khi thêm mới)</label><input id="vId">' +
    '<label class="label">Tên bài học</label><input id="vTitle">' +
    '<label class="label">Chủ đề</label><input id="vTopic">' +
    '<label class="label">Link YouTube</label><input id="vUrl" placeholder="https://www.youtube.com/watch?v=...">' +
    '<label class="label">Mô tả</label><textarea id="vDesc" rows="2"></textarea>' +
    '<label class="label">Thứ tự hiển thị</label><input id="vOrder" type="number" value="' + (adminData.videos.length + 1) + '">' +
    '<label><input id="vActive" type="checkbox" checked style="width:auto"> Hiển thị bài học</label><br>' +
    '<button id="saveVideoBtn" onclick="saveVideo()">Lưu bài học</button> <button class="secondary" onclick="clearVideoForm()">Làm mới</button></div>' +
    '<div class="adminBox"><h3>Danh sách bài học (' + adminData.videos.length + ')</h3><div id="videoAdminList" style="max-height:640px;overflow:auto"></div></div></div>';
  const list = $('videoAdminList');
  const qCount = {}; (adminData.quizzes || []).forEach(q => qCount[q.videoId] = (qCount[q.videoId] || 0) + 1);
  adminData.videos.slice().sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder)).forEach(v => {
    const row = document.createElement('div'); row.className = 'question';
    row.innerHTML = '<b>' + esc(v.title) + '</b><p class="muted">' + esc(v.videoId) + ' · ' + esc(v.topic) + ' · Thứ tự ' + esc(v.sortOrder) + ' · ' + (qCount[v.videoId] || 0) + ' câu hỏi' + (String(v.active) === 'false' ? ' · <span class="gold">Đang ẩn</span>' : '') + '</p>';
    const act = document.createElement('div'); act.className = 'rowActions';
    act.append(
      btn('Sửa', () => { setv('vId', v.videoId); setv('vTitle', v.title); setv('vTopic', v.topic); setv('vUrl', v.youtubeId); setv('vDesc', v.description); setv('vOrder', v.sortOrder); $('vActive').checked = String(v.active) !== 'false'; $('vTitle').focus(); }),
      btn('Câu hỏi', () => { adminTab('quizzes'); setv('qVideoFilter', v.videoId); renderQuizList(); }),
      btn('Xóa', async () => { if (!confirm('Xóa bài học "' + v.title + '"?')) return; try { await api('adminDeleteVideo', token, v.videoId); toast('Đã xóa bài học.'); showAdmin('videos'); refreshApp(); } catch (e) { toast(e.message, true); } })
    );
    row.appendChild(act); list.appendChild(row);
  });
}

async function saveVideo() {
  const v = { videoId: val('vId'), title: val('vTitle'), topic: val('vTopic'), youtubeId: val('vUrl'), description: val('vDesc'), sortOrder: Number(val('vOrder') || 1), active: $('vActive').checked, quizRequired: true };
  busy('saveVideoBtn', true);
  try { await api('adminSaveVideo', token, v); toast('Đã lưu bài học.'); refreshApp(); showAdmin('videos'); }
  catch (e) { toast(e.message, true); busy('saveVideoBtn', false); }
}
function clearVideoForm() { ['vId', 'vTitle', 'vTopic', 'vUrl', 'vDesc'].forEach(id => setv(id, '')); setv('vOrder', adminData.videos.length + 1); }

function renderAdminQuizzes(el) {
  const opts = adminData.videos.slice().sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder)).map(v => '<option value="' + esc(v.videoId) + '">' + esc(v.videoId + ' · ' + v.title) + '</option>').join('');
  el.innerHTML = '<div class="adminGrid"><div class="adminBox"><h3>Thêm / chỉnh sửa câu hỏi</h3>' +
    '<label class="label">Mã câu hỏi (để trống khi thêm mới)</label><input id="qId">' +
    '<label class="label">Bài học</label><select id="qVideo">' + opts + '</select>' +
    '<label class="label">Câu hỏi</label><textarea id="qText" rows="2"></textarea>' +
    ['A', 'B', 'C', 'D'].map(l => '<label class="label">Phương án ' + l + '</label><input id="qOpt' + l + '">').join('') +
    '<label class="label">Đáp án đúng</label><select id="qCorrect"><option>A</option><option>B</option><option>C</option><option>D</option></select>' +
    '<label class="label">Giải thích</label><textarea id="qExp" rows="2"></textarea>' +
    '<label class="label">Thứ tự</label><input id="qOrder" type="number" value="1">' +
    '<label><input id="qActive" type="checkbox" checked style="width:auto"> Sử dụng câu hỏi</label><br>' +
    '<button id="saveQuizBtn" onclick="saveQuiz()">Lưu câu hỏi</button> <button class="secondary" onclick="clearQuizForm()">Làm mới</button></div>' +
    '<div class="adminBox"><h3>Danh sách câu hỏi</h3><select id="qVideoFilter" onchange="renderQuizList()"><option value="">— Tất cả bài học —</option>' + opts + '</select><div id="quizAdminList" style="max-height:640px;overflow:auto"></div></div></div>';
  renderQuizList();
}

function renderQuizList() {
  const f = val('qVideoFilter'), list = $('quizAdminList'); if (!list) return;
  list.innerHTML = '';
  const qs = (adminData.quizzes || []).filter(q => !f || String(q.videoId) === f).sort((a, b) => String(a.videoId).localeCompare(String(b.videoId)) || Number(a.sortOrder) - Number(b.sortOrder));
  if (!qs.length) { list.innerHTML = '<div class="empty">Chưa có câu hỏi.</div>'; return; }
  if (f) setv('qVideo', f);
  qs.forEach(q => {
    const row = document.createElement('div'); row.className = 'question';
    row.innerHTML = '<b>' + esc(q.question) + '</b><p class="muted">' + esc(q.quizId) + ' · ' + esc(q.videoId) + ' · Đáp án ' + esc(q.correctOption) + (String(q.active) === 'false' ? ' · <span class="gold">Tắt</span>' : '') + '</p>';
    const act = document.createElement('div'); act.className = 'rowActions';
    act.append(
      btn('Sửa', () => { setv('qId', q.quizId); setv('qVideo', q.videoId); setv('qText', q.question); setv('qOptA', q.optionA); setv('qOptB', q.optionB); setv('qOptC', q.optionC); setv('qOptD', q.optionD); setv('qCorrect', String(q.correctOption || 'A').toUpperCase()); setv('qExp', q.explanation); setv('qOrder', q.sortOrder); $('qActive').checked = String(q.active) !== 'false'; $('qText').focus(); }),
      btn('Xóa', async () => { if (!confirm('Xóa câu hỏi này?')) return; try { await api('adminDeleteQuiz', token, q.quizId); toast('Đã xóa câu hỏi.'); await reloadAdmin('quizzes', f); } catch (e) { toast(e.message, true); } })
    );
    row.appendChild(act); list.appendChild(row);
  });
}

async function saveQuiz() {
  const q = { quizId: val('qId'), videoId: val('qVideo'), question: val('qText'), optionA: val('qOptA'), optionB: val('qOptB'), optionC: val('qOptC'), optionD: val('qOptD'), correctOption: val('qCorrect'), explanation: val('qExp'), sortOrder: Number(val('qOrder') || 1), active: $('qActive').checked };
  busy('saveQuizBtn', true);
  try { await api('adminSaveQuiz', token, q); toast('Đã lưu câu hỏi.'); await reloadAdmin('quizzes', q.videoId); }
  catch (e) { toast(e.message, true); busy('saveQuizBtn', false); }
}
function clearQuizForm() { ['qId', 'qText', 'qOptA', 'qOptB', 'qOptC', 'qOptD', 'qExp'].forEach(id => setv(id, '')); setv('qOrder', 1); }

async function reloadAdmin(tab, filter) {
  adminData = await api('adminList', token);
  adminTab(tab);
  if (filter !== undefined) { setv('qVideoFilter', filter); renderQuizList(); }
}

function renderAdminStudents(el) {
  el.innerHTML = '<div class="adminGrid"><div class="adminBox"><h3>Thêm học viên</h3>' +
    '<label class="label">Số điện thoại</label><input id="sPhone" type="tel" maxlength="12">' +
    '<label class="label">Họ tên</label><input id="sName">' +
    '<label class="label">Đơn vị</label><input id="sUnit">' +
    '<button id="saveStudentBtn" onclick="saveStudent()">Lưu học viên</button></div>' +
    '<div class="adminBox"><h3>Thống kê</h3><p class="muted">Tổng học viên: <b>' + adminData.students.length + '</b></p><p class="muted">Đang hoạt động: <b>' + adminData.students.filter(s => String(s.active) !== 'false').length + '</b></p></div></div><div id="studentTable"></div>';
  const rows = adminData.students.map(s => ({
    'Họ tên': s.fullName, 'Số điện thoại': s.phone, 'Đơn vị': s.unit, 'Đăng ký': fmtDate(s.createdAt), 'Lần truy cập': fmtDate(s.lastSeenAt),
    'Thời gian học': fmtDuration(s.totalStudySeconds), 'Trạng thái': String(s.active) === 'false' ? 'Đã khóa' : 'Hoạt động', _s: s
  }));
  renderTable('studentTable', rows, r => {
    if (r._s.role === 'admin') return null;
    const locked = String(r._s.active) === 'false';
    return btn(locked ? 'Mở khóa' : 'Khóa', async () => {
      try { await api('adminSetStudentActive', token, r._s.email, locked); toast(locked ? 'Đã mở khóa.' : 'Đã khóa học viên.'); reloadAdmin('students'); } catch (e) { toast(e.message, true); }
    });
  });
}

async function saveStudent() {
  busy('saveStudentBtn', true);
  try { const r = await api('adminSaveStudent', token, { phone: val('sPhone'), fullName: val('sName'), unit: val('sUnit') }); toast(r.created ? 'Đã thêm học viên.' : 'Đã cập nhật học viên.'); reloadAdmin('students'); }
  catch (e) { toast(e.message, true); busy('saveStudentBtn', false); }
}

async function exportData() {
  if (!user || user.role !== 'admin') return;
  try {
    const d = adminData || await api('adminList', token);
    const rows = d.students || [];
    const csv = [['Họ tên', 'Số điện thoại', 'Email', 'Đơn vị', 'Thời gian đăng ký', 'Lần truy cập', 'Tổng thời gian học (giây)', 'Trạng thái'],
      ...rows.map(s => [s.fullName, s.phone, s.email, s.unit, fmtDate(s.createdAt), fmtDate(s.lastSeenAt), s.totalStudySeconds, String(s.active) === 'false' ? 'Đã khóa' : 'Hoạt động'])]
      .map(r => r.map(x => '"' + String(x ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = 'hoc-vien-ai-master-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) { toast(e.message, true); }
}

/* ---------------- TIỆN ÍCH ---------------- */

function renderTable(target, rows, actionFn) {
  const el = typeof target === 'string' ? $(target) : target;
  if (!rows || !rows.length) { el.innerHTML = '<div class="empty">Chưa có dữ liệu.</div>'; return; }
  const keys = Object.keys(rows[0]).filter(k => k[0] !== '_');
  const t = document.createElement('table'), thead = document.createElement('thead'), tr = document.createElement('tr');
  keys.concat(actionFn ? [''] : []).forEach(k => { const th = document.createElement('th'); th.textContent = k; tr.appendChild(th); });
  thead.appendChild(tr); t.appendChild(thead);
  const tb = document.createElement('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    keys.forEach(k => { const td = document.createElement('td'); td.textContent = String(r[k] ?? ''); tr.appendChild(td); });
    if (actionFn) { const td = document.createElement('td'); const b = actionFn(r); if (b) td.appendChild(b); tr.appendChild(td); }
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  el.innerHTML = ''; el.classList.add('adminTable'); el.appendChild(t);
}

function btn(text, onClick) { const b = document.createElement('button'); b.className = 'secondary small'; b.textContent = text; b.onclick = onClick; return b; }
function hideSections() { document.querySelectorAll('main>section').forEach(x => { if (x.id !== 'home') x.classList.add('hidden'); }); }
function go(id) {
  if (id === 'course' && !token) { scrollLogin(); return; }
  document.querySelectorAll('main>section').forEach(x => { if (x.id !== 'home') x.classList.toggle('hidden', x.id !== id); });
  $(id).scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function scrollLogin() { $('home').scrollIntoView({ behavior: 'smooth' }); const i = $('phoneLogin'); if (i) i.focus(); }
function signOut(silent) {
  saveProgress('LEAVE');
  const t = token;
  sessionStorage.removeItem(TOKEN_KEY);
  token = ''; user = null; current = null; videos = [];
  if (watchTimer) clearInterval(watchTimer);
  if (t && !silent) api('logout', t).catch(() => {}).finally(() => location.reload());
  else location.reload();
}
function toast(text, isErr) {
  const d = document.createElement('div'); d.className = 'toast' + (isErr ? ' err' : ''); d.textContent = text;
  document.querySelectorAll('.toast').forEach(x => x.remove());
  document.body.appendChild(d); setTimeout(() => d.remove(), 4000);
}
function busy(id, on) { const e = $(id); if (e) { e.disabled = on; e.classList.toggle('loading', on); } }
function $(id) { return document.getElementById(id); }
function val(id) { const e = $(id); return e ? e.value : ''; }
function setv(id, v) { const e = $(id); if (e) e.value = v ?? ''; }
function msg(id, t) { $(id).textContent = t; }
function fmt(n) { n = Math.floor(Number(n) || 0); return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); }
function fmtDuration(s) { s = Math.round(Number(s) || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + ' giờ ' + m + ' phút' : m + ' phút'; }
function fmtDate(v) { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString('vi-VN'); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
