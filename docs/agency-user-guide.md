# Hướng dẫn sử dụng cho Agency

Dành cho **admin của một agency** (môi giới bất động sản). Cách dùng hệ thống chat AI để tiếp nhận, tư vấn, chốt khách (lead) — trên website và Telegram.

> Không cần biết kỹ thuật. Tài liệu này chỉ nói về thao tác sử dụng.

---

## 1. Hệ thống làm gì

- Khách vào website agency, mở một bất động sản → **chat với trợ lý AI**. AI tự trả lời về căn nhà, hỏi nhu cầu (ngân sách, thời gian, tài chính…), đề xuất & đặt lịch xem nhà — **tự động 24/7**.
- Khi cần con người (vd khách đòi giảm giá), hệ thống **báo cho bạn** (handoff) và bạn vào xử lý.
- Bạn theo dõi & điều khiển ở hai nơi: **trang quản trị web** và **Telegram**.

---

## 2. Đăng nhập trang quản trị

1. Mở: `https://<tên-agency>.<tên-miền>/admin`
2. Đăng nhập bằng email + mật khẩu được cấp.

6 mục (tab):

| Tab | Dùng để |
|-----|---------|
| **Assistant** | Chat với trợ lý AI của bạn (hỏi "lead nào nóng nhất?", ra lệnh "thêm tiêu chí…") |
| **Agents** | Xem/cấu hình agent |
| **Tableau de bord** | Tổng quan: số lead, lead cần xử lý (handoff), lịch hẹn |
| **Conversations** | Hội thoại với khách — nơi bạn rep trực tiếp khách |
| **Biens** | Quản lý bất động sản: thêm/sửa/xóa, upload ảnh |
| **Configuration** | Tiêu chí qualify + quy tắc handoff + thông tin agency |

---

## 3. Thiết lập ban đầu (làm 1 lần)

### 3.1. Thêm bất động sản (tab **Biens**)
Bấm **"Ajouter un bien"** → điền tiêu đề, địa chỉ, giá, diện tích, số phòng, tầng, mô tả + upload ảnh (≤ 5 MB). Khách sẽ thấy trên website và AI tư vấn dựa trên đó.

### 3.2. Cấu hình qualify + handoff (tab **Configuration**)
- **Critères de qualification:** thông tin AI cần thu thập (ngân sách, tài chính, thời gian…).
- **Règles de handoff:** từ khóa/tình huống khiến AI **dừng tự trả lời và báo bạn** (vd "thương lượng giá").

> Mẹo: không cần thao tác form — gõ tự nhiên cho trợ lý (tab **Assistant** trên web, hoặc topic **🛠 Master** trên Telegram), vd "ajoute un critère quartier préféré". Xem §5.6. Thay đổi áp dụng ngay, web tự cập nhật.

---

## 4. Luồng hằng ngày

1. Khách mở bất động sản → chat với AI.
2. AI tư vấn, qualify, đề xuất & đặt lịch xem nhà (cần email khách để đặt).
3. Bạn theo dõi ở tab **Conversations** (web) và trong group Telegram.

### Khi handoff kích hoạt
- AI **ngừng tự trả lời**, hội thoại chuyển **chế độ thủ công**.
- Bạn nhận **thông báo** (web + Telegram group).
- Bạn rep khách (xem §5 và §6).

---

## 5. Kết nối Telegram (khuyến nghị)

Theo dõi & xử lý khách ngay trên điện thoại.

### 5.1. Chuẩn bị nhóm (làm 1 lần)
1. Tạo một **nhóm (supergroup)** Telegram cho agency.
2. Settings → **bật Topics** (chủ đề).
3. Thêm bot của hệ thống vào nhóm (tên bot do bên cung cấp đưa).
4. **Phong bot làm Admin**, bật quyền **Manage Topics**.

### 5.2. Liên kết nhóm với agency (làm 1 lần)

**Cách 1: Auto-bind (tự động, nên dùng)**
1. Ai đó **có quyền Admin trong nhóm** → go to bot settings → nhấn "Promote" hoặc tương đương để grant admin.
   - **Điều kiện:** người đó phải **đã link Telegram tại web `/admin`** từ trước (nếu chưa thì dùng Cách 2).
2. Bot tự động nhận diện, xác nhận agency, tạo topic **🛠 Master**.

**Cách 2: Fallback (/link token)**
1. Web `/admin` → bấm **"Lier Telegram"** → nhận dòng `/link <mã>`.
2. **Dán `/link <mã>` vào nhóm Telegram.**
3. Bot xác nhận "✅ đã liên kết" và tự tạo topic **🛠 Master**.

### 5.3. Chỉ 1 topic 🛠 Master (new flow)

Nhóm giờ có **1 topic 🛠 Master duy nhất** (chung cho cả agency, không per-lead). Tất cả tin khách đều route vào đây qua agent.

**Cách rep khách (2 cách):**

**Cách A — qua Web (recommended):**
- Web `/admin` → tab **Conversations** → mở hội thoại → rep trực tiếp.
- Tin tới khách hiện luôn trong Master topic (icon 🤖 Agent).

**Cách B — qua Telegram:**
- Nhắn lệnh vào Master topic, ví dụ:
  > `/lead_history <lead_id>` — xem chat với khách
  > "Gửi tin: Em xác nhận lịch xem nhà thứ 7 15h."
- Agent xử lý + gửi tới khách.

### 5.5. Trả quyền cho AI
Sau khi xử lý xong, vào tab **Conversations** trên web → nút trả về chế độ agent (release). AI tiếp tục tự động.

### 5.6. Topic 🛠 Master — cấu hình agency bằng chat

Trong nhóm có thêm **1 topic 🛠 Master** (chung cho cả agency, không gắn với khách nào). Nhắn vào đây để **cấu hình toàn bộ agency bằng ngôn ngữ tự nhiên** — thay đổi áp dụng ngay vào DB và **web admin tự cập nhật** (không cần reload).

Ví dụ nhắn trong topic 🛠 Master:

| Bạn nhắn | Hệ thống làm |
|----------|--------------|
| "Thêm tiêu chí khu vực ưa thích" | Cập nhật tiêu chí qualify |
| "Đổi tone sang thân thiện hơn" | Đổi giọng điệu agency |
| "Tạo rule: khi khách hỏi trả góp thì báo tư vấn viên" | Thêm quy tắc handoff |
| "Tắt rule thương lượng giá" | Bật/tắt rule |
| "Sửa giá căn Marais thành 950000" | Cập nhật listing |
| "Xóa listing vincennes-maison" | Xóa listing (chỉ của agency mình) |
| Dán danh sách nhiều BĐS (tiêu đề, giá, diện tích…) | **Import hàng loạt** — tạo nhiều listing 1 lần, báo cáo cái nào lỗi |

> Topic 🛠 Master = "bảng điều khiển bằng chat". Tất cả cũng làm được trên web (tab Assistant / Configuration / Biens) — chọn nơi tiện nhất.

**Import nhiều BĐS:** paste danh sách trong topic 🛠 Master (mỗi BĐS gồm tiêu đề, địa chỉ, giá, diện tích, số phòng, mô tả). Agent tạo tất cả 1 lần (tối đa 50/lần) và báo cáo cái nào thiếu thông tin.

---

## 6. Quy tắc vàng

- **AI tự chạy mặc định** — chỉ can thiệp khi handoff.
- **Topic 💬 = chỉ xem.** Muốn rep khách → ra lệnh trong **Topic 🤖** hoặc dùng **web**.
- **Topic 🛠 Master = cấu hình agency.** Đổi tiêu chí / rule / listing bằng chat; web tự cập nhật.
- **Một nguồn sự thật:** web và Telegram đồng bộ, không lệch.
- **Dữ liệu cô lập theo agency** — bạn chỉ thấy khách/bất động sản của agency mình.

---

## 7. Sự cố thường gặp

| Hiện tượng | Cách xử lý |
|-----------|-----------|
| Bot không phản hồi trong nhóm | Bot đã là **Admin nhóm** + **Manage Topics** chưa? Privacy mode của bot đã tắt chưa? |
| `/link` báo lỗi | Nhóm chưa bật **Topics**, hoặc bot chưa đủ quyền — sửa rồi `/link` lại |
| Không thấy topic 🛠 Master | Nhóm chưa liên kết đúng cách. Thử: (1) Promote bot lại (nếu quản trị viên đã link web), hoặc (2) `/link <mã>` từ web `/admin` |
| Đổi config trong 🛠 Master nhưng web chưa đổi | Đợi 1-2s (tự refresh); nếu vẫn chưa, reload trang |
| Import BĐS bị thiếu vài cái | Agent báo cái nào lỗi (thường thiếu giá/diện tích) — bổ sung rồi gửi lại |
| Khách không thấy bất động sản | Chưa thêm ở tab **Biens** / chưa import cho đúng agency |

---

## Câu hỏi chưa rõ (cần bên cung cấp xác nhận)
- Mỗi agency dùng subdomain riêng — ai cấp & cấu hình?
- Nút "trả quyền cho AI" trên web hiện đặt ở đâu trong tab Conversations?
