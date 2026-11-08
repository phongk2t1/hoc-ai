/* Học AI cùng thầy giáo Nguyễn Phong — giao diện GitHub Pages gọi API Google Apps Script. */
'use strict';

const CFG = window.APP_CONFIG || {};
const LS_TOKEN = 'hocai_token';
const LS_PHONE = 'study_user_phone';

let token = '', currentUser = null, videoList = [], currentVideo = null;
let player = null, isPlayerReady = false, pendingVideo = null;
let maxTimeViewed = 0, checkInterval = null, heartbeatInterval = null;
let currentExam = null, isSidebarCollapsed = false, adminCache = null;

/* ================= API ================= */

function apiConfigured() {
  return /^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[^/]+\/exec/.test(CFG.API_URL || '') && CFG.API_URL.indexOf('DAN_URL') < 0;
}

async function api(action, ...args) {
  if (!apiConfigured()) throw new Error('Chưa cấu hình API_URL trong config.js.');
  let res;
  try {
    res = await fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, args }),
      redirect: 'follow',
      keepalive: action === 'saveProgress'
    });
  } catch (e) { throw new Error('Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.'); }
  let json;
  try { json = await res.json(); } catch (e) { throw new Error('Máy chủ phản hồi không hợp lệ. Kiểm tra quyền truy cập Web App ("Anyone").'); }
  if (!json.ok) {
    const err = new Error(json.error || 'Lỗi không xác định.');
    err.code = json.code || '';
    if (err.code === 'SESSION' && token) onSessionExpired();
    throw err;
  }
  return json.data;
}

/* ================= KHỞI ĐỘNG ================= */

window.addEventListener('DOMContentLoaded', async () => {
  const img = $('teacherImg');
  img.onerror = () => { img.onerror = null; img.src = 'https://ui-avatars.com/api/?name=Nguyen+Phong&background=0D8ABC&color=fff&size=128'; };
  img.src = CFG.TEACHER_IMAGE_URL || 'https://ui-avatars.com/api/?name=Nguyen+Phong&background=0D8ABC&color=fff&size=128';
  if (CFG.CONTACT_EMAIL) { $('contactLink').href = 'mailto:' + CFG.CONTACT_EMAIL; $('contactLink').textContent = '✉ ' + CFG.CONTACT_EMAIL; }
  $('authModal').addEventListener('shown.bs.modal', () => {
    const el = ['inputAdminPin', 'regName', 'inputPhone'].map($).find(e => e.closest('form').style.display !== 'none');
    if (el) el.focus();
  });

  if (!apiConfigured()) { $('apiWarn').classList.remove('d-none'); $('videoList').innerHTML = '<div class="p-3 text-danger small">Chưa cấu hình API.</div>'; return; }

  const savedToken = localStorage.getItem(LS_TOKEN);
  const savedPhone = localStorage.getItem(LS_PHONE);
  if (savedToken) {
    try { setUser(await api('resume', savedToken)); return; }
    catch (e) { localStorage.removeItem(LS_TOKEN); token = ''; }
  }
  if (savedPhone) {
    try {
      const res = await api('authenticate', savedPhone, '');
      if (res.requirePin) { showLoginModal(); $('inputPhone').value = savedPhone; showStep('stepAdminPin'); }
      else if (res.exists) { setUser(res); return; }
    } catch (e) { /* bỏ qua, cho đăng nhập lại */ }
  }
  loadCourseVideos();
  applyLockState();
});

/* ================= ĐĂNG NHẬP ================= */

function showStep(id) { ['stepPhone', 'stepAdminPin', 'stepRegister'].forEach(s => $(s).style.display = s === id ? 'block' : 'none'); }
function showLoginModal() { showStep('stepPhone'); bootstrap.Modal.getOrCreateInstance($('authModal')).show(); }
function closeModal(id) { const m = bootstrap.Modal.getInstance($(id)); if (m) m.hide(); }

async function verifyPhone() {
  const phone = $('inputPhone').value.trim();
  if (!phone) { toast('Vui lòng nhập số điện thoại!', true); return; }
  await withBusy('btnPhoneNext', 'Đang kiểm tra...', async () => {
    const res = await api('authenticate', phone, '');
    if (res.requirePin) showStep('stepAdminPin');
    else if (res.exists) { setUser(res); closeModal('authModal'); }
    else showStep('stepRegister');
    setTimeout(() => { const f = res.requirePin ? 'inputAdminPin' : 'regName'; if (!res.exists || res.requirePin) $(f).focus(); }, 50);
  });
}

async function verifyAdminPin() {
  const phone = $('inputPhone').value.trim();
  const pin = $('inputAdminPin').value.trim();
  if (!pin) { toast('Vui lòng nhập mã xác nhận bảo mật!', true); return; }
  await withBusy('btnConfirmPin', 'Đang xác thực...', async () => {
    try {
      const res = await api('authenticate', phone, pin);
      if (res.exists && !res.requirePin) { setUser(res); closeModal('authModal'); }
      else if (!res.exists) showStep('stepRegister');
    } finally { $('inputAdminPin').value = ''; }
  });
}

async function completeRegistration() {
  const data = { phone: $('inputPhone').value.trim(), fullName: $('regName').value.trim(), unit: $('regUnit').value.trim(), email: $('regEmail').value.trim() };
  if (!data.fullName || !data.unit) { toast('Vui lòng điền họ tên và đơn vị!', true); return; }
  await withBusy('btnRegisterSubmit', 'Đang lưu...', async () => {
    setUser(await api('register', data, ''));
    closeModal('authModal');
  });
}

function setUser(res) {
  if (!res || !res.user) return;
  token = res.token; currentUser = res.user;
  localStorage.setItem(LS_TOKEN, token);
  localStorage.setItem(LS_PHONE, currentUser.phone);
  $('userHeaderPanel').innerHTML = '<div class="text-end"><span class="badge bg-light text-dark me-2">Xin chào: <b>' + esc(currentUser.fullName) + '</b>' +
    (currentUser.isAdmin ? ' <i class="fa-solid fa-crown text-warning"></i>' : '') +
    '</span><button class="btn btn-sm btn-outline-light" onclick="logout()" title="Đăng xuất"><i class="fa-solid fa-right-from-bracket"></i></button></div>';
  document.body.classList.toggle('is-admin', !!currentUser.isAdmin);
  if (currentUser.isAdmin) $('studyAlertText').innerHTML = '<i class="fa-solid fa-crown text-warning me-1"></i> <b>Chế độ Quản trị:</b> Bạn có quyền xem, tua nhanh và kiểm tra modul mọi lúc.';
  applyLockState();
  currentVideo = null;
  loadCourseVideos();
}

function onSessionExpired() {
  token = ''; currentUser = null;
  localStorage.removeItem(LS_TOKEN);
  document.body.classList.remove('is-admin');
  toast('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', true);
  setTimeout(() => location.reload(), 1500);
}

async function logout() {
  saveProgressNow(false);
  const t = token;
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_PHONE);
  try { if (t) await api('logout', t); } catch (e) {}
  location.reload();
}

function applyLockState() {
  $('guestLockScreen').style.display = currentUser ? 'none' : 'flex';
  if (!currentUser && player && typeof player.pauseVideo === 'function') player.pauseVideo();
}

function toggleSidebarMenu() {
  isSidebarCollapsed = !isSidebarCollapsed;
  $('sidebarCol').style.display = isSidebarCollapsed ? 'none' : 'block';
  $('contentCol').className = isSidebarCollapsed ? 'col-12' : 'col-lg-8';
  $('btnOpenSidebarQuick').style.display = isSidebarCollapsed ? 'inline-block' : 'none';
}

/* ================= BÀI HỌC ================= */

async function loadCourseVideos() {
  try {
    const data = await api('getCourseData', token);
    videoList = data.videos || [];
    $('videoCountBadge').innerText = videoList.length + ' bài';
    renderVideoList();
    if (videoList.length && !currentVideo) {
      const next = videoList.find(v => !v.completed) || videoList[0];
      selectVideo(next);
    }
  } catch (e) { $('videoList').innerHTML = '<div class="p-3 text-danger small">' + esc(e.message) + '</div>'; }
}

function renderVideoList() {
  const box = $('videoList');
  box.innerHTML = '';
  if (!videoList.length) { box.innerHTML = '<div class="p-3 text-muted">Chưa có bài học nào trong hệ thống.</div>'; return; }
  videoList.forEach((v, i) => {
    const item = document.createElement('div');
    item.className = 'list-group-item list-group-item-action video-item p-3' + (currentVideo && currentVideo.id === v.id ? ' active' : '');
    let badge = '<i class="fa-regular fa-circle text-muted fs-5"></i>';
    if (v.completed) badge = '<i class="fa-solid fa-circle-check text-success fs-5" title="Đã hoàn thành"></i>';
    else if (v.resumeTime > 10) badge = '<i class="fa-solid fa-circle-half-stroke text-warning fs-5" title="Đang học dở"></i>';
    item.innerHTML = '<div class="d-flex justify-content-between align-items-center gap-2"><div><span class="badge bg-secondary mb-1 text-wrap text-start">' + esc(v.category) +
      '</span><h6 class="mb-1">' + (i + 1) + '. ' + esc(v.title) + '</h6></div><span>' + badge + '</span></div>';
    item.onclick = () => selectVideo(v);
    box.appendChild(item);
  });
}

function canSkip() { return currentUser && (currentUser.isAdmin || (currentVideo && currentVideo.completed)); }

function selectVideo(video) {
  saveProgressNow(false);
  currentVideo = video;
  renderVideoList();
  $('currentVideoTitle').innerText = video.title;
  $('moduleQuizTriggerArea').style.display = (currentUser && (currentUser.isAdmin || video.completed)) ? 'block' : 'none';

  const resumeSec = (!video.completed && video.resumeTime > 5) ? video.resumeTime : 0;
  maxTimeViewed = resumeSec;
  const rn = $('resumeNotice');
  rn.style.display = resumeSec > 0 ? 'block' : 'none';
  if (resumeSec > 0) rn.innerHTML = '<i class="fa-solid fa-clock-rotate-left me-1"></i> Tự động học tiếp từ phút thứ <b>' + fmt(resumeSec) + '</b>';

  if (!currentUser) { applyLockState(); return; }
  if (!video.youtubeId) { toast('Bài học này chưa có video.', true); return; }
  if (isPlayerReady) player.loadVideoById({ videoId: video.youtubeId, startSeconds: resumeSec });
  else pendingVideo = { id: video.youtubeId, start: resumeSec };
  startProgressLock();
  startHeartbeat();
}

/* ================= VIDEO ================= */

function onYouTubeIframeAPIReady() {
  player = new YT.Player('player', {
    height: '100%', width: '100%', videoId: '',
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 1, origin: location.origin },
    events: {
      onReady: () => {
        isPlayerReady = true;
        if (pendingVideo) { player.loadVideoById({ videoId: pendingVideo.id, startSeconds: pendingVideo.start }); pendingVideo = null; }
      },
      onStateChange: onPlayerStateChange
    }
  });
}
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

function startProgressLock() {
  if (checkInterval) clearInterval(checkInterval);
  checkInterval = setInterval(() => {
    if (!player || typeof player.getCurrentTime !== 'function') return;
    const cur = player.getCurrentTime(), dur = player.getDuration();
    if (cur > 0 && dur > 0) $('videoTimer').innerText = fmt(cur) + ' / ' + fmt(dur);
    if (canSkip()) return;
    if (cur > maxTimeViewed + 2) player.seekTo(maxTimeViewed, true);
    else maxTimeViewed = Math.max(maxTimeViewed, cur);
    if (dur > 0 && maxTimeViewed >= dur - 3) $('moduleQuizTriggerArea').style.display = 'block';
  }, 500);
}

function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (player && typeof player.getPlayerState === 'function' && player.getPlayerState() === 1) saveProgressNow(true);
  }, 15000);
}

function saveProgressNow(playing) {
  if (!currentUser || !currentVideo || !player || typeof player.getCurrentTime !== 'function') return;
  const sec = player.getCurrentTime();
  if (sec > 5) api('saveProgress', token, currentVideo.id, sec, !!playing).catch(() => {});
  if (!currentVideo.completed) currentVideo.resumeTime = Math.floor(sec);
}

function onPlayerStateChange(ev) {
  if (ev.data === YT.PlayerState.PAUSED) saveProgressNow(false);
  if (ev.data === YT.PlayerState.ENDED) { saveProgressNow(false); $('moduleQuizTriggerArea').style.display = 'block'; }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveProgressNow(false); });

/* ================= THI TRẮC NGHIỆM ================= */

function requireLogin(msg) { if (currentUser) return true; toast(msg, true); showLoginModal(); return false; }

async function startModuleExam() {
  if (!requireLogin('Vui lòng đăng nhập để làm bài kiểm tra!') || !currentVideo) return;
  openExamModal('MODUL', 'bg-success', '<i class="fa-solid fa-graduation-cap me-2"></i> KIỂM TRA HOÀN THÀNH MODUL', currentVideo.title, '7/10 câu');
  try { showExam(await api('getModuleExam', token, currentVideo.id), 'MODUL'); }
  catch (e) { $('quizQuestionsContainer').innerHTML = '<div class="alert alert-danger">Lỗi: ' + esc(e.message) + '</div>'; }
}

async function startFinalExam() {
  if (!requireLogin('Vui lòng đăng nhập để tham gia thi hết môn!')) return;
  openExamModal('FINAL', 'bg-danger', '<i class="fa-solid fa-award me-2"></i> BÀI THI HẾT MÔN TOÀN KHÓA (30 CÂU)', 'Tổng hợp các chủ đề khóa học AI', '20/30 câu (Không giới hạn thời gian)');
  try { showExam(await api('getFinalExam', token), 'FINAL'); }
  catch (e) { $('quizQuestionsContainer').innerHTML = '<div class="alert alert-danger">Lỗi tạo đề thi: ' + esc(e.message) + '</div>'; }
}

function openExamModal(type, headerCls, title, lesson, cond) {
  currentExam = null;
  $('quizModalHeader').className = 'modal-header text-white ' + headerCls;
  $('quizModalTitle').innerHTML = title;
  $('quizModalLessonTitle').innerText = lesson;
  $('quizModalPassCond').innerText = cond;
  $('examResultBanner').style.display = 'none';
  $('quizQuestionsContainer').innerHTML = '<div class="text-center py-5"><i class="fa-solid fa-spinner fa-spin fa-2x text-primary"></i><p class="mt-2 text-muted">Đang tải và xáo trộn ngẫu nhiên đề thi từ ngân hàng câu hỏi...</p></div>';
  const b = $('btnSubmitQuizAnswers'); b.style.display = 'inline-block'; b.disabled = false; b.innerHTML = '<i class="fa-solid fa-paper-plane me-1"></i> NỘP BÀI THI';
  bootstrap.Modal.getOrCreateInstance($('quizModal')).show();
}

function showExam(res, type) {
  const box = $('quizQuestionsContainer');
  if (!res.success) { box.innerHTML = '<div class="alert alert-warning">' + esc(res.message) + '</div>'; $('btnSubmitQuizAnswers').style.display = 'none'; return; }
  currentExam = { id: res.examId, type: type, questions: res.questions };
  if (type === 'MODUL') $('quizModalPassCond').innerText = Math.min(7, Math.ceil(res.totalQuestions * 0.7)) + '/' + res.totalQuestions + ' câu';
  else $('quizModalPassCond').innerText = Math.min(20, Math.ceil(res.totalQuestions * 2 / 3)) + '/' + res.totalQuestions + ' câu (Không giới hạn thời gian)';
  box.innerHTML = res.questions.map((q, qi) => {
    const name = 'q_' + qi;
    const opts = q.options.map((t, oi) =>
      '<label class="quiz-option-label mb-1" id="lbl_' + qi + '_' + oi + '"><input type="radio" class="form-check-input me-2" name="' + name + '" value="' + oi + '"> <b>' +
      String.fromCharCode(65 + oi) + '.</b> ' + esc(t) + '</label>').join('');
    return '<div class="quiz-question-box" id="box_' + qi + '"><h6 class="fw-bold text-dark mb-2">Câu ' + (qi + 1) + ': ' + esc(q.question) + '</h6><div class="ps-2">' + opts +
      '</div><div class="quiz-explanation mt-2 text-muted small" id="exp_' + qi + '" style="display:none;"></div></div>';
  }).join('');
}

async function submitAnswers() {
  if (!currentExam) return;
  const answers = {};
  let unanswered = 0;
  currentExam.questions.forEach((q, qi) => {
    const c = document.querySelector('input[name="q_' + qi + '"]:checked');
    if (c) answers[q.quizId] = Number(c.value); else unanswered++;
  });
  if (unanswered && !confirm('Bạn còn ' + unanswered + ' câu chưa trả lời. Bạn có chắc chắn muốn nộp bài không?')) return;

  const exam = currentExam;
  await withBusy('btnSubmitQuizAnswers', 'Đang chấm điểm...', async () => {
    const r = await api('submitExam', token, exam.id, answers);
    currentExam = null;
    $('btnSubmitQuizAnswers').style.display = 'none';
    const banner = $('examResultBanner');
    banner.style.display = 'block';
    const line = 'Kết quả: <b>' + r.correctCount + '/' + r.total + '</b> câu đúng (' + r.score + ' điểm) • Lần thi thứ: <b>' + r.attempt + '</b>';
    if (r.passed) {
      banner.className = 'alert alert-success py-3 text-center mb-3 shadow-sm';
      banner.innerHTML = '<h4 class="fw-bold text-success mb-1"><i class="fa-solid fa-circle-check me-2"></i>CHÚC MỪNG BẠN ĐÃ ĐẠT!</h4><p class="mb-0 fs-5">' + line + '</p>';
      if (exam.type === 'MODUL' && currentVideo) { currentVideo.completed = true; currentVideo.resumeTime = 0; renderVideoList(); }
    } else {
      banner.className = 'alert alert-danger py-3 text-center mb-3 shadow-sm';
      banner.innerHTML = '<h4 class="fw-bold text-danger mb-1"><i class="fa-solid fa-triangle-exclamation me-2"></i>KẾT QUẢ: CHƯA ĐẠT YÊU CẦU</h4><p class="mb-1 fs-5">' + line + '</p><small class="text-danger fw-semibold">' +
        (exam.type === 'FINAL' ? 'Yêu cầu tối thiểu từ ' + r.need + '/' + r.total + ' câu đúng. Bạn hãy ôn lại các bài học và bấm THI LẠI!' : 'Yêu cầu tối thiểu từ ' + r.need + '/' + r.total + ' câu đúng. Vui lòng xem lại video để thi lại!') + '</small>';
      if (exam.type === 'MODUL' && currentVideo && !currentUser.isAdmin && !currentVideo.completed) {
        maxTimeViewed = 0;
        $('moduleQuizTriggerArea').style.display = 'none';
        if (player && player.seekTo) { player.seekTo(0, true); player.playVideo(); }
        renderVideoList();
      }
    }
    exam.questions.forEach((q, qi) => {
      const fb = r.detailedFeedback[q.quizId];
      if (!fb) return;
      $('box_' + qi).className = 'quiz-question-box ' + (fb.isRight ? 'is-correct' : 'is-wrong');
      if (!fb.isRight && fb.userSelected >= 0) { const w = $('lbl_' + qi + '_' + fb.userSelected); if (w) w.className = 'quiz-option-label opt-wrong'; }
      const ok = $('lbl_' + qi + '_' + fb.correctIndex); if (ok) ok.className = 'quiz-option-label opt-correct';
      document.querySelectorAll('input[name="q_' + qi + '"]').forEach(i => i.disabled = true);
      if (fb.explanation) { const ex = $('exp_' + qi); ex.style.display = 'block'; ex.innerHTML = '<i class="fa-solid fa-circle-info text-primary me-1"></i> <b>Giải thích:</b> ' + esc(fb.explanation); }
    });
    document.querySelector('#quizModal .modal-body').scrollTop = 0;
  });
}

/* ================= BẢNG XẾP HẠNG & QUẢN TRỊ ================= */

async function openLeaderboard() {
  try {
    const data = await api('getLeaderboard', token);
    $('leaderboardBody').innerHTML = data.length ? data.map((u, i) =>
      '<tr><td><b>#' + (i + 1) + '</b></td><td>' + esc(u.fullName) + '</td><td>' + esc(u.unit) + '</td><td><span class="badge bg-success">' + u.completedCount + ' bài</span></td></tr>').join('')
      : '<tr><td colspan="4" class="text-muted">Chưa có dữ liệu.</td></tr>';
    bootstrap.Modal.getOrCreateInstance($('leaderboardModal')).show();
  } catch (e) { toast(e.message, true); }
}

async function openAdminModal(keepOpen) {
  try {
    adminCache = await api('getAdminData', token);
    renderAdminResults();
    $('adminUserCount').innerText = 'Tổng số học viên: ' + adminCache.users.length;
    $('adminUserListTable').innerHTML = adminCache.users.map(u =>
      '<tr><td>' + esc(u.fullName) + '</td><td>' + esc(u.phone) + '</td><td>' + esc(u.unit) + '</td><td>' + esc(u.email) + '</td><td>' + esc(u.registerDate) + '</td><td>' + esc(u.totalStudyTime) + '</td></tr>').join('');
    renderAdminVideoTable(adminCache.videos);
    if (!keepOpen) bootstrap.Modal.getOrCreateInstance($('adminModal')).show();
  } catch (e) { toast(e.message, true); }
}

function renderAdminResults() {
  if (!adminCache) return;
  const f = ($('resultFilter').value || '').toLowerCase().trim();
  const rows = adminCache.results.filter(r => !f || (r.fullName + ' ' + r.phone + ' ' + r.unit + ' ' + r.videoId + ' ' + r.examType).toLowerCase().includes(f));
  $('adminResultsTableBody').innerHTML = rows.length ? rows.map(r =>
    '<tr><td class="text-start fw-bold">' + esc(r.fullName) + '</td><td>' + esc(r.phone) + '</td><td class="text-start small">' + esc(r.unit) + '</td>' +
    '<td><span class="badge ' + (r.examType === 'FINAL' ? 'bg-danger' : 'bg-primary') + '">' + esc(r.examType) + '</span></td>' +
    '<td><span class="badge bg-secondary">' + esc(r.videoId) + '</span></td><td>' + esc(r.attempt) + '</td><td><b>' + esc(r.correctCount) + '/' + esc(r.totalQuestions) + '</b></td>' +
    '<td><span class="badge bg-info text-dark">' + esc(r.score) + '</span></td><td><span class="badge ' + (r.status === 'ĐẠT' ? 'bg-success' : 'bg-danger') + '">' + esc(r.status) + '</span></td>' +
    '<td class="small">' + esc(r.examTime) + '</td></tr>').join('')
    : '<tr><td colspan="10" class="text-muted">Chưa có dữ liệu thi nào.</td></tr>';
}

function renderAdminVideoTable(list) {
  const tb = $('adminVideoListTable');
  tb.innerHTML = '';
  list.forEach(v => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + esc(v.order) + '</td><td><code>' + esc(v.id) + '</code></td><td>' + esc(v.category) + '</td><td>' + esc(v.title) + (v.active ? '' : ' <span class="badge bg-secondary">Ẩn</span>') +
      '</td><td><code>' + esc(v.youtubeKey) + '</code></td><td class="text-nowrap"></td>';
    const act = tr.lastChild;
    const edit = document.createElement('button'); edit.className = 'btn btn-sm btn-outline-primary me-1'; edit.title = 'Sửa'; edit.innerHTML = '<i class="fa-solid fa-pen"></i>';
    edit.onclick = () => { $('adminVideoId').value = v.id; $('adminVideoCat').value = v.category; $('adminVideoTitle').value = v.title; $('adminVideoKey').value = v.youtubeKey; $('adminVideoOrder').value = v.order; $('adminVideoEditing').innerHTML = 'Đang sửa bài <b>' + esc(v.id) + '</b> · <a href="#" onclick="clearVideoForm();return false;">Hủy, thêm bài mới</a>'; $('adminVideoTitle').focus(); };
    const del = document.createElement('button'); del.className = 'btn btn-sm btn-danger'; del.title = 'Xóa'; del.innerHTML = '<i class="fa-solid fa-trash"></i>';
    del.onclick = () => deleteVideo(v);
    act.append(edit, del);
    tb.appendChild(tr);
  });
}

function clearVideoForm() {
  ['adminVideoId', 'adminVideoCat', 'adminVideoTitle', 'adminVideoKey'].forEach(id => $(id).value = '');
  $('adminVideoOrder').value = (adminCache ? adminCache.videos.length : 0) + 1;
  $('adminVideoEditing').innerHTML = '';
}

async function saveAdminVideo() {
  const video = { id: $('adminVideoId').value, title: $('adminVideoTitle').value.trim(), category: $('adminVideoCat').value.trim(), youtubeKey: $('adminVideoKey').value.trim(), order: $('adminVideoOrder').value };
  if (!video.title || !video.youtubeKey) { toast('Vui lòng điền đủ tên bài học và link YouTube!', true); return; }
  await withBusy('btnAdminSave', '...', async () => {
    const r = await api('saveVideoAdmin', token, video);
    toast(r.created ? 'Đã thêm bài học ' + r.id + '.' : 'Đã cập nhật bài học ' + r.id + '.');
    clearVideoForm();
    await openAdminModal(true);
    currentVideo = currentVideo && videoList.find(x => x.id === currentVideo.id) ? currentVideo : null;
    loadCourseVideos();
  });
}

async function deleteVideo(v) {
  if (!confirm('Bạn có chắc chắn muốn xóa bài học "' + v.title + '"?')) return;
  try { await api('deleteVideoAdmin', token, v.id); toast('Đã xóa bài học.'); await openAdminModal(true); loadCourseVideos(); }
  catch (e) { toast(e.message, true); }
}

async function exportMasterExcel() {
  if (!currentUser || !currentUser.isAdmin) { toast('Chỉ tài khoản Quản trị viên mới có quyền xuất file!', true); return; }
  await withBusy('btnMasterExport', 'Đang xuất Excel...', async () => {
    const m = await api('getMasterMatrix', token);
    if (!m || !m.rows || !m.rows.length) { toast('Chưa có dữ liệu học viên để xuất báo cáo!', true); return; }
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const headers = ['STT', 'Số điện thoại', 'Họ và tên', 'Đơn vị'].concat(m.moduleHeaders.map(id => 'Điểm ' + id), ['Điểm thi hết môn', 'Ngày đăng nhập lần đầu', 'Ngày giờ thi hết môn']);
    const lines = [headers.map(q).join(',')];
    m.rows.forEach(r => lines.push([r.stt, q('\'' + r.phone), q(r.fullName), q(r.unit)].concat(r.moduleScores.map(s => s === '' ? '""' : s), [r.finalScore === '' ? '""' : r.finalScore, q(r.firstLogin), q(r.finalExamTime)]).join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
    a.download = 'Bang_Diem_Tong_Hop_AI_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}

/* ================= TIỆN ÍCH ================= */

async function withBusy(id, text, fn) {
  const b = $(id), old = b.innerHTML;
  b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + text;
  try { await fn(); }
  catch (e) { toast(e.message, true); }
  finally { b.disabled = false; b.innerHTML = old; }
}
function toast(text, isErr) {
  document.querySelectorAll('.toast-msg').forEach(x => x.remove());
  const d = document.createElement('div'); d.className = 'toast-msg' + (isErr ? ' err' : ''); d.textContent = text;
  document.body.appendChild(d); setTimeout(() => d.remove(), 4500);
}
function $(id) { return document.getElementById(id); }
function fmt(n) { n = Math.floor(Number(n) || 0); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
