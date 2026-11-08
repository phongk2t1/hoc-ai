/**
 * HỌC AI MỖI NGÀY — Thầy giáo Nguyễn Phong
 * Google Apps Script — API JSON cho giao diện chạy trên GitHub Pages.
 *
 * TRIỂN KHAI (xem README.md):
 * 1) Project Settings → Script Properties, thêm:
 *      SPREADSHEET_ID  = ID Google Sheet dữ liệu
 *      ADMIN_PHONE     = số điện thoại quản trị viên (10 số)
 *      ADMIN_PASSWORD  = mật khẩu quản trị (bắt buộc, tối thiểu 8 ký tự)
 *    (tuỳ chọn) ADMIN_EMAIL, ALLOWED_ORIGIN
 * 2) Chạy setup() một lần để tạo/kiểm tra các trang tính.
 * 3) Deploy → New deployment → Web app
 *      Execute as: Me   ·   Who has access: Anyone
 *    Sao chép URL /exec vào config.js của web.
 */

const PROPS = PropertiesService.getScriptProperties();
function prop_(key, fallback) {
  const v = PROPS.getProperty(key);
  return v === null || v === '' ? fallback : v;
}

const CONFIG = {
  SPREADSHEET_ID: prop_('SPREADSHEET_ID', ''),
  ADMIN_EMAIL: prop_('ADMIN_EMAIL', 'phongk2t1@gmail.com'),
  ADMIN_PHONE: prop_('ADMIN_PHONE', ''),
  ADMIN_NAME: prop_('ADMIN_NAME', 'Nguyễn Phong'),
  SESSION_PREFIX: 'AIMASTER_PHONE_SESSION_',
  SESSION_TTL: 21600, // 6 giờ (tối đa của CacheService)
  APP_NAME: 'Học AI mỗi ngày cùng thầy giáo Nguyễn Phong',
  PASS_SCORE: 70,
  MIN_WATCH_RATIO: 0.90
};

const SHEETS = {
  STUDENTS: 'Students',
  USERS: 'Users',            // bảng học viên cũ (Phone, FullName, Unit, Email...) — dùng dự phòng khi đăng nhập
  VIDEOS: 'Videos',
  QUIZZES: 'Quizzes',
  PROGRESS: 'Progress',
  ATTEMPTS: 'Attempts',
  EVENTS: 'LearningHistory'
};

/* =========================================================
 * HTTP ENTRY POINTS
 * ========================================================= */

/** Các hàm được phép gọi từ giao diện web. */
const API = {
  ping:                  ()  => ({ appName: CONFIG.APP_NAME, time: new Date() }),
  loginWithPhone:        (a) => loginWithPhone(a[0], a[1]),
  getBootstrap:          (a) => getBootstrap(a[0]),
  logout:                (a) => logout(a[0]),
  recordWatch:           (a) => recordWatch(a[0], a[1], a[2], a[3], a[4]),
  getQuiz:               (a) => getQuiz(a[0], a[1]),
  submitQuiz:            (a) => submitQuiz(a[0], a[1], a[2], a[3]),
  getLeaderboard:        (a) => getLeaderboard(a[0]),
  getMyHistory:          (a) => getMyHistory(a[0]),
  adminList:             (a) => adminList(a[0]),
  adminSaveVideo:        (a) => adminSaveVideo(a[0], a[1]),
  adminDeleteVideo:      (a) => adminDeleteVideo(a[0], a[1]),
  adminSaveQuiz:         (a) => adminSaveQuiz(a[0], a[1]),
  adminDeleteQuiz:       (a) => adminDeleteQuiz(a[0], a[1]),
  adminSetStudentActive: (a) => adminSetStudentActive(a[0], a[1], a[2]),
  adminSaveStudent:      (a) => adminSaveStudent(a[0], a[1])
};

/**
 * Giao diện gửi POST với Content-Type: text/plain (tránh CORS preflight),
 * thân là JSON: { action: 'tênHàm', args: [...] }.
 */
function doPost(e) {
  let out;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = API[body.action];
    if (!fn) throw apiError_('Yêu cầu không hợp lệ.', 'BAD_ACTION');
    const args = Array.isArray(body.args) ? body.args : [];
    out = { ok: true, data: fn(args) };
  } catch (err) {
    out = { ok: false, error: (err && err.message) || String(err), code: (err && err.code) || '' };
  }
  return json_(out);
}

/** GET chỉ dùng để kiểm tra API còn hoạt động. */
function doGet() {
  return json_({ ok: true, data: { appName: CONFIG.APP_NAME, status: 'API đang hoạt động', time: new Date() } });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function apiError_(message, code) {
  const e = new Error(message);
  e.code = code || '';
  return e;
}

/* =========================================================
 * SETUP
 * ========================================================= */

/** Chạy một lần để tạo bảng dữ liệu (không xoá dữ liệu cũ). */
function setup() {
  assertConfig_();
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const schemas = {
    Students: ['email','fullName','phone','unit','createdAt','lastSeenAt','role','active','totalStudySeconds','lastStudyAt'],
    Videos: ['videoId','topic','title','youtubeId','description','sortOrder','active','quizRequired'],
    Quizzes: ['quizId','videoId','question','optionA','optionB','optionC','optionD','correctOption','explanation','sortOrder','active'],
    Progress: ['email','videoId','status','lastPosition','duration','watchRatio','completedAt','bestScore','attemptCount','updatedAt','studySeconds'],
    Attempts: ['attemptId','email','videoId','submittedAt','score','passed','answersJson'],
    LearningHistory: ['eventId','email','videoId','eventType','position','duration','score','details','createdAt']
  };
  const report = [];
  Object.keys(schemas).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) sh.appendRow(schemas[name]);
    const header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
    const missing = schemas[name].filter(h => header.indexOf(h) < 0);
    if (missing.length) report.push(name + ': thiếu cột ' + missing.join(', '));
    sh.setFrozenRows(1);
  });
  if (!PROPS.getProperty('ADMIN_PASSWORD')) report.push('Chưa đặt ADMIN_PASSWORD trong Script Properties.');
  const msg = report.length ? 'Đã tạo bảng. Cần kiểm tra:\n- ' + report.join('\n- ') : 'Cấu trúc dữ liệu đầy đủ.';
  Logger.log(msg);
  return msg;
}

function assertConfig_() {
  if (!CONFIG.SPREADSHEET_ID) throw apiError_('Máy chủ chưa cấu hình SPREADSHEET_ID (Script Properties).', 'CONFIG');
  if (!CONFIG.ADMIN_PHONE) throw apiError_('Máy chủ chưa cấu hình ADMIN_PHONE (Script Properties).', 'CONFIG');
}

/* =========================================================
 * ĐĂNG NHẬP / PHIÊN
 * ========================================================= */

/** Đăng nhập bằng số điện thoại. Quản trị viên phải nhập thêm mật khẩu. */
function loginWithPhone(phoneInput, password) {
  assertConfig_();
  const phone = normalizePhone_(phoneInput);
  if (!/^0[0-9]{9}$/.test(phone)) throw apiError_('Vui lòng nhập số điện thoại gồm 10 chữ số.', 'BAD_PHONE');

  const isAdmin = phone === normalizePhone_(CONFIG.ADMIN_PHONE);
  let student;

  if (isAdmin) {
    checkAdminPassword_(password);
    upsertStudent_({ email: CONFIG.ADMIN_EMAIL, name: CONFIG.ADMIN_NAME, phone: phone, role: 'admin' });
    student = { email: CONFIG.ADMIN_EMAIL.toLowerCase(), fullName: CONFIG.ADMIN_NAME, phone: phone, role: 'admin' };
  } else {
    student = findStudentByPhone_(phone);
    if (!student) throw apiError_('Số điện thoại chưa có trong danh sách học viên. Vui lòng liên hệ quản trị viên để được đăng ký.', 'NOT_REGISTERED');
    if (student.active === false) throw apiError_('Tài khoản đã bị tạm khóa. Vui lòng liên hệ quản trị viên.', 'LOCKED');
    upsertStudent_({ email: student.email, name: student.fullName, phone: phone, unit: student.unit, role: 'student' });
    student.role = 'student';
  }

  const sessionId = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const session = { email: student.email, name: student.fullName || (isAdmin ? CONFIG.ADMIN_NAME : 'Học viên'), phone: phone, role: student.role };
  CacheService.getScriptCache().put(CONFIG.SESSION_PREFIX + sessionId, JSON.stringify(session), CONFIG.SESSION_TTL);
  return getBootstrap(sessionId);
}

/** Chống dò mật khẩu: khoá đăng nhập quản trị 15 phút sau 5 lần sai. */
function checkAdminPassword_(password) {
  const expected = PROPS.getProperty('ADMIN_PASSWORD');
  if (!expected || expected.length < 8) throw apiError_('Máy chủ chưa đặt ADMIN_PASSWORD (tối thiểu 8 ký tự) trong Script Properties.', 'CONFIG');
  const cache = CacheService.getScriptCache();
  const key = 'ADMIN_FAILS';
  const fails = Number(cache.get(key) || 0);
  if (fails >= 5) throw apiError_('Đăng nhập quản trị tạm khoá 15 phút do nhập sai nhiều lần.', 'ADMIN_LOCKED');
  if (!password) throw apiError_('Vui lòng nhập mật khẩu quản trị.', 'ADMIN_PASSWORD_REQUIRED');
  if (String(password) !== expected) {
    cache.put(key, String(fails + 1), 900);
    throw apiError_('Mật khẩu quản trị không đúng.', 'ADMIN_PASSWORD_REQUIRED');
  }
  cache.remove(key);
}

/**
 * Tìm học viên theo số điện thoại: ưu tiên bảng Students,
 * nếu không có thì tìm ở bảng Users (dữ liệu cũ) — khi đó khoá dữ liệu là số điện thoại.
 */
function findStudentByPhone_(phone) {
  const s = dataRows_(sheet_(SHEETS.STUDENTS)).find(r => normalizePhone_(r.phone) === phone);
  if (s) {
    const email = String(s.email || '').trim().toLowerCase() || phone;
    return { email: email, fullName: String(s.fullName || '').trim(), phone: phone, unit: String(s.unit || ''), active: !isFalse_(s.active) };
  }
  const usersSheet = optionalSheet_(SHEETS.USERS);
  if (usersSheet) {
    const u = dataRows_(usersSheet).find(r => normalizePhone_(r.Phone || r.phone) === phone);
    if (u) return { email: phone, fullName: String(u.FullName || u.fullName || '').trim(), phone: phone, unit: String(u.Unit || u.unit || ''), active: !isFalse_(u.Active === undefined ? u.active : u.Active) };
  }
  return null;
}

function getBootstrap(sessionToken) {
  const user = verifySession_(sessionToken);
  return {
    appName: CONFIG.APP_NAME,
    user: { email: user.email, name: user.name, phone: user.phone || '', role: user.role },
    sessionToken: sessionToken,
    passScore: CONFIG.PASS_SCORE,
    minWatchRatio: CONFIG.MIN_WATCH_RATIO,
    videos: getVideosForUser_(user),
    leaderboard: getLeaderboard_(),
    profile: getStudent_(user.email)
  };
}

function logout(sessionToken) {
  if (sessionToken) CacheService.getScriptCache().remove(CONFIG.SESSION_PREFIX + String(sessionToken));
  return { ok: true };
}

function verifySession_(sessionToken) {
  const token = String(sessionToken || '').trim();
  if (!token) throw apiError_('Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.', 'SESSION');
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CONFIG.SESSION_PREFIX + token);
  if (!cached) throw apiError_('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'SESSION');
  const user = JSON.parse(cached);
  if (!user.email || !user.phone) throw apiError_('Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.', 'SESSION');
  cache.put(CONFIG.SESSION_PREFIX + token, cached, CONFIG.SESSION_TTL); // gia hạn phiên khi còn hoạt động
  return user;
}

function isAdminUser_(user) { return user && user.role === 'admin'; }
function assertAdmin_(user) { if (!isAdminUser_(user)) throw apiError_('Bạn không có quyền quản trị.', 'FORBIDDEN'); }

/* =========================================================
 * HỌC TẬP
 * ========================================================= */

function getStudent_(email) {
  const row = dataRows_(sheet_(SHEETS.STUDENTS)).find(r => sameKey_(r.email, email));
  return row ? { email: String(row.email), fullName: String(row.fullName || ''), phone: String(row.phone || ''), unit: String(row.unit || ''), role: String(row.role || 'student'), active: !isFalse_(row.active) } : null;
}

function getVideosForUser_(user) {
  const admin = isAdminUser_(user);
  const all = dataRows_(sheet_(SHEETS.VIDEOS))
    .filter(v => isTrue_(v.active) && String(v.videoId || '').trim())
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  const pmap = {};
  dataRows_(sheet_(SHEETS.PROGRESS)).filter(p => sameKey_(p.email, user.email)).forEach(p => pmap[String(p.videoId)] = p);
  return all.map((v, i) => {
    const p = pmap[String(v.videoId)] || {};
    const completed = String(p.status) === 'completed';
    return {
      videoId: String(v.videoId), topic: clean_(v.topic) || 'Chưa phân loại', title: clean_(v.title) || 'Bài học',
      youtubeId: String(v.youtubeId || '').trim(), description: clean_(v.description), sortOrder: Number(v.sortOrder || i + 1),
      quizRequired: isTrue_(v.quizRequired),
      status: completed ? 'completed' : (admin ? 'admin' : 'unlocked'),
      lastPosition: Number(p.lastPosition || 0), duration: Number(p.duration || 0), watchRatio: Number(p.watchRatio || 0),
      bestScore: Number(p.bestScore || 0), attemptCount: Number(p.attemptCount || 0),
      completedAt: p.completedAt ? String(p.completedAt) : '', studySeconds: Number(p.studySeconds || 0)
    };
  });
}

function recordWatch(token, videoId, position, duration, eventType) {
  const user = verifySession_(token);
  const video = findVideo_(videoId);
  if (!video || !isTrue_(video.active)) throw apiError_('Bài học không tồn tại hoặc đã bị ẩn.', 'NOT_FOUND');
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const pos = Math.max(0, Number(position) || 0);
    const dur = Math.max(0, Number(duration) || 0);
    const sh = sheet_(SHEETS.PROGRESS);
    const values = sh.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < values.length; i++) if (sameKey_(values[i][0], user.email) && String(values[i][1]) === String(videoId)) { rowIndex = i + 1; break; }
    const old = rowIndex > 0 ? values[rowIndex - 1] : [];
    const oldPos = Number(old[3] || 0);
    const oldCompleted = String(old[2]) === 'completed';
    const free = oldCompleted || isAdminUser_(user);
    const safePosition = free ? pos : Math.max(oldPos, Math.min(pos, oldPos + 15));
    const newRatio = dur > 0 ? Math.max(Number(old[5] || 0), Math.min(1, safePosition / dur)) : Number(old[5] || 0);
    const elapsed = Math.max(0, Math.min(15, pos - oldPos));
    const row = [user.email, String(videoId), oldCompleted ? 'completed' : 'in_progress', safePosition, dur || Number(old[4] || 0), newRatio,
      old[6] || '', Number(old[7] || 0), Number(old[8] || 0), new Date(), Number(old[10] || 0) + elapsed];
    if (rowIndex > 0) sh.getRange(rowIndex, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
    updateStudentStudy_(user.email, elapsed);
    logEvent_(user.email, videoId, eventType || 'WATCH_PROGRESS', pos, dur, '', 'Progress updated');
    return { ok: true, progress: { lastPosition: safePosition, duration: dur, watchRatio: newRatio, completed: oldCompleted } };
  } finally { lock.releaseLock(); }
}

function getQuiz(token, videoId) {
  const user = verifySession_(token);
  if (!getVideosForUser_(user).some(x => x.videoId === String(videoId))) throw apiError_('Không tìm thấy bài học.', 'NOT_FOUND');
  return dataRows_(sheet_(SHEETS.QUIZZES))
    .filter(q => String(q.videoId) === String(videoId) && isTrue_(q.active))
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
    .map(q => ({ quizId: String(q.quizId), question: String(q.question), options: [q.optionA, q.optionB, q.optionC, q.optionD].map(x => String(x || '')) }));
  // Không gửi đáp án/giải thích xuống trình duyệt trước khi nộp bài.
}

function submitQuiz(token, videoId, answers, watchedRatio) {
  const user = verifySession_(token);
  const v = getVideosForUser_(user).find(x => x.videoId === String(videoId));
  if (!v) throw apiError_('Không tìm thấy bài học.', 'NOT_FOUND');
  // Chỉ tin tỉ lệ xem do máy chủ ghi nhận (client có thể gửi số giả).
  const serverRatio = Number(v.watchRatio) || 0;
  const clientRatio = Math.min(Number(watchedRatio) || 0, serverRatio + 0.05);
  const ratio = Math.max(serverRatio, clientRatio);
  if (!isAdminUser_(user) && v.status !== 'completed' && ratio < CONFIG.MIN_WATCH_RATIO) {
    throw apiError_('Bạn cần xem tối thiểu ' + Math.round(CONFIG.MIN_WATCH_RATIO * 100) + '% thời lượng video trước khi làm bài kiểm tra.', 'WATCH_MORE');
  }
  const qs = dataRows_(sheet_(SHEETS.QUIZZES)).filter(q => String(q.videoId) === String(videoId) && isTrue_(q.active));
  if (!qs.length) throw apiError_('Bài học chưa có câu hỏi kiểm tra. Vui lòng báo quản trị viên.', 'NO_QUIZ');
  const answerMap = answers || {};
  let correct = 0;
  const review = qs.map(q => {
    const right = String(q.correctOption || '').trim().toUpperCase();
    const chosen = String(answerMap[q.quizId] || '');
    if (chosen === right) correct++;
    return { quizId: String(q.quizId), chosen: chosen, correct: right, explanation: String(q.explanation || '') };
  });
  const score = Math.round(correct / qs.length * 100);
  const passed = score >= CONFIG.PASS_SCORE;

  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    sheet_(SHEETS.ATTEMPTS).appendRow([Utilities.getUuid(), user.email, String(videoId), new Date(), score, passed, JSON.stringify(answerMap)]);
    const psh = sheet_(SHEETS.PROGRESS);
    const vals = psh.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < vals.length; i++) if (sameKey_(vals[i][0], user.email) && String(vals[i][1]) === String(videoId)) { rowIndex = i + 1; break; }
    const old = rowIndex > 0 ? vals[rowIndex - 1] : [];
    const completed = String(old[2]) === 'completed' || passed;
    const row = [user.email, String(videoId), completed ? 'completed' : 'in_progress', Number(old[3] || 0), Number(old[4] || 0),
      Math.max(Number(old[5] || 0), ratio), completed ? (old[6] || new Date()) : '', Math.max(Number(old[7] || 0), score),
      Number(old[8] || 0) + 1, new Date(), Number(old[10] || 0)];
    if (rowIndex > 0) psh.getRange(rowIndex, 1, 1, row.length).setValues([row]); else psh.appendRow(row);
    logEvent_(user.email, videoId, 'QUIZ_SUBMITTED', Number(old[3] || 0), Number(old[4] || 0), score, 'passed=' + passed + '; correct=' + correct + '/' + qs.length);
  } finally { lock.releaseLock(); }
  CacheService.getScriptCache().remove('LEADERBOARD');

  return { score: score, passed: passed, correct: correct, total: qs.length, passScore: CONFIG.PASS_SCORE, review: review,
           videos: getVideosForUser_(user), leaderboard: getLeaderboard_() };
}

function getLeaderboard(token) {
  verifySession_(token);
  return getLeaderboard_();
}

function getLeaderboard_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('LEADERBOARD');
  if (hit) return JSON.parse(hit);
  const students = dataRows_(sheet_(SHEETS.STUDENTS)).filter(s => !isFalse_(s.active) && String(s.role) !== 'admin');
  const progress = dataRows_(sheet_(SHEETS.PROGRESS));
  const attempts = dataRows_(sheet_(SHEETS.ATTEMPTS));
  const done = {}, scores = {};
  progress.forEach(p => { if (String(p.status) === 'completed') { const k = key_(p.email); done[k] = (done[k] || 0) + 1; } });
  attempts.forEach(a => { const k = key_(a.email); (scores[k] = scores[k] || []).push(Number(a.score || 0)); });
  const rows = students.map(s => {
    const k = key_(s.email);
    const sc = scores[k] || [];
    const sum = sc.reduce((x, y) => x + y, 0);
    const completed = done[k] || 0;
    return { name: String(s.fullName || 'Học viên'), unit: String(s.unit || ''), completed: completed,
             averageScore: sc.length ? Math.round(sum / sc.length) : 0, points: completed * 100 + sum };
  }).sort((a, b) => b.points - a.points || b.completed - a.completed || b.averageScore - a.averageScore)
    .slice(0, 50).map((x, i) => Object.assign({ rank: i + 1 }, x));
  cache.put('LEADERBOARD', JSON.stringify(rows), 60);
  return rows;
}

function getMyHistory(token) {
  const user = verifySession_(token);
  const history = dataRows_(sheet_(SHEETS.EVENTS)).filter(h => sameKey_(h.email, user.email)).slice(-500).reverse();
  return { history: history };
}

/* =========================================================
 * QUẢN TRỊ
 * ========================================================= */

function adminList(token) {
  assertAdmin_(verifySession_(token));
  return {
    students: dataRows_(sheet_(SHEETS.STUDENTS)),
    videos: dataRows_(sheet_(SHEETS.VIDEOS)),
    quizzes: dataRows_(sheet_(SHEETS.QUIZZES)),
    history: dataRows_(sheet_(SHEETS.EVENTS)).slice(-500).reverse()
  };
}

function adminSaveVideo(token, video) {
  const user = verifySession_(token); assertAdmin_(user);
  const v = video || {};
  const id = String(v.videoId || '').trim() || 'VID' + Utilities.getUuid().slice(0, 8).toUpperCase();
  const title = String(v.title || '').trim();
  const youtubeId = extractYoutubeId_(String(v.youtubeId || '').trim());
  if (!title) throw apiError_('Nhập tiêu đề video.');
  if (!youtubeId) throw apiError_('Nhập ID hoặc đường dẫn YouTube hợp lệ.');
  const row = [id, String(v.topic || 'Chưa phân loại'), title, youtubeId, String(v.description || ''), Number(v.sortOrder || 1), v.active !== false, v.quizRequired !== false];
  upsertById_(SHEETS.VIDEOS, id, row);
  return { ok: true, videoId: id };
}

function adminDeleteVideo(token, videoId) {
  assertAdmin_(verifySession_(token));
  deleteById_(SHEETS.VIDEOS, videoId);
  return { ok: true };
}

function adminSaveQuiz(token, quiz) {
  assertAdmin_(verifySession_(token));
  const q = quiz || {};
  const id = String(q.quizId || '').trim() || 'Q' + Utilities.getUuid().slice(0, 8).toUpperCase();
  if (!String(q.videoId || '').trim() || !String(q.question || '').trim()) throw apiError_('Cần chọn video và nhập câu hỏi.');
  const correct = String(q.correctOption || '').trim().toUpperCase();
  if (['A', 'B', 'C', 'D'].indexOf(correct) < 0) throw apiError_('Đáp án đúng phải là A, B, C hoặc D.');
  const row = [id, String(q.videoId), String(q.question), String(q.optionA || ''), String(q.optionB || ''), String(q.optionC || ''), String(q.optionD || ''),
    correct, String(q.explanation || ''), Number(q.sortOrder || 1), q.active !== false];
  upsertById_(SHEETS.QUIZZES, id, row);
  return { ok: true, quizId: id };
}

function adminDeleteQuiz(token, quizId) {
  assertAdmin_(verifySession_(token));
  deleteById_(SHEETS.QUIZZES, quizId);
  return { ok: true };
}

function adminSetStudentActive(token, email, active) {
  assertAdmin_(verifySession_(token));
  const sh = sheet_(SHEETS.STUDENTS), vals = sh.getDataRange().getValues();
  const col = vals[0].map(String).indexOf('active') + 1;
  for (let i = 1; i < vals.length; i++) if (sameKey_(vals[i][0], email)) { sh.getRange(i + 1, col).setValue(Boolean(active)); return { ok: true }; }
  throw apiError_('Không tìm thấy học viên.');
}

/** Thêm học viên mới (hoặc cập nhật theo số điện thoại). */
function adminSaveStudent(token, s) {
  assertAdmin_(verifySession_(token));
  s = s || {};
  const phone = normalizePhone_(s.phone);
  if (!/^0[0-9]{9}$/.test(phone)) throw apiError_('Số điện thoại học viên phải gồm 10 chữ số.');
  const name = String(s.fullName || '').trim();
  if (!name) throw apiError_('Nhập họ tên học viên.');
  const sh = sheet_(SHEETS.STUDENTS), vals = sh.getDataRange().getValues(), h = vals[0].map(String), now = new Date();
  for (let i = 1; i < vals.length; i++) {
    if (normalizePhone_(vals[i][h.indexOf('phone')]) === phone) {
      sh.getRange(i + 1, h.indexOf('fullName') + 1).setValue(name);
      sh.getRange(i + 1, h.indexOf('unit') + 1).setValue(String(s.unit || ''));
      return { ok: true, updated: true };
    }
  }
  const email = String(s.email || '').trim().toLowerCase() || phone;
  appendByHeader_(sh, { email: email, fullName: name, phone: "'" + phone, unit: String(s.unit || ''), createdAt: now, role: 'student', active: true, totalStudySeconds: 0 });
  return { ok: true, created: true };
}

/* =========================================================
 * TIỆN ÍCH DỮ LIỆU
 * ========================================================= */

function upsertStudent_(user) {
  const sh = sheet_(SHEETS.STUDENTS), vals = sh.getDataRange().getValues(), h = vals[0].map(String), now = new Date();
  const c = name => h.indexOf(name) + 1;
  for (let i = 1; i < vals.length; i++) {
    if (sameKey_(vals[i][0], user.email)) {
      if (c('lastSeenAt')) sh.getRange(i + 1, c('lastSeenAt')).setValue(now);
      if (user.role === 'admin') {
        if (c('fullName')) sh.getRange(i + 1, c('fullName')).setValue(CONFIG.ADMIN_NAME);
        if (c('role')) sh.getRange(i + 1, c('role')).setValue('admin');
        if (c('active')) sh.getRange(i + 1, c('active')).setValue(true);
      }
      return;
    }
  }
  appendByHeader_(sh, { email: user.email, fullName: user.name || '', phone: user.phone ? "'" + user.phone : '', unit: user.unit || (user.role === 'admin' ? 'Quản trị hệ thống' : ''),
                        createdAt: now, lastSeenAt: now, role: user.role, active: true, totalStudySeconds: 0, lastStudyAt: '' });
}

function updateStudentStudy_(email, seconds) {
  if (seconds <= 0) return;
  const sh = sheet_(SHEETS.STUDENTS), vals = sh.getDataRange().getValues(), h = vals[0].map(String);
  const t = h.indexOf('totalStudySeconds'), l = h.indexOf('lastStudyAt');
  if (t < 0) return;
  for (let i = 1; i < vals.length; i++) if (sameKey_(vals[i][0], email)) {
    sh.getRange(i + 1, t + 1).setValue(Number(vals[i][t] || 0) + seconds);
    if (l >= 0) sh.getRange(i + 1, l + 1).setValue(new Date());
    return;
  }
}

function logEvent_(email, videoId, eventType, position, duration, score, details) {
  sheet_(SHEETS.EVENTS).appendRow([Utilities.getUuid(), email, String(videoId), eventType, position, duration, score, details, new Date()]);
}

function upsertById_(sheetName, id, row) {
  const sh = sheet_(sheetName), vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) if (String(vals[i][0]) === String(id)) { sh.getRange(i + 1, 1, 1, row.length).setValues([row]); return; }
  sh.appendRow(row);
}
function deleteById_(sheetName, id) {
  const sh = sheet_(sheetName), vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) if (String(vals[i][0]) === String(id)) { sh.deleteRow(i + 1); return; }
}
function appendByHeader_(sh, obj) {
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  sh.appendRow(h.map(k => obj[k] === undefined ? '' : obj[k]));
}

function findVideo_(videoId) { return dataRows_(sheet_(SHEETS.VIDEOS)).find(v => String(v.videoId) === String(videoId)); }

function extractYoutubeId_(input) {
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  const m = input.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}

let SS_CACHE_ = null;
function ss_() { if (!SS_CACHE_) SS_CACHE_ = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID); return SS_CACHE_; }
function sheet_(name) {
  assertConfig_();
  const sh = ss_().getSheetByName(name);
  if (!sh) throw apiError_('Thiếu trang tính ' + name + '. Hãy chạy setup() trước.', 'CONFIG');
  return sh;
}
function optionalSheet_(name) { return ss_().getSheetByName(name); }

function dataRows_(sh) {
  const v = sh.getDataRange().getValues();
  if (v.length < 2) return [];
  const headers = v[0].map(String);
  return v.slice(1).filter(r => r.some(c => c !== '' && c !== null)).map(r => {
    const o = {}; headers.forEach((h, i) => { if (h) o[h] = r[i]; }); return o;
  });
}

/** Chuẩn hoá SĐT: bỏ ký tự lạ, +84/84 → 0, bù số 0 đầu bị Sheet cắt mất. */
function normalizePhone_(value) {
  let p = String(value == null ? '' : value).replace(/\.0+$/, '').replace(/[^0-9]/g, '');
  if (/^84[0-9]{9}$/.test(p)) p = '0' + p.slice(2);
  if (/^[1-9][0-9]{8}$/.test(p)) p = '0' + p;
  return p;
}
function key_(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
function sameKey_(a, b) {
  const x = key_(a), y = key_(b);
  if (x === y) return true;
  const px = normalizePhone_(x), py = normalizePhone_(y);
  return /^0[0-9]{9}$/.test(px) && px === py && x.indexOf('@') < 0 && y.indexOf('@') < 0;
}
function clean_(v) { return String(v == null ? '' : v).trim(); }
function isTrue_(v) { return v === true || String(v).toLowerCase() === 'true' || String(v) === '1'; }
function isFalse_(v) { return v === false || String(v).toLowerCase() === 'false' || String(v) === '0'; }
