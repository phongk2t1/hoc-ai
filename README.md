# Học AI cùng thầy giáo Nguyễn Phong

Nền tảng học AI theo lộ trình video YouTube: kiểm tra hoàn thành modul (10 câu ngẫu nhiên), thi hết môn (30 câu, mỗi chủ đề tối thiểu 2 câu), bảng xếp hạng, nhật ký thi và xuất Excel ma trận điểm 16 modul.

**Kiến trúc**

```
GitHub Pages (index.html, assets/, config.js)  ──fetch JSON──►  Apps Script Web App (apps-script/Code.gs)  ──►  Google Sheet
```

Trang tính sử dụng: `Users`, `Videos`, `Quizzes`, `Progress`, `QuizResults` (giữ nguyên cấu trúc cũ; `QuizResults` đọc được cả dòng cũ chưa có cột ExamType).

## 1. Apps Script (máy chủ API)

1. Thay toàn bộ `Code.gs` bằng `apps-script/Code.gs`. Xoá tệp `Index.html` trong dự án Apps Script (không còn dùng).
2. **Project Settings → Script Properties**:

   | Khoá | Giá trị |
   |---|---|
   | `SPREADSHEET_ID` | ID Google Sheet dữ liệu |
   | `ADMIN_PHONE` | Số điện thoại quản trị viên duy nhất |
   | `ADMIN_PIN` | Mã xác nhận bảo mật quản trị (nếu không có sẽ dùng `ADMIN_PASSWORD`) |

3. Chạy hàm `setup()` một lần, xem nhật ký (Execution log).
4. **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy** (giữ nguyên URL `/exec`).
   Lần đầu: Deploy → New deployment → Web app, Execute as **Me**, Who has access **Anyone**.

## 2. Giao diện

`config.js`: dán URL `/exec` vào `API_URL`. Tuỳ chọn `TEACHER_IMAGE_URL` (ví dụ `assets/teacher.jpg` sau khi tải ảnh lên thư mục `assets/`).

GitHub Pages: **Settings → Pages → Source: GitHub Actions**. Mỗi lần push lên `main` sẽ tự triển khai tới `https://phongk2t1.github.io/hoc-ai/`.

## Bảo mật so với bản Apps Script cũ

- Mọi thao tác dùng **mã phiên** cấp sau khi đăng nhập; trước đây chỉ cần biết số điện thoại quản trị là gọi được `getAdminData` để lấy toàn bộ danh sách học viên.
- **Đáp án chỉ nằm ở máy chủ.** Trước đây mã `token` của mỗi câu là base64 của đáp án đúng, giải mã được ngay trên trình duyệt. Mỗi đề chỉ nộp được một lần.
- Mã PIN quản trị chuyển vào Script Properties (không nằm trong mã nguồn công khai), khoá 15 phút sau 5 lần nhập sai.
- Không cho đăng ký đè lên hồ sơ của số điện thoại đã tồn tại.
- Mọi dữ liệu học viên nhập vào đều được mã hoá ký tự khi hiển thị (chống chèn mã độc vào trang quản trị).
- Khách chưa đăng nhập không nhận được mã video YouTube.

## Bổ sung nhỏ

- Cộng dồn thời gian học (phút) vào `Users.TotalStudyTime` khi video đang phát.
- Quản trị: sửa bài học, lọc nhật ký thi; bài có cột `active = FALSE` trong Videos sẽ bị ẩn.
- Điều kiện đạt tự co giãn khi bài có ít câu hỏi hơn 10 (70%) hoặc ngân hàng ít hơn 30 câu (2/3).

## Chạy thử trên máy

```bash
python3 -m http.server 8080   # mở http://localhost:8080
```
