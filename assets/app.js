/* Học AI cùng thầy giáo Nguyễn Phong — giao diện GitHub Pages gọi API Google Apps Script. */
'use strict';

const CFG = window.APP_CONFIG || {};
const LS_TOKEN = 'hocai_token';
const LS_PHONE = 'study_user_phone';
const ICON = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  logout: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

let token = '', currentUser = null, videoList = [], currentVideo = null;
let player = null, isPlayerReady = false, pendingVideo = null;
let maxTimeViewed = 0, videoDuration = 0, checkInterval = null, heartbeatInterval = null;
let currentExam = null, adminCache = null;

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
  } catch (e) { throw new Error('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'); }
  let json;
  try { json = await res.json(); } catch (e) { throw new Error('Máy chủ phản hồi không hợp lệ. Kiểm tra quyền truy cập Web App.'); }
  if (!json.ok) {
    const err = new Error(json.error || 'Đã có lỗi xảy ra.');
    err.code = json.code || '';
    if (err.code === 'SESSION' && token) onSessionExpired();
    throw err;
  }
  return json.data;
}

/* ================= KHỞI ĐỘNG ================= */

window.addEventListener('DOMContentLoaded', async () => {
  if (CFG.TEACHER_IMAGE_URL) {
    const img = $('teacherImg');
    img.onload = () => { $('teacherFig').hidden = false; $('heroPath').hidden = true; };
    img.src = CFG.TEACHER_IMAGE_URL;
  }
  if (CFG.CONTACT_EMAIL) { $('contactLink').href = 'mailto:' + CFG.CONTACT_EMAIL; $('contactLink').textContent = CFG.CONTACT_EMAIL; }
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d && d.id !== 'examDialog') d.close(); }));
  $('examDialog').addEventListener('cancel', e => { if (currentExam && !confirm('Đóng bài thi? Các câu đã chọn sẽ không được lưu.')) e.preventDefault(); });

  if (!apiConfigured()) { $('apiWarn').hidden = false; $('pathList').innerHTML = '<li class="path-empty">Chưa cấu hình máy chủ.</li>'; return; }

  const savedToken = localStorage.getItem(LS_TOKEN);
  const savedPhone = localStorage.getItem(LS_PHONE);
  if (savedToken) {
    try { setUser(await api('resume', savedToken)); return; }
    catch (e) { localStorage.removeItem(LS_TOKEN); token = ''; }
  }
  if (savedPhone) {
    try {
      const res = await api('authenticate', savedPhone, '');
      if (res.exists && !res.requirePin) { setUser(res); return; }
      if (res.requirePin) { openAuth(savedPhone); showStep('stepAdminPin'); }
    } catch (e) { /* cho đăng nhập lại */ }
  }
  loadCourseVideos();
  applyLockState();
});

/* ================= ĐĂNG NHẬP ================= */

function focusLogin() {
  if (!$('welcome').hidden) {
    $('welcome').scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => $('heroPhone').focus(), 300);
  } else openAuth('');
}

function openAuth(phone) {
  $('inputPhone').value = phone || '';
  showStep('stepPhone');
  openDialog('authDialog');
}

function showStep(id) {
  ['stepPhone', 'stepAdminPin', 'stepRegister'].forEach(s => { $(s).hidden = s !== id; });
  $('authTitle').textContent = id === 'stepRegister' ? 'Tạo tài khoản học' : id === 'stepAdminPin' ? 'Xác nhận quản trị' : 'Đăng nhập học tập';
  setTimeout(() => { const f = $(id).querySelector('input:not([type=hidden])'); if (f) f.focus(); }, 60);
}

async function loginFromHero() {
  const phone = $('heroPhone').value.trim();
  if (!phone) return;
  await withBusy('heroLoginBtn', 'Đang kiểm tra', async () => {
    const res = await api('authenticate', phone, '');
    $('inputPhone').value = phone;
    if (res.exists && !res.requirePin) { setUser(res); return; }
    openDialog('authDialog');
    if (res.requirePin) showStep('stepAdminPin');
    else { $('regPhoneShow').textContent = res.phone; showStep('stepRegister'); }
  });
}

async function verifyPhone() {
  const phone = $('inputPhone').value.trim();
  if (!phone) { toast('Nhập số điện thoại để tiếp tục.', true); return; }
  await withBusy('btnPhoneNext', 'Đang kiểm tra', async () => {
    const res = await api('authenticate', phone, '');
    if (res.requirePin) showStep('stepAdminPin');
    else if (res.exists) { setUser(res); closeDialog('authDialog'); }
    else { $('regPhoneShow').textContent = res.phone; showStep('stepRegister'); }
  });
}

async function verifyAdminPin() {
  const pin = $('inputAdminPin').value.trim();
  if (!pin) { toast('Nhập mã xác nhận để tiếp tục.', true); return; }
  await withBusy('btnConfirmPin', 'Đang xác nhận', async () => {
    try {
      const res = await api('authenticate', $('inputPhone').value.trim(), pin);
      if (res.exists && !res.requirePin) { setUser(res); closeDialog('authDialog'); }
      else if (!res.exists) { $('regPhoneShow').textContent = res.phone; showStep('stepRegister'); }
    } finally { $('inputAdminPin').value = ''; }
  });
}

async function completeRegistration() {
  const data = { phone: $('inputPhone').value.trim(), fullName: $('regName').value.trim(), unit: $('regUnit').value.trim(), email: $('regEmail').value.trim() };
  if (!data.fullName || !data.unit) { toast('Điền họ tên và đơn vị công tác.', true); return; }
  await withBusy('btnRegisterSubmit', 'Đang tạo tài khoản', async () => {
    setUser(await api('register', data, ''));
    closeDialog('authDialog');
    toast('Đã tạo tài khoản. Chúc bạn học tốt!');
  });
}

function setUser(res) {
  if (!res || !res.user) return;
  token = res.token; currentUser = res.user;
  localStorage.setItem(LS_TOKEN, token);
  localStorage.setItem(LS_PHONE, currentUser.phone);
  $('userArea').innerHTML = '<div class="user-chip"><span class="avatar" aria-hidden="true">' + esc(initials(currentUser.fullName)) + '</span>' +
    '<span class="who"><b>' + esc(currentUser.fullName) + '</b><span>' + (currentUser.isAdmin ? 'Quản trị viên' : esc(currentUser.unit || 'Học viên')) + '</span></span>' +
    '<button class="icon-btn" type="button" onclick="logout()" title="Đăng xuất" aria-label="Đăng xuất">' + ICON.logout + '</button></div>';
  $('adminBtn').hidden = !currentUser.isAdmin;
  $('welcome').hidden = true;
  applyLockState();
  currentVideo = null;
  loadCourseVideos();
}

function onSessionExpired() {
  token = ''; currentUser = null;
  localStorage.removeItem(LS_TOKEN);
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
  $('lockScreen').hidden = !!currentUser;
  if (!currentUser && player && typeof player.pauseVideo === 'function') player.pauseVideo();
}

/* ================= LỘ TRÌNH ================= */

async function loadCourseVideos() {
  try {
    const data = await api('getCourseData', token);
    videoList = data.videos || [];
    $('factLessons').textContent = videoList.length || 16;
    renderHeroPath();
    renderPath();
    updateRing();
    if (videoList.length && !currentVideo) selectVideo(videoList.find(v => !v.completed) || videoList[0], true);
  } catch (e) { $('pathList').innerHTML = '<li class="path-empty">' + esc(e.message) + '</li>'; }
}

function renderPath() {
  const list = $('pathList');
  const q = ($('pathSearch').value || '').toLowerCase().trim();
  const items = videoList.map((v, i) => ({ v, i })).filter(x => !q || (x.v.title + ' ' + x.v.category).toLowerCase().includes(q));
  if (!videoList.length) { list.innerHTML = '<li class="path-empty">Chưa có bài học nào.</li>'; return; }
  if (!items.length) { list.innerHTML = '<li class="path-empty">Không tìm thấy bài học phù hợp.</li>'; return; }
  list.innerHTML = '';
  items.forEach(({ v, i }) => {
    const li = document.createElement('li');
    const partial = !v.completed && v.resumeTime > 10;
    li.className = 'path-item' + (v.completed ? ' done' : partial ? ' partial' : '') + (currentVideo && currentVideo.id === v.id ? ' current' : '');
    const status = v.completed ? 'Đã hoàn thành' : partial ? 'Đang học, dừng ở ' + fmt(v.resumeTime) : (v.category && v.category !== v.title ? v.category : 'Chưa học');
    li.innerHTML = '<button class="path-btn" type="button"' + (currentVideo && currentVideo.id === v.id ? ' aria-current="step"' : '') + '><span class="node">' +
      (v.completed ? ICON.check : (i + 1)) + '</span><span class="path-text"><b>' + esc(v.title) + '</b><small>' + esc(status) + '</small></span></button>';
    li.firstChild.onclick = () => { selectVideo(v); if (window.innerWidth <= 900) $('course').scrollIntoView({ behavior: 'smooth' }); };
    list.appendChild(li);
  });
}

function renderHeroPath() {
  const show = 6, ol = $('heroPathList');
  ol.innerHTML = videoList.slice(0, show).map((v, i) => '<li><span class="node">' + (i + 1) + '</span><span>' + esc(v.title) + '</span></li>').join('') +
    (videoList.length > show ? '<li class="more"><span class="node">+' + (videoList.length - show) + '</span><span>bài học tiếp theo</span></li>' : '');
}

function updateRing() {
  const done = videoList.filter(v => v.completed).length, total = videoList.length || 1;
  $('ringFill').style.strokeDashoffset = String(119.4 * (1 - done / total));
  $('pathSummary').textContent = currentUser ? done + ' trên ' + videoList.length + ' bài đã hoàn thành' : videoList.length + ' bài học';
}

function canSkip() { return currentUser && (currentUser.isAdmin || (currentVideo && currentVideo.completed)); }

function selectVideo(video, initial) {
  if (!initial) saveProgressNow(false);
  currentVideo = video;
  const idx = videoList.indexOf(video);
  renderPath();
  $('lessonMeta').textContent = 'Bài ' + (idx + 1) + ' trên ' + videoList.length + (video.category && video.category !== video.title ? '. Chủ đề: ' + video.category : '');
  $('lessonTitle').textContent = video.title;
  $('btnNext').hidden = idx >= videoList.length - 1;

  const resumeSec = (!video.completed && video.resumeTime > 5) ? video.resumeTime : 0;
  maxTimeViewed = resumeSec; videoDuration = 0;
  setWatch(0, 0);
  updateExamButton();
  if (resumeSec > 0) $('watchNote').textContent = 'Tiếp tục từ ' + fmt(resumeSec) + ', nơi bạn dừng lần trước.';

  if (!currentUser) { applyLockState(); return; }
  if (!video.youtubeId) { toast('Bài học này chưa có video.', true); return; }
  if (isPlayerReady) player.loadVideoById({ videoId: video.youtubeId, startSeconds: resumeSec });
  else pendingVideo = { id: video.youtubeId, start: resumeSec };
  startProgressLock();
  startHeartbeat();
}

function nextLesson() {
  const i = videoList.indexOf(currentVideo);
  if (i >= 0 && i < videoList.length - 1) selectVideo(videoList[i + 1]);
}

function watchedEnough() { return videoDuration > 0 && maxTimeViewed >= videoDuration - 3; }

function updateExamButton() {
  const btn = $('btnModuleExam'), note = $('watchNote');
  if (!currentUser) { btn.disabled = true; note.className = 'watch-note'; note.textContent = 'Đăng nhập để học và làm bài kiểm tra.'; return; }
  const open = currentUser.isAdmin || (currentVideo && currentVideo.completed) || watchedEnough();
  btn.disabled = !open;
  note.className = 'watch-note' + (currentVideo && currentVideo.completed ? ' ok' : '');
  if (currentVideo && currentVideo.completed) note.textContent = 'Bạn đã hoàn thành bài này. Có thể xem lại và tua tự do.';
  else if (currentUser.isAdmin) note.textContent = 'Chế độ quản trị: tua tự do và làm bài kiểm tra bất kỳ lúc nào.';
  else if (open) note.textContent = 'Bạn đã xem hết video. Làm bài kiểm tra 10 câu, đạt từ 7 câu để hoàn thành.';
  else note.textContent = 'Xem hết video để mở bài kiểm tra hoàn thành bài học.';
}

function setWatch(cur, dur) {
  const pct = dur > 0 ? Math.min(100, (Math.max(cur, maxTimeViewed) / dur) * 100) : 0;
  $('watchFill').style.width = (currentVideo && currentVideo.completed ? 100 : pct) + '%';
  $('watchFill').parentElement.classList.toggle('done', !!(currentVideo && currentVideo.completed));
  $('watchFill').parentElement.setAttribute('aria-valuenow', String(Math.round(pct)));
  $('videoTimer').textContent = dur > 0 ? fmt(cur) + ' / ' + fmt(dur) : '0:00';
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
    if (dur > 0) videoDuration = dur;
    if (!canSkip()) {
      if (cur > maxTimeViewed + 2) { player.seekTo(maxTimeViewed, true); return; }
      maxTimeViewed = Math.max(maxTimeViewed, cur);
    } else maxTimeViewed = Math.max(maxTimeViewed, cur);
    setWatch(cur, dur);
    if ($('btnModuleExam').disabled && watchedEnough()) updateExamButton();
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
  if (!currentVideo.completed && sec > 0) currentVideo.resumeTime = Math.floor(sec);
}

function onPlayerStateChange(ev) {
  if (ev.data === YT.PlayerState.PAUSED) saveProgressNow(false);
  if (ev.data === YT.PlayerState.ENDED) {
    saveProgressNow(false);
    maxTimeViewed = Math.max(maxTimeViewed, videoDuration);
    updateExamButton();
    renderPath();
    if (currentVideo && !currentVideo.completed) toast('Bạn đã xem hết video. Hãy làm bài kiểm tra để hoàn thành bài học.');
  }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveProgressNow(false); });

/* ================= THI TRẮC NGHIỆM ================= */

function requireLogin() { if (currentUser) return true; focusLogin(); toast('Đăng nhập để làm bài kiểm tra.', true); return false; }

async function startModuleExam() {
  if (!requireLogin() || !currentVideo) return;
  if (player && player.pauseVideo) player.pauseVideo();
  openExam('Kiểm tra hoàn thành bài học', currentVideo.title);
  try { showExam(await api('getModuleExam', token, currentVideo.id), 'MODUL'); }
  catch (e) { $('examQuestions').innerHTML = '<p class="notice">' + esc(e.message) + '</p>'; $('btnSubmitExam').hidden = true; }
}

async function startFinalExam() {
  if (!requireLogin()) return;
  if (player && player.pauseVideo) player.pauseVideo();
  openExam('Thi hết môn', 'Tổng hợp các chủ đề của khóa học. Không giới hạn thời gian.');
  try { showExam(await api('getFinalExam', token), 'FINAL'); }
  catch (e) { $('examQuestions').innerHTML = '<p class="notice">' + esc(e.message) + '</p>'; $('btnSubmitExam').hidden = true; }
}

function openExam(title, sub) {
  currentExam = null;
  $('examTitle').textContent = title;
  $('examSub').textContent = sub;
  $('examResult').hidden = true;
  $('examProgress').textContent = '';
  $('examQuestions').innerHTML = '<div class="loading"><div class="spinner"></div>Đang tạo đề ngẫu nhiên từ ngân hàng câu hỏi…</div>';
  const b = $('btnSubmitExam'); b.hidden = false; b.disabled = false; b.textContent = 'Nộp bài';
  openDialog('examDialog');
}

function showExam(res, type) {
  const box = $('examQuestions');
  if (!res.success) { box.innerHTML = '<p class="notice">' + esc(res.message) + '</p>'; $('btnSubmitExam').hidden = true; return; }
  const need = type === 'MODUL' ? Math.min(7, Math.ceil(res.totalQuestions * 0.7)) : Math.min(20, Math.ceil(res.totalQuestions * 2 / 3));
  currentExam = { id: res.examId, type: type, questions: res.questions, need: need };
  $('examSub').textContent = res.totalQuestions + ' câu, đạt từ ' + need + ' câu đúng' + (type === 'FINAL' ? '. Không giới hạn thời gian.' : '.');
  box.innerHTML = res.questions.map((q, qi) =>
    '<div class="question" id="box_' + qi + '" role="group" aria-label="Câu ' + (qi + 1) + '"><h3><span>Câu ' + (qi + 1) + '</span>' + esc(q.question) + '</h3>' +
    q.options.map((t, oi) => '<label class="option" id="lbl_' + qi + '_' + oi + '"><input type="radio" name="q_' + qi + '" value="' + oi + '"><span class="key">' +
      String.fromCharCode(65 + oi) + '</span><span>' + esc(t) + '</span></label>').join('') +
    '<div class="explain" id="exp_' + qi + '" hidden></div></div>').join('');
  box.onchange = updateExamProgress;
  updateExamProgress();
}

function updateExamProgress() {
  if (!currentExam) return;
  const done = currentExam.questions.filter((q, qi) => document.querySelector('input[name="q_' + qi + '"]:checked')).length;
  $('examProgress').textContent = 'Đã trả lời ' + done + ' / ' + currentExam.questions.length;
}

async function submitAnswers() {
  if (!currentExam) return;
  const answers = {};
  let unanswered = 0;
  currentExam.questions.forEach((q, qi) => {
    const c = document.querySelector('input[name="q_' + qi + '"]:checked');
    if (c) answers[q.quizId] = Number(c.value); else unanswered++;
  });
  if (unanswered && !confirm('Còn ' + unanswered + ' câu chưa trả lời. Vẫn nộp bài?')) return;

  const exam = currentExam;
  await withBusy('btnSubmitExam', 'Đang chấm', async () => {
    const r = await api('submitExam', token, exam.id, answers);
    currentExam = null;
    $('btnSubmitExam').hidden = true;
    $('examProgress').textContent = 'Lần làm bài thứ ' + r.attempt;
    const res = $('examResult');
    res.hidden = false;
    res.className = 'exam-result ' + (r.passed ? 'pass' : 'fail');
    res.innerHTML = '<div class="exam-score">' + r.correctCount + '/' + r.total + '</div><div><h3>' +
      (r.passed ? (exam.type === 'FINAL' ? 'Chúc mừng, bạn đã đạt bài thi hết môn' : 'Chúc mừng, bạn đã hoàn thành bài học') : 'Chưa đạt yêu cầu') + '</h3><p>' +
      r.score + ' điểm trên thang 10. ' + (r.passed ? '' : 'Cần từ ' + r.need + ' câu đúng. ' + (exam.type === 'FINAL' ? 'Ôn lại các bài học rồi thi lại.' : 'Xem lại video rồi làm lại bài kiểm tra.')) + '</p></div>';

    if (exam.type === 'MODUL' && currentVideo) {
      if (r.passed) { currentVideo.completed = true; currentVideo.resumeTime = 0; }
      else if (!currentUser.isAdmin && !currentVideo.completed) {
        maxTimeViewed = 0;
        if (player && player.seekTo) player.seekTo(0, true);
      }
      renderPath(); updateRing(); updateExamButton(); setWatch(0, videoDuration);
    }
    exam.questions.forEach((q, qi) => {
      const fb = r.detailedFeedback[q.quizId];
      if (!fb) return;
      $('box_' + qi).classList.add(fb.isRight ? 'is-correct' : 'is-wrong');
      if (!fb.isRight && fb.userSelected >= 0) { const w = $('lbl_' + qi + '_' + fb.userSelected); if (w) w.classList.add('opt-wrong'); }
      const ok = $('lbl_' + qi + '_' + fb.correctIndex); if (ok) ok.classList.add('opt-correct');
      document.querySelectorAll('input[name="q_' + qi + '"]').forEach(i => i.disabled = true);
      if (fb.explanation) { const ex = $('exp_' + qi); ex.hidden = false; ex.innerHTML = '<b>Giải thích:</b> ' + esc(fb.explanation); }
    });
    document.querySelector('#examDialog .exam-body').scrollTop = 0;
  });
}

/* ================= BẢNG XẾP HẠNG & QUẢN TRỊ ================= */

async function openLeaderboard() {
  try {
    const data = await api('getLeaderboard', token);
    $('leaderboardList').innerHTML = data.length ? data.map((u, i) =>
      '<li><span class="rank">' + (i + 1) + '</span><span class="lb-name"><b>' + esc(u.fullName) + '</b><span>' + esc(u.unit) + '</span></span><span class="lb-count">' + u.completedCount + ' bài</span></li>').join('')
      : '<li class="muted">Chưa có học viên hoàn thành bài học.</li>';
    openDialog('leaderboardDialog');
  } catch (e) { toast(e.message, true); }
}

async function openAdmin(keepOpen) {
  try {
    adminCache = await api('getAdminData', token);
    renderAdminResults();
    $('adminUserCount').textContent = adminCache.users.length + ' học viên đã đăng ký';
    $('adminUserBody').innerHTML = adminCache.users.map(u =>
      '<tr><td><b>' + esc(u.fullName) + '</b></td><td>' + esc(u.phone) + '</td><td>' + esc(u.unit) + '</td><td>' + esc(u.email) + '</td><td>' + esc(u.registerDate) + '</td><td>' + esc(u.totalStudyTime) + '</td></tr>').join('');
    renderAdminVideos(adminCache.videos);
    if (!keepOpen) { adminTab('results'); openDialog('adminDialog'); }
  } catch (e) { toast(e.message, true); }
}

function adminTab(name) {
  document.querySelectorAll('#adminDialog .tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  ['results', 'videos', 'users'].forEach(n => { $('tab-' + n).hidden = n !== name; });
}

function renderAdminResults() {
  if (!adminCache) return;
  const f = ($('resultFilter').value || '').toLowerCase().trim();
  const rows = adminCache.results.filter(r => !f || (r.fullName + ' ' + r.phone + ' ' + r.unit + ' ' + r.videoId + ' ' + r.examType).toLowerCase().includes(f));
  $('adminResultsBody').innerHTML = rows.length ? rows.map(r =>
    '<tr><td><b>' + esc(r.fullName) + '</b></td><td>' + esc(r.phone) + '</td><td>' + esc(r.unit) + '</td>' +
    '<td><span class="pill ' + (r.examType === 'FINAL' ? 'pill-final">Hết môn' : 'pill-mod">Bài học') + '</span></td>' +
    '<td>' + esc(r.videoId === 'TOAN_KHOA' ? '' : r.videoId) + '</td><td>' + esc(r.attempt) + '</td><td>' + esc(r.correctCount) + '/' + esc(r.totalQuestions) + '</td>' +
    '<td><b>' + esc(r.score) + '</b></td><td><span class="pill ' + (r.status === 'ĐẠT' ? 'pill-pass">Đạt' : 'pill-fail">Chưa đạt') + '</span></td><td>' + esc(r.examTime) + '</td></tr>').join('')
    : '<tr><td colspan="10" class="muted">Chưa có kết quả thi.</td></tr>';
}

function renderAdminVideos(list) {
  const tb = $('adminVideoBody');
  tb.innerHTML = '';
  list.forEach(v => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + esc(v.order) + '</td><td><code>' + esc(v.id) + '</code></td><td>' + esc(v.category) + '</td><td><b>' + esc(v.title) + '</b>' +
      (v.active ? '' : ' <span class="pill pill-hidden">Đang ẩn</span>') + '</td><td><code>' + esc(v.youtubeKey) + '</code></td><td><div class="row-actions"></div></td>';
    const act = tr.querySelector('.row-actions');
    const edit = btnEl('Sửa', 'btn btn-quiet btn-sm', () => {
      $('adminVideoId').value = v.id; $('adminVideoCat').value = v.category; $('adminVideoTitle').value = v.title;
      $('adminVideoKey').value = v.youtubeKey; $('adminVideoOrder').value = v.order;
      $('adminVideoEditing').innerHTML = 'Đang sửa bài ' + esc(v.id) + '. <a href="#" onclick="clearVideoForm();return false;">Thêm bài mới thay vì sửa</a>';
      $('btnAdminSave').textContent = 'Lưu thay đổi';
      $('adminVideoTitle').focus();
    });
    const del = btnEl('Xóa', 'btn btn-danger btn-sm', () => deleteVideo(v));
    act.append(edit, del);
    tb.appendChild(tr);
  });
}

function clearVideoForm() {
  ['adminVideoId', 'adminVideoCat', 'adminVideoTitle', 'adminVideoKey'].forEach(id => $(id).value = '');
  $('adminVideoOrder').value = (adminCache ? adminCache.videos.length : 0) + 1;
  $('adminVideoEditing').textContent = '';
  $('btnAdminSave').textContent = 'Lưu bài học';
}

async function saveAdminVideo() {
  const video = { id: $('adminVideoId').value, title: $('adminVideoTitle').value.trim(), category: $('adminVideoCat').value.trim(), youtubeKey: $('adminVideoKey').value.trim(), order: $('adminVideoOrder').value };
  if (!video.title || !video.youtubeKey) { toast('Điền tên bài học và link YouTube.', true); return; }
  await withBusy('btnAdminSave', 'Đang lưu', async () => {
    const r = await api('saveVideoAdmin', token, video);
    toast(r.created ? 'Đã thêm bài học ' + r.id + '.' : 'Đã lưu thay đổi bài ' + r.id + '.');
    await openAdmin(true);
    clearVideoForm();
    currentVideo = null;
    loadCourseVideos();
  });
}

async function deleteVideo(v) {
  if (!confirm('Xóa bài học "' + v.title + '"? Thao tác này không hoàn tác được.')) return;
  try { await api('deleteVideoAdmin', token, v.id); toast('Đã xóa bài học.'); await openAdmin(true); currentVideo = null; loadCourseVideos(); }
  catch (e) { toast(e.message, true); }
}

async function exportMasterExcel() {
  await withBusy('btnMasterExport', 'Đang xuất', async () => {
    const m = await api('getMasterMatrix', token);
    if (!m || !m.rows || !m.rows.length) { toast('Chưa có học viên để xuất bảng điểm.', true); return; }
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const headers = ['STT', 'Số điện thoại', 'Họ và tên', 'Đơn vị'].concat(m.moduleHeaders.map(id => 'Điểm ' + id), ['Điểm thi hết môn', 'Ngày đăng ký', 'Thời gian thi hết môn']);
    const lines = [headers.map(q).join(',')];
    m.rows.forEach(r => lines.push([r.stt, q('\'' + r.phone), q(r.fullName), q(r.unit)].concat(r.moduleScores.map(s => s === '' ? '""' : s), [r.finalScore === '' ? '""' : r.finalScore, q(r.firstLogin), q(r.finalExamTime)]).join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
    a.download = 'Bang_Diem_Tong_Hop_AI_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Đã xuất bảng điểm của ' + m.rows.length + ' học viên.');
  });
}

/* ================= TIỆN ÍCH ================= */

function openDialog(id) { const d = $(id); if (!d.open) d.showModal(); }
function closeDialog(id) {
  const d = $(id);
  if (id === 'examDialog' && currentExam && !confirm('Đóng bài thi? Các câu đã chọn sẽ không được lưu.')) return;
  if (id === 'examDialog') currentExam = null;
  d.close();
}
async function withBusy(id, text, fn) {
  const b = $(id), old = b.textContent;
  b.disabled = true; b.textContent = text + '…';
  try { await fn(); }
  catch (e) { toast(e.message, true); }
  finally { b.disabled = false; b.textContent = old; }
}
let toastTimer = null;
function toast(text, isErr) {
  const t = $('toast');
  t.textContent = text; t.className = 'toast' + (isErr ? ' err' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}
function btnEl(text, cls, onClick) { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.onclick = onClick; return b; }
function initials(name) { const p = String(name || '').trim().split(/\s+/); return ((p.length > 1 ? p[p.length - 2][0] : '') + (p[p.length - 1] || '?')[0]).toUpperCase(); }
function $(id) { return document.getElementById(id); }
function fmt(n) { n = Math.floor(Number(n) || 0); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
