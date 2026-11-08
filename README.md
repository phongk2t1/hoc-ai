# Học AI mỗi ngày cùng thầy giáo Nguyễn Phong

Nền tảng học AI theo lộ trình video YouTube, có bài kiểm tra sau mỗi bài, bảng xếp hạng, lịch sử học tập và khu quản trị.

**Kiến trúc**

```
GitHub Pages (index.html, assets/, config.js)  ──fetch JSON──►  Google Apps Script Web App (apps-script/Code.gs)  ──►  Google Sheet
         giao diện tĩnh, miễn phí                                         API đăng nhập, tiến độ, bài kiểm tra             dữ liệu cũ giữ nguyên
```

Dữ liệu vẫn nằm trong Google Sheet hiện có (Students, Videos, Quizzes, Progress, Attempts, LearningHistory; bảng `Users` cũ được dùng dự phòng khi đăng nhập).

---

## 1. Cập nhật Apps Script (máy chủ API)

1. Mở dự án tại <https://script.google.com>, thay toàn bộ nội dung `Code.gs` bằng tệp `apps-script/Code.gs` trong repo này.
   Tệp `Index.html` cũ có thể xoá (giao diện đã chuyển sang GitHub).
2. **Project Settings → Script Properties**, thêm:

   | Khoá | Giá trị |
   |---|---|
   | `SPREADSHEET_ID` | ID Google Sheet dữ liệu |
   | `ADMIN_PHONE` | Số điện thoại quản trị viên |
   | `ADMIN_PASSWORD` | Mật khẩu quản trị (≥ 8 ký tự, **bắt buộc**) |
   | `ADMIN_EMAIL` *(tuỳ chọn)* | Email khoá dữ liệu quản trị, mặc định `phongk2t1@gmail.com` |

3. Chạy hàm `setup()` một lần (Run) và cấp quyền. Xem nhật ký để biết trang tính nào còn thiếu cột.
4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Sao chép URL kết thúc bằng `/exec`.

   > Mỗi lần sửa `Code.gs`, vào **Deploy → Manage deployments → ✏ Edit → Version: New version** để giữ nguyên URL.

Mở URL `/exec` trên trình duyệt: thấy `{"ok":true,...,"status":"API đang hoạt động"}` là thành công.

## 2. Cấu hình giao diện

Sửa `config.js`:

```js
API_URL: 'https://script.google.com/macros/s/XXXXXXXX/exec',
TEACHER_IMAGE_URL: 'assets/teacher.jpg',   // tuỳ chọn: đặt ảnh vào thư mục assets/
```

## 3. Bật GitHub Pages

1. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Mỗi lần push lên nhánh `main`, workflow `.github/workflows/pages.yml` tự triển khai.
3. Địa chỉ web: `https://<tên-tài-khoản>.github.io/<tên-repo>/`

## 4. Chạy thử trên máy

```bash
python3 -m http.server 8080
# mở http://localhost:8080
```

## Đăng nhập

- **Học viên**: nhập số điện thoại đã có trong bảng Students (hoặc Users).
- **Quản trị viên**: nhập số `ADMIN_PHONE`, ô mật khẩu sẽ hiện ra → nhập `ADMIN_PASSWORD`. Sai 5 lần sẽ khoá 15 phút.
- Phiên đăng nhập lưu trong tab trình duyệt, tự gia hạn khi đang học (tối đa 6 giờ không hoạt động).

## Thay đổi so với bản Apps Script cũ

- Giao diện tách khỏi Apps Script, chạy trên GitHub Pages; Apps Script chỉ còn là API JSON (`doPost`).
- **Bảo mật quản trị**: trước đây chỉ cần nhập đúng số điện thoại quản trị (được in công khai trên trang) là vào được quyền admin. Nay bắt buộc thêm mật khẩu lưu trong Script Properties.
- ID Sheet, SĐT quản trị không còn nằm trong mã nguồn công khai.
- Đáp án/giải thích chỉ gửi về sau khi nộp bài; tỉ lệ xem video do máy chủ kiểm soát.
- Bảng xếp hạng không còn trả email học viên ra trình duyệt.
- Quản trị: thêm quản lý câu hỏi kiểm tra, thêm học viên, khoá/mở khoá học viên.
- Chuẩn hoá số điện thoại bị Google Sheet cắt mất số 0 đầu (ví dụ `905609111` → `0905609111`).
- Ghi dữ liệu có khoá (`LockService`) để tránh ghi đè khi nhiều học viên học cùng lúc.

## Triển khai Apps Script bằng clasp (tuỳ chọn)

```bash
npm i -g @google/clasp && clasp login
cd apps-script && cp .clasp.json.example .clasp.json   # điền scriptId (Project Settings → IDs)
clasp push && clasp deploy -i <DEPLOYMENT_ID>
```
