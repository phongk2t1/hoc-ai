/**
 * HỆ THỐNG HỌC AI CÙNG THẦY GIÁO NGUYỄN PHONG
 * Google Apps Script — API JSON cho giao diện chạy trên GitHub Pages.
 * Copyright © 2026 Nguyễn Phong
 *
 * CẤU HÌNH (Project Settings → Script Properties):
 *   SPREADSHEET_ID  ID Google Sheet dữ liệu
 *   ADMIN_PHONE     Số điện thoại quản trị viên duy nhất
 *   ADMIN_PIN       Mã xác nhận bảo mật của quản trị viên
 *                   (nếu chưa có ADMIN_PIN thì dùng ADMIN_PASSWORD)
 *
 * TRIỂN KHAI: Deploy → Manage deployments → Edit → Version: New version
 *   (Execute as: Me · Who has access: Anyone) — giữ nguyên URL /exec.
 */

const PROPS = PropertiesService.getScriptProperties();
function prop_(key, fallback) {
  const v = PROPS.getProperty(key);
  return v === null || v === '' ? fallback : v;
}

const CONFIG = {
  SPREADSHEET_ID: prop_('SPREADSHEET_ID', ''),
  ADMIN_PHONE: prop_('ADMIN_PHONE', ''),
  APP_NAME: 'Học AI Cùng Thầy Giáo Nguyễn Phong',
  SESSION_PREFIX: 'HOCAI_SESSION_',
  EXAM_PREFIX: 'HOCAI_EXAM_',
  TTL: 21600,              // 6 giờ — tối đa của CacheService
  MODULE_QUESTIONS: 10,
  FINAL_QUESTIONS: 30,
  FINAL_PER_TOPIC: 2,
  MODULE_PASS: 7,          // đạt từ 7/10 câu
  FINAL_PASS: 20,          // đạt từ 20/30 câu
  STANDARD_MODULES: 16
};

/* =========================================================
 * HTTP
 * ========================================================= */

const API = {
  ping:              ()  => ({ appName: CONFIG.APP_NAME, time: new Date() }),
  authenticate:      (a) => authenticate(a[0], a[1]),
  register:          (a) => register(a[0], a[1]),
  resume:            (a) => resume(a[0]),
  logout:            (a) => logout(a[0]),
  updateProfile:     (a) => updateProfile(a[0], a[1]),
  getCourseData:     (a) => getCourseData(a[0]),
  saveProgress:      (a) => saveProgress(a[0], a[1], a[2], a[3]),
  getModuleExam:     (a) => getModuleExam(a[0], a[1]),
  getFinalExam:      (a) => getFinalExam(a[0]),
  submitExam:        (a) => submitExam(a[0], a[1], a[2]),
  getLeaderboard:    (a) => getLeaderboard(a[0]),
  getAdminData:      (a) => getAdminData(a[0]),
  getMasterMatrix:   (a) => getMasterMatrix(a[0]),
  saveVideoAdmin:    (a) => saveVideoAdmin(a[0], a[1]),
  deleteVideoAdmin:  (a) => deleteVideoAdmin(a[0], a[1])
};

/** Giao diện gửi POST text/plain (tránh CORS preflight): { action, args: [...] } */
function doPost(e) {
  let out;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = API[body.action];
    if (!fn) throw apiError_('Yêu cầu không hợp lệ.', 'BAD_ACTION');
    out = { ok: true, data: fn(Array.isArray(body.args) ? body.args : []) };
  } catch (err) {
    out = { ok: false, error: (err && err.message) || String(err), code: (err && err.code) || '' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, data: { appName: CONFIG.APP_NAME, status: 'API đang hoạt động', time: new Date() } }))
    .setMimeType(ContentService.MimeType.JSON);
}

function apiError_(message, code) { const e = new Error(message); e.code = code || ''; return e; }

/* =========================================================
 * CƠ SỞ DỮ LIỆU
 * ========================================================= */

let DB_ = null;
function getDb() {
  if (!CONFIG.SPREADSHEET_ID) throw apiError_('Máy chủ chưa cấu hình SPREADSHEET_ID (Script Properties).', 'CONFIG');
  if (!DB_) DB_ = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  return DB_;
}
function videoSheet_() { const db = getDb(); return db.getSheetByName('Videos') || db.getSheets()[0]; }

function ensureSheetsExist() {
  const db = getDb();
  const defs = {
    Users: ['Phone', 'FullName', 'Unit', 'Email', 'RegisterDate', 'TotalStudyTime'],
    Progress: ['Phone', 'VideoID', 'Completed', 'QuizPassed', 'LastStoppedSeconds', 'LastStudyDate'],
    QuizResults: ['Phone', 'FullName', 'Unit', 'ExamType', 'VideoID', 'Attempt', 'CorrectCount', 'TotalQuestions', 'Score', 'Status', 'ExamTime']
  };
  Object.keys(defs).forEach(name => {
    if (!db.getSheetByName(name)) {
      const sh = db.insertSheet(name);
      sh.appendRow(defs[name]);
      sh.getRange('A:A').setNumberFormat('@');
    }
  });
}

/** Chạy tay một lần trong trình soạn thảo để kiểm tra cấu hình. */
function setup() {
  ensureSheetsExist();
  const msg = [];
  if (!CONFIG.ADMIN_PHONE) msg.push('Thiếu ADMIN_PHONE');
  if (!adminPin_()) msg.push('Thiếu ADMIN_PIN');
  if (!getDb().getSheetByName('Quizzes')) msg.push('Thiếu trang tính Quizzes');
  Logger.log(msg.length ? 'Cần bổ sung: ' + msg.join('; ') : 'Cấu hình đầy đủ.');
}

function formatPhone(phone) {
  if (phone === null || phone === undefined) return '';
  let str = String(phone).replace(/\.0+$/, '').replace(/\D/g, '').trim();
  if (/^84\d{9}$/.test(str)) str = '0' + str.slice(2);
  if (str.length === 9) str = '0' + str;
  return str;
}
function checkIsAdmin(phone) { return !!CONFIG.ADMIN_PHONE && formatPhone(phone) === formatPhone(CONFIG.ADMIN_PHONE); }
function isTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function nowStr_() { return Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd HH:mm:ss'); }
function fmtDate_(v, pattern) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? String(v) : Utilities.formatDate(d, 'GMT+7', pattern || 'yyyy-MM-dd HH:mm:ss');
}
function shuffle_(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
function extractYoutubeId_(raw) {
  const s = String(raw || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|shorts\/|live\/|watch\?v=|&v=)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : s;
}

function findUser_(phone) {
  const sh = getDb().getSheetByName('Users');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (formatPhone(data[i][0]) === phone) {
      return { row: i + 1, phone: phone, fullName: String(data[i][1] || ''), unit: String(data[i][2] || ''), email: String(data[i][3] || ''), studyTime: Number(data[i][5]) || 0 };
    }
  }
  return null;
}

/* =========================================================
 * PHIÊN ĐĂNG NHẬP
 * ========================================================= */

function adminPin_() { return prop_('ADMIN_PIN', prop_('ADMIN_PASSWORD', '')); }

/** Khoá xác thực quản trị 15 phút sau 5 lần nhập sai mã. */
function checkAdminPin_(pin) {
  const expected = adminPin_();
  if (!expected) throw apiError_('Máy chủ chưa đặt ADMIN_PIN trong Script Properties.', 'CONFIG');
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('HOCAI_PIN_FAILS') || 0);
  if (fails >= 5) throw apiError_('Đăng nhập quản trị tạm khoá 15 phút do nhập sai nhiều lần.', 'ADMIN_LOCKED');
  if (!pin) return false;
  if (String(pin).trim() !== String(expected)) {
    cache.put('HOCAI_PIN_FAILS', String(fails + 1), 900);
    throw apiError_('Mã xác nhận không chính xác! Vui lòng thử lại.', 'BAD_PIN');
  }
  cache.remove('HOCAI_PIN_FAILS');
  return true;
}

function createSession_(user, isAdmin) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const s = { phone: user.phone, fullName: user.fullName, unit: user.unit, email: user.email || '', isAdmin: !!isAdmin };
  CacheService.getScriptCache().put(CONFIG.SESSION_PREFIX + token, JSON.stringify(s), CONFIG.TTL);
  return { token: token, user: s };
}

function session_(token) {
  const t = String(token || '').trim();
  if (!t) throw apiError_('Vui lòng đăng nhập để tiếp tục.', 'SESSION');
  const cache = CacheService.getScriptCache();
  const raw = cache.get(CONFIG.SESSION_PREFIX + t);
  if (!raw) throw apiError_('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'SESSION');
  cache.put(CONFIG.SESSION_PREFIX + t, raw, CONFIG.TTL); // gia hạn khi còn hoạt động
  const s = JSON.parse(raw);
  s.token = t;
  return s;
}
function adminSession_(token) {
  const s = session_(token);
  if (!s.isAdmin || !checkIsAdmin(s.phone)) throw apiError_('Truy cập trái phép!', 'FORBIDDEN');
  return s;
}

/** 1. Xác thực học viên & quản trị viên */
function authenticate(phoneInput, adminPin) {
  ensureSheetsExist();
  const phone = formatPhone(phoneInput);
  if (!/^0\d{9}$/.test(phone)) throw apiError_('Vui lòng nhập số điện thoại hợp lệ (10 chữ số).', 'BAD_PHONE');
  const isAdmin = checkIsAdmin(phone);
  if (isAdmin && !checkAdminPin_(adminPin)) {
    return { exists: true, requirePin: true, phone: phone, message: 'Yêu cầu nhập mã xác nhận bảo mật của Quản trị viên!' };
  }
  const user = findUser_(phone);
  if (!user) return { exists: false, requirePin: false, phone: phone };
  const ses = createSession_(user, isAdmin);
  return { exists: true, requirePin: false, token: ses.token, user: ses.user };
}

/** 2. Đăng ký học viên mới (không cho ghi đè hồ sơ đã có). */
function register(userData, adminPin) {
  ensureSheetsExist();
  userData = userData || {};
  const phone = formatPhone(userData.phone);
  if (!/^0\d{9}$/.test(phone)) throw apiError_('Số điện thoại không hợp lệ.', 'BAD_PHONE');
  const fullName = String(userData.fullName || '').trim().slice(0, 100);
  const unit = String(userData.unit || '').trim().slice(0, 200);
  const email = String(userData.email || '').trim().slice(0, 100);
  if (!fullName || !unit) throw apiError_('Vui lòng điền họ tên và đơn vị!', 'BAD_INPUT');
  const isAdmin = checkIsAdmin(phone);
  if (isAdmin && !checkAdminPin_(adminPin)) throw apiError_('Yêu cầu mã xác nhận của Quản trị viên.', 'BAD_PIN');

  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  let user;
  try {
    user = findUser_(phone);
    if (!user) {
      getDb().getSheetByName('Users').appendRow(["'" + phone, fullName, unit, email, nowStr_(), 0]);
      user = { phone: phone, fullName: fullName, unit: unit, email: email };
    }
  } finally { lock.releaseLock(); }
  const ses = createSession_(user, isAdmin);
  return { exists: true, token: ses.token, user: ses.user };
}

/** Học viên tự sửa họ tên, đơn vị, email (không đổi được số điện thoại). */
function updateProfile(token, data) {
  const s = session_(token);
  data = data || {};
  const fullName = String(data.fullName || '').trim().slice(0, 100);
  const unit = String(data.unit || '').trim().slice(0, 200);
  const email = String(data.email || '').trim().slice(0, 100);
  if (!fullName || !unit) throw apiError_('Vui lòng điền họ tên và đơn vị công tác.', 'BAD_INPUT');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw apiError_('Email không hợp lệ.', 'BAD_INPUT');
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const u = findUser_(s.phone);
    if (!u) throw apiError_('Không tìm thấy hồ sơ học viên.', 'NOT_FOUND');
    getDb().getSheetByName('Users').getRange(u.row, 2, 1, 3).setValues([[fullName, unit, email]]);
  } finally { lock.releaseLock(); }
  const user = { phone: s.phone, fullName: fullName, unit: unit, email: email, isAdmin: !!s.isAdmin };
  CacheService.getScriptCache().put(CONFIG.SESSION_PREFIX + s.token, JSON.stringify(user), CONFIG.TTL);
  return { user: user };
}

function resume(token) { const s = session_(token); return { token: s.token, user: { phone: s.phone, fullName: s.fullName, unit: s.unit, email: s.email, isAdmin: s.isAdmin } }; }
function logout(token) { if (token) CacheService.getScriptCache().remove(CONFIG.SESSION_PREFIX + String(token)); return true; }

/* =========================================================
 * BÀI HỌC & TIẾN ĐỘ
 * ========================================================= */

/** 3. Danh sách bài học (khách xem tên bài; chỉ người đăng nhập mới nhận mã video). */
function getCourseData(token) {
  let s = null;
  if (token) { try { s = session_(token); } catch (e) { s = null; } }
  const vData = videoSheet_().getDataRange().getValues();
  const progressMap = {};
  if (s) {
    const pSheet = getDb().getSheetByName('Progress');
    const pData = pSheet ? pSheet.getDataRange().getValues() : [];
    for (let i = 1; i < pData.length; i++) {
      if (formatPhone(pData[i][0]) === s.phone) {
        progressMap[String(pData[i][1]).trim()] = { completed: isTrue_(pData[i][2]), stoppedSec: Number(pData[i][4]) || 0 };
      }
    }
  }
  const videos = [];
  for (let i = 1; i < vData.length; i++) {
    const id = String(vData[i][0]).trim();
    if (!id) continue;
    if (vData[i][6] === false || String(vData[i][6]).toUpperCase() === 'FALSE') continue; // bài đang ẩn
    const p = progressMap[id] || { completed: false, stoppedSec: 0 };
    videos.push({
      id: id,
      category: String(vData[i][1] || 'Khóa học AI').trim(),
      title: String(vData[i][2] || vData[i][1]).trim(),
      order: Number(vData[i][5]) || i,
      youtubeId: s ? extractYoutubeId_(vData[i][3]) : '',
      completed: p.completed,
      resumeTime: p.stoppedSec
    });
  }
  videos.sort((a, b) => a.order - b.order);
  return { videos: videos, isAdmin: !!(s && s.isAdmin), loggedIn: !!s };
}

/** Lưu điểm dừng video và cộng dồn thời gian học (phút) vào Users.TotalStudyTime. */
function saveProgress(token, videoId, currentSeconds, playing) {
  const s = session_(token);
  const vid = String(videoId || '').trim();
  if (!vid) return false;
  const sec = Math.max(0, Math.floor(Number(currentSeconds) || 0));
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const pSheet = getDb().getSheetByName('Progress');
    const pData = pSheet.getDataRange().getValues();
    let found = false;
    for (let i = 1; i < pData.length; i++) {
      if (formatPhone(pData[i][0]) === s.phone && String(pData[i][1]).trim() === vid) {
        if (!isTrue_(pData[i][2])) pSheet.getRange(i + 1, 5).setValue(sec);
        pSheet.getRange(i + 1, 6).setValue(new Date());
        found = true; break;
      }
    }
    if (!found) pSheet.appendRow(["'" + s.phone, vid, false, false, sec, new Date()]);

    if (playing) {
      const cache = CacheService.getScriptCache(), k = 'HOCAI_BEAT_' + s.token;
      const last = Number(cache.get(k) || 0), now = Date.now();
      cache.put(k, String(now), 3600);
      if (last) {
        const minutes = Math.min(now - last, 30000) / 60000;
        const u = findUser_(s.phone);
        if (u && minutes > 0) getDb().getSheetByName('Users').getRange(u.row, 6).setValue(Math.round((u.studyTime + minutes) * 100) / 100);
      }
    }
  } finally { lock.releaseLock(); }
  return true;
}

/* =========================================================
 * THI TRẮC NGHIỆM — đáp án chỉ lưu ở máy chủ
 * ========================================================= */

function readQuestions_() {
  const qSheet = getDb().getSheetByName('Quizzes');
  if (!qSheet) throw apiError_('Chưa tìm thấy Sheet [Quizzes]!', 'CONFIG');
  const data = qSheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < data.length; i++) {
    const vId = String(data[i][1]).trim();
    if (!vId || !isTrue_(data[i][10])) continue;
    const correctChar = String(data[i][7]).trim().toUpperCase();
    const options = ['A', 'B', 'C', 'D'].map((L, k) => ({ text: String(data[i][3 + k] || ''), isCorrect: correctChar === L }))
      .filter(o => o.text.trim() !== '');
    if (!options.some(o => o.isCorrect)) continue;
    list.push({ quizId: String(data[i][0]), videoId: vId, question: String(data[i][2]), options: options, explanation: String(data[i][8] || '') });
  }
  return list;
}

/** Xáo đề, lưu đáp án vào bộ nhớ đệm máy chủ, chỉ gửi câu hỏi + phương án. */
function buildExam_(s, type, videoId, questions) {
  const key = {}, exp = {};
  const client = questions.map((q, idx) => {
    const opts = shuffle_(q.options.slice());
    key[q.quizId] = opts.findIndex(o => o.isCorrect);
    exp[q.quizId] = q.explanation;
    return { qIndex: idx + 1, quizId: q.quizId, question: q.question, options: opts.map(o => o.text) };
  });
  const examId = Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put(CONFIG.EXAM_PREFIX + examId,
    JSON.stringify({ phone: s.phone, type: type, videoId: videoId, key: key, exp: exp }), CONFIG.TTL);
  return { success: true, examId: examId, questions: client, totalQuestions: client.length };
}

/** 4. Kiểm tra modul: ngẫu nhiên tối đa 10 câu của bài học. */
function getModuleExam(token, videoId) {
  const s = session_(token);
  const vid = String(videoId || '').trim();
  const pool = shuffle_(readQuestions_().filter(q => q.videoId === vid));
  if (!pool.length) return { success: false, message: 'Chưa có câu hỏi trắc nghiệm cho bài học này!' };
  return buildExam_(s, 'MODUL', vid, pool.slice(0, CONFIG.MODULE_QUESTIONS));
}

/** 5. Thi hết môn: 30 câu, mỗi chủ đề tối thiểu 2 câu. */
function getFinalExam(token) {
  const s = session_(token);
  const topicMap = {};
  readQuestions_().forEach(q => (topicMap[q.videoId] = topicMap[q.videoId] || []).push(q));
  const selected = [], rest = [];
  Object.keys(topicMap).forEach(v => {
    const list = shuffle_(topicMap[v]);
    const n = Math.min(CONFIG.FINAL_PER_TOPIC, list.length);
    selected.push.apply(selected, list.slice(0, n));
    rest.push.apply(rest, list.slice(n));
  });
  shuffle_(rest);
  while (selected.length < CONFIG.FINAL_QUESTIONS && rest.length) selected.push(rest.shift());
  if (!selected.length) return { success: false, message: 'Ngân hàng câu hỏi đang trống!' };
  return buildExam_(s, 'FINAL', 'TOAN_KHOA', shuffle_(selected).slice(0, CONFIG.FINAL_QUESTIONS));
}

/** 6. Chấm bài. answers = { quizId: chỉ số phương án đã chọn } */
function submitExam(token, examId, answers) {
  const s = session_(token);
  const cache = CacheService.getScriptCache();
  const raw = cache.get(CONFIG.EXAM_PREFIX + String(examId || ''));
  if (!raw) throw apiError_('Đề thi đã hết hạn hoặc đã được nộp. Vui lòng làm lại đề mới.', 'EXAM_EXPIRED');
  const exam = JSON.parse(raw);
  if (exam.phone !== s.phone) throw apiError_('Đề thi không thuộc tài khoản này.', 'FORBIDDEN');
  cache.remove(CONFIG.EXAM_PREFIX + examId); // mỗi đề chỉ nộp một lần

  answers = answers || {};
  const ids = Object.keys(exam.key);
  const total = ids.length;
  let correctCount = 0;
  const detailedFeedback = {};
  ids.forEach(id => {
    const sel = answers[id] === undefined || answers[id] === null || answers[id] === '' ? -1 : Number(answers[id]);
    const right = sel === exam.key[id];
    if (right) correctCount++;
    detailedFeedback[id] = { isRight: right, userSelected: sel, correctIndex: exam.key[id], explanation: exam.exp[id] || '' };
  });
  const score = Number(((correctCount / total) * 10).toFixed(1));
  const need = exam.type === 'FINAL' ? Math.min(CONFIG.FINAL_PASS, Math.ceil(total * 2 / 3)) : Math.min(CONFIG.MODULE_PASS, Math.ceil(total * 0.7));
  const isPassed = correctCount >= need;

  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  let attempt = 1;
  try {
    const db = getDb();
    const u = findUser_(s.phone) || { fullName: s.fullName || 'Học viên', unit: s.unit || '' };
    const rSheet = db.getSheetByName('QuizResults');
    readResults_().forEach(r => {
      if (r.phone === s.phone && r.examType === exam.type && r.videoId === exam.videoId) attempt = Math.max(attempt, r.attempt + 1);
    });
    rSheet.appendRow(["'" + s.phone, u.fullName, u.unit, exam.type, exam.videoId, attempt, correctCount, total, score, isPassed ? 'ĐẠT' : 'CHƯA ĐẠT', nowStr_()]);

    if (exam.type === 'MODUL' && isPassed) {
      const pSheet = db.getSheetByName('Progress');
      const pData = pSheet.getDataRange().getValues();
      let found = false;
      for (let k = 1; k < pData.length; k++) {
        if (formatPhone(pData[k][0]) === s.phone && String(pData[k][1]).trim() === exam.videoId) {
          pSheet.getRange(k + 1, 3, 1, 4).setValues([[true, true, 0, new Date()]]);
          found = true; break;
        }
      }
      if (!found) pSheet.appendRow(["'" + s.phone, exam.videoId, true, true, 0, new Date()]);
    }
  } finally { lock.releaseLock(); }

  return { success: true, examType: exam.type, passed: isPassed, need: need, correctCount: correctCount, total: total, score: score, attempt: attempt, detailedFeedback: detailedFeedback };
}

/**
 * Đọc QuizResults, chấp nhận cả dữ liệu cũ (10 cột, chưa có ExamType)
 * và dữ liệu mới (11 cột, có ExamType ở cột D).
 */
function readResults_() {
  const sh = getDb().getSheetByName('QuizResults');
  if (!sh) return [];
  const data = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const t = String(r[3]).trim().toUpperCase();
    const isNew = t === 'MODUL' || t === 'FINAL';
    const o = isNew ? 0 : -1; // dữ liệu cũ lệch trái 1 cột
    const phone = formatPhone(r[0]);
    if (!phone) continue;
    out.push({
      phone: phone, fullName: String(r[1] || ''), unit: String(r[2] || ''),
      examType: isNew ? t : 'MODUL', videoId: String(r[4 + o] || '').trim(), attempt: Number(r[5 + o]) || 1,
      correctCount: r[6 + o], totalQuestions: r[7 + o], score: Number(r[8 + o]) || 0, status: String(r[9 + o] || ''), examTime: r[10 + o]
    });
  }
  return out;
}

/* =========================================================
 * BẢNG XẾP HẠNG & QUẢN TRỊ
 * ========================================================= */

/** 7. Bảng xếp hạng (top 10) */
function getLeaderboard(token) {
  session_(token);
  const db = getDb();
  const pData = db.getSheetByName('Progress').getDataRange().getValues();
  const uData = db.getSheetByName('Users').getDataRange().getValues();
  const counts = {};
  for (let i = 1; i < pData.length; i++) if (isTrue_(pData[i][2])) { const p = formatPhone(pData[i][0]); counts[p] = (counts[p] || 0) + 1; }
  const rows = [];
  for (let j = 1; j < uData.length; j++) {
    const p = formatPhone(uData[j][0]);
    if (!p || checkIsAdmin(p)) continue;
    rows.push({ fullName: String(uData[j][1] || ''), unit: String(uData[j][2] || ''), completedCount: counts[p] || 0, studyTime: Number(uData[j][5]) || 0 });
  }
  rows.sort((a, b) => b.completedCount - a.completedCount || b.studyTime - a.studyTime);
  return rows.slice(0, 10);
}

/** 8. Ma trận 16 modul + thi hết môn để xuất Excel */
function getMasterMatrix(token) {
  adminSession_(token);
  const db = getDb();
  const uData = db.getSheetByName('Users').getDataRange().getValues();
  const vData = videoSheet_().getDataRange().getValues();
  const modules = [];
  vData.slice(1).sort((a, b) => (Number(a[5]) || 0) - (Number(b[5]) || 0)).forEach(r => {
    const id = String(r[0]).trim(); if (id && modules.indexOf(id) < 0) modules.push(id);
  });
  const standard = modules.slice(0, CONFIG.STANDARD_MODULES);
  const map = {};
  readResults_().forEach(r => {
    const m = map[r.phone] = map[r.phone] || { modules: {}, finalScore: '', finalExamTime: '' };
    if (r.examType === 'MODUL') { if (m.modules[r.videoId] === undefined || r.score > m.modules[r.videoId]) m.modules[r.videoId] = r.score; }
    else if (r.examType === 'FINAL') {
      if (m.finalScore === '' || r.score >= m.finalScore) { m.finalScore = r.score; m.finalExamTime = fmtDate_(r.examTime); }
    }
  });
  const rows = [];
  let stt = 1;
  for (let i = 1; i < uData.length; i++) {
    const phone = formatPhone(uData[i][0]);
    if (!phone) continue;
    const info = map[phone] || { modules: {}, finalScore: '', finalExamTime: '' };
    rows.push({
      stt: stt++, phone: phone, fullName: String(uData[i][1] || ''), unit: String(uData[i][2] || ''),
      moduleScores: standard.map(id => info.modules[id] !== undefined ? info.modules[id] : ''),
      finalScore: info.finalScore, firstLogin: fmtDate_(uData[i][4]), finalExamTime: info.finalExamTime
    });
  }
  return { moduleHeaders: standard, rows: rows };
}

/** 9. Dữ liệu trang quản trị */
function getAdminData(token) {
  adminSession_(token);
  const db = getDb();
  const uData = db.getSheetByName('Users').getDataRange().getValues();
  const vData = videoSheet_().getDataRange().getValues();
  const users = [];
  for (let i = 1; i < uData.length; i++) {
    const phone = formatPhone(uData[i][0]);
    if (!phone) continue;
    users.push({ phone: phone, fullName: String(uData[i][1] || ''), unit: String(uData[i][2] || ''), email: String(uData[i][3] || ''),
                 registerDate: fmtDate_(uData[i][4], 'dd/MM/yyyy HH:mm'), totalStudyTime: Math.round(Number(uData[i][5]) || 0) });
  }
  const videos = [];
  for (let j = 1; j < vData.length; j++) {
    if (!String(vData[j][0]).trim()) continue;
    videos.push({ id: String(vData[j][0]), category: String(vData[j][1] || '').trim(), title: String(vData[j][2] || '').trim(),
                  youtubeKey: String(vData[j][3] || ''), order: Number(vData[j][5]) || j, active: !(vData[j][6] === false || String(vData[j][6]).toUpperCase() === 'FALSE') });
  }
  videos.sort((a, b) => a.order - b.order);
  const results = readResults_().reverse().map(r => Object.assign({}, r, { examTime: fmtDate_(r.examTime, 'dd/MM/yyyy HH:mm') }));
  return { users: users, videos: videos, results: results };
}

function saveVideoAdmin(token, video) {
  adminSession_(token);
  video = video || {};
  const title = String(video.title || '').trim();
  const ytKey = extractYoutubeId_(video.youtubeKey);
  if (!title || !ytKey) throw apiError_('Vui lòng điền đủ tên bài học và link YouTube!', 'BAD_INPUT');
  const sheet = videoSheet_();
  const data = sheet.getDataRange().getValues();
  const id = String(video.id || '').trim();
  for (let i = 1; id && i < data.length; i++) {
    if (String(data[i][0]) === id) {
      sheet.getRange(i + 1, 2, 1, 3).setValues([[String(video.category || ''), title, ytKey]]);
      sheet.getRange(i + 1, 6).setValue(Number(video.order) || i);
      return { id: id, updated: true };
    }
  }
  let max = 0;
  data.forEach(r => { const m = String(r[0]).match(/^VID(\d+)$/); if (m) max = Math.max(max, Number(m[1])); });
  const newId = 'VID' + String(max + 1).padStart(3, '0');
  sheet.appendRow([newId, String(video.category || ''), title, ytKey, title, Number(video.order) || data.length, true, true]);
  return { id: newId, created: true };
}

function deleteVideoAdmin(token, videoId) {
  adminSession_(token);
  const sheet = videoSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(videoId)) { sheet.deleteRow(i + 1); return true; }
  }
  return false;
}
