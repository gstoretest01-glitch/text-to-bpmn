OKKO

# TÀI LIỆU SRS MẪU CHUẨN & QUY TẮC TUÂN THỦ (BA STANDARD)

Tài liệu này được biên soạn dựa trên cấu trúc chuẩn của tài liệu đặc tả yêu cầu nghiệp vụ (SRS) của hệ thống CMC Admin. Nó bao gồm hai phần chính:

1. **Quy tắc viết SRS chuẩn (BA Rules & Conventions)**
2. **Khung tài liệu SRS mẫu (SRS Template Markdown)**

---

## PHẦN 1: QUY TẮC VIẾT SRS CHUẨN (BA RULES)

Để đảm bảo tài liệu SRS có độ chính xác cao, giúp cả Lập trình viên (Developer) và Kiểm thử viên (Tester) hiểu đúng và đủ, các Business Analyst (BA) cần tuân thủ nghiêm ngặt các quy tắc sau:

### 1. Quy tắc đặt mã định danh (Naming & ID Conventions)

* **Mã Use Case (UC ID):** Đặt theo định dạng `UC-[Phân hệ viết tắt]-[Tên chức năng viết tắt]-[Số thứ tự]`.
  * *Ví dụ:* `UC-SA-LICENSE-001` (Super Admin - License Manager - UC số 001).
* **Mã Luồng Nghiệp Vụ:**
  * **Luồng chính (Main Course):** Đánh số thứ tự từ `1, 2, 3...`
  * **Luồng rẽ nhánh/thay thế (Alternate Flow):** Ký hiệu là `AF-01, AF-02...`
  * **Luồng ngoại lệ/lỗi (Exception Flow):** Ký hiệu là `EF-01, EF-02...`

### 2. Quy tắc mô tả Luồng Nghiệp Vụ (Flow Description)

* **Hành động người dùng (User Action):** Phải mô tả rõ ràng tương tác vật lý trên giao diện. Không viết chung chung "Người dùng nhập thông tin", hãy viết cụ thể: *"Super Admin nhập thông tin vào trường Tên License, chọn Loại Skill từ dropdown..."* hoặc *"Super Admin nhấn nút 'Lưu' trên SideSheet"*.
* **Phản hồi hệ thống (System Response):** Phải nêu rõ hành động của hệ thống bao gồm:
  1. *Kiểm tra dữ liệu (Validation):* Kiểm tra tại client hay gọi API kiểm tra ở server.
  2. *Lưu trữ:* Ghi nhận vào Cơ sở dữ liệu (Database).
  3. *Trạng thái UI:* Đóng/mở modal, chuyển trang, hoặc hiển thị Toast thông báo (thành công/thất bại).
* **Nguyên tắc Không Bỏ Sót Bước (No Shortcuts):** Mọi bước kiểm tra dữ liệu, hiển thị lỗi đỏ, hoặc gửi email thông báo đều phải được viết thành một bước rõ ràng.

### 3. Quy tắc Đặc tả Thông tin Trường dữ liệu (Data Field Specification)

Mỗi màn hình có Form nhập liệu hoặc Bảng dữ liệu (DataTable) đều phải có bảng đặc tả chi tiết thông tin trường dữ liệu bao gồm:

* Tên trường thông tin (Field Name).
* Kiểu dữ liệu (Data Type): String, Number, Boolean, DateTime, Dropdown, v.v.
* Ràng buộc bắt buộc (Mandatory): Đánh dấu `*` hoặc ghi rõ `Yes/No`.
* Quy tắc kiểm tra (Validation Rules): Độ dài tối đa, định dạng Regex, tính duy nhất (Unique), khoảng giá trị cho phép.
* Thông báo lỗi hiển thị (Error Message): Ghi rõ câu chữ báo lỗi hiển thị trên UI khi vi phạm ràng buộc.

### 4. Quy tắc Mô tả Giao diện (UI/UX Specification)

* Mỗi Use Case phải đính kèm hình ảnh Mockup/Figma hoặc Screenshot giao diện trực quan.
* Giao diện dạng danh sách phải làm rõ các trạng thái: Trống dữ liệu (Empty State), Đang tải (Loading State), Phân trang (Pagination), Tìm kiếm và Bộ lọc (Filter).
* Giao diện dạng Form nhập liệu phải chỉ rõ vị trí thông báo lỗi (ví dụ: chữ đỏ dưới chân input field).

---

## PHẦN 2: KHUNG TÀI LIỆU SRS MẪU (SRS TEMPLATE)

*Dưới đây là cấu trúc Markdown chuẩn của một tài liệu SRS. Hãy copy khung này và điền thông tin tương ứng cho Use Case mới.*

```markdown
# SRS - [Tên Phân Hệ/Chức Năng Chính]

**[Tên Dự Án/Nền Tảng] (Ví dụ: Web Application / Mobile App)**

**[MÃ-UC-ID]  |  [Tên Use Case Chi Tiết]  |  v[Phiên bản, vd: 1.0]  |  [Ngày cập nhật: DD/MM/YYYY]**

---

### **Bảng đặc tả Use Case**

| **Element** | **Detail** |
| :--- | :--- |
| **Name** | [Tên Use Case - Trùng với tên ở header] |
| **ID** | [Mã Use Case, ví dụ: UC-SA-MODULE-001] |
| **Description** | [Mô tả tóm tắt mục đích của Use Case, người dùng làm được gì trên màn hình này và các tính năng chính được cung cấp]. |
| **Actors** | [Tên các vai trò/hệ thống tương tác trực tiếp, ví dụ: CMC Super Admin, Khách hàng, Hệ thống thanh toán bên thứ ba] |
| **Organization Benefits** | [Giá trị nghiệp vụ mà Use Case này mang lại cho tổ chức/doanh nghiệp] |
| **Frequency of Use** | [Tần suất sử dụng: Rất cao (Hàng ngày) / Trung bình / Thấp] |
| **Triggers** | [Hành động kích hoạt Use Case, ví dụ: Người dùng click vào menu "Quản lý..." trên sidebar] |
| **Preconditions** | - Người dùng đã đăng nhập thành công vào hệ thống.<br>- Người dùng có quyền truy cập phù hợp (ví dụ: Role = `ADMIN`). |
| **Postconditions** | - Dữ liệu mới được tạo thành công/cập nhật trong Database.<br>- Trạng thái hệ thống thay đổi.<br>- Log lịch sử tác động được ghi nhận. |
| **Main Course** | **Luồng nghiệp vụ chính:**<br><br>\| **#** \| **Hành động người dùng (User Action)** \| **Phản hồi hệ thống (System Response)** \|<br>\| --- \| --- \| --- \|<br>\| 1. \| Người dùng truy cập vào trang [Tên Trang] \| Hệ thống kiểm tra quyền, truy vấn dữ liệu từ DB và hiển thị danh sách [Đối tượng] dưới dạng DataTable. \|<br>\| 2. \| Người dùng nhấn nút "[Tên Nút, vd: Thêm Mới]" \| Hệ thống mở SideSheet/Modal "[Tên Form]" chứa các trường nhập liệu. \|<br>\| 3. \| Người dùng điền thông tin hợp lệ vào form và nhấn nút "[Lưu]" \| Hệ thống thực hiện kiểm tra dữ liệu đầu vào (Validation):<br>- Nếu hợp lệ: Lưu dữ liệu vào DB, hiển thị Toast thông báo thành công, đóng form và tải lại danh sách. \| |
| **Alternate Course** | **AF-01: [Tên Luồng Thay Thế 1 - Ví dụ: Cập nhật thông tin]**<br>1. Tại dòng dữ liệu cần sửa, người dùng nhấn biểu tượng "Sửa" (bút chì).<br>2. Hệ thống hiển thị SideSheet chứa dữ liệu hiện tại của đối tượng.<br>3. Người dùng thay đổi thông tin và nhấn "Lưu". Hệ thống cập nhật DB, thông báo thành công và đóng form.<br><br>**AF-02: [Tên Luồng Thay Thế 2 - Ví dụ: Xóa đối tượng]**<br>1. Tại dòng dữ liệu cần xóa, người dùng nhấn biểu tượng "Xóa" (thùng rác).<br>2. Hệ thống kiểm tra điều kiện ràng buộc xóa (ví dụ: đối tượng chưa được sử dụng ở phân hệ khác):<br>    - Nếu *Bị ràng buộc*: Hệ thống hiển thị cảnh báo lỗi bằng Toast và không cho xóa.<br>    - Nếu *Không ràng buộc*: Hệ thống hiển thị Modal xác nhận xóa.<br>3. Người dùng nhấn "Xác nhận xóa" -> Hệ thống xóa bản ghi khỏi DB, báo Toast thành công và cập nhật lại DataTable. |
| **Exception Courses** | **EF-01: [Tên Luồng Ngoại Lệ 1 - Ví dụ: Lỗi xác thực dữ liệu đầu vào]**<br>1. Người dùng nhấn "Lưu" nhưng để trống các trường bắt buộc hoặc nhập sai định dạng.<br>2. Hệ thống hiển thị thông báo lỗi (chữ đỏ) ngay dưới các trường nhập liệu không hợp lệ và không đóng form.<br><br>**EF-02: [Tên Luồng Ngoại Lệ 2 - Ví dụ: Lỗi trùng lặp khóa chính]**<br>1. Người dùng nhập mã đối tượng đã tồn tại trong hệ thống và nhấn "Lưu".<br>2. Hệ thống kiểm tra ở Server-side phát hiện trùng lặp -> Trả về lỗi, hiển thị Toast thông báo: "[Mã] đã tồn tại trên hệ thống, vui lòng kiểm tra lại". |

---

## **2. Screen Description & UI (Đặc tả màn hình & Giao diện)**

### **Hình ảnh giao diện**

![[Chú thích ảnh 1, ví dụ: Màn hình danh sách]]([Đường dẫn file ảnh cục bộ hoặc URL ảnh, ví dụ: file:///absolute/path/to/image.png])
*Chú thích: Giao diện màn hình danh sách chính*

---

![[Chú thích ảnh 2, ví dụ: Form nhập liệu/SideSheet]]([Đường dẫn file ảnh cục bộ hoặc URL ảnh, ví dụ: file:///absolute/path/to/form.png])
*Chú thích: Giao diện form thêm mới / cập nhật*

---

## **3. Data Specifications (Đặc tả dữ liệu chi tiết)**

### **Bảng chi tiết các trường thông tin trong Form [Tên Form]**

| **STT** | **Trường dữ liệu** | **Kiểu dữ liệu** | **Bắt buộc** | **Quy tắc kiểm tra (Validation Rules)** | **Thông báo lỗi trên UI** |
| :---: | :--- | :--- | :---: | :--- | :--- |
| 1 | Mã đối tượng | String (Text) | Có (`*`) | - Tối đa 50 ký tự.<br>- Không chứa ký tự đặc biệt.<br>- Duy nhất (Unique). | - "Vui lòng nhập mã"<br>- "Mã đã tồn tại trên hệ thống" |
| 2 | Tên đối tượng | String (Text) | Có (`*`) | - Tối đa 255 ký tự. | - "Vui lòng nhập tên đối tượng" |
| 3 | Trạng thái | Dropdown | Có (`*`) | - Lựa chọn: Hoạt động (Active) / Ngưng hoạt động (Inactive).<br>- Giá trị mặc định: Hoạt động. | - "Vui lòng chọn trạng thái" |
| 4 | Mô tả | Textarea | Không | - Tối đa 1000 ký tự. | - "Mô tả không vượt quá 1000 ký tự" |

---

## **4. Business Rules (Các quy tắc nghiệp vụ đặc thù)**
- **[Rule_01]:** [Mô tả chi tiết quy tắc nghiệp vụ 1, ví dụ: Không cho phép sửa đổi Mã đối tượng sau khi đã tạo thành công].
- **[Rule_02]:** [Mô tả chi tiết quy tắc nghiệp vụ 2, ví dụ: Khi chuyển trạng thái sang "Ngưng hoạt động", tất cả các thực thể liên quan sẽ tạm thời bị ẩn ở màn hình phía người dùng cuối].
```
