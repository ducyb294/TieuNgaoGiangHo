# Tiếu Ngạo Giang Hồ

Bot Discord nhập vai tu tiên với hệ thống level, biệt danh tự động và kinh tế linh thạch – ngân lượng.

## ✨ Chức năng chính

- Thưởng EXP tự động mỗi phút (kể cả khi bot restart – EXP được tính bù).
- Tự động lên level khi đủ EXP trong quá trình farm hầm ngục.
- Lệnh `/doiten` đổi nickname theo định dạng: `Tên - Level x` (chỉ dùng trong kênh đổi tên).
- Lệnh `/info` hiển thị bảng thông tin nhân vật (level, EXP, chỉ số).
- Lệnh `/daomo` tiêu thể lực để đào mỏ linh thạch trong kênh riêng.
- Lệnh `/chanle` và `/allinchanle` cược chẵn/lẻ, trả thưởng x1.95, kèm biểu đồ lịch sử 20 ván gần nhất.
- Hệ thống Bí Cảnh:
  - `/hamnguc` xem Thú Vệ.
  - `/khieuchienhamnguc` tăng level Thú Vệ.
  - `/farmhamnguc` tạo thread farm (mỗi phút nhận linh thạch, tự động tiếp tục sau khi restart).
  - `/nhanthuonghamnguc` nhận toàn bộ linh thạch đã farm và reset thời gian.
- `/shop`, `/muasll`: mua chỉ số:
  - ATK/DEF/HP: ~1000 ±20% mỗi lần.
  - Chỉ số %: +1% mỗi lần.
  - Giá tăng theo công thức lũy tiến.
- Nickname tự động cập nhật khi lên level.
- Lưu trữ bằng SQLite (sql.js), file DB tại `DB_PATH`.

## ⚔️ Hệ thống chỉ số

- Tấn công (ATK)
- Phòng thủ (DEF)
- Máu (HP)
- Né tránh (%)
- Chính xác (%)
- Tỉ lệ chí mạng (% – tối đa 100%)
- Kháng sát thương chí mạng (%)
- Xuyên giáp (%)
- Kháng xuyên giáp (%)

Tiền tệ: Linh Thạch / Ngân Lượng.

## 🎰 Sòng Bài & Bầu Cua

### Chủ Sòng Bài
- `/npc` – Nhận role Chủ Sòng (cần đủ tài sản tối thiểu).
- `/huynpc` – Hủy vai trò.
- `/setmaxchanle` – Chỉnh cược tối đa (chủ sòng).
- `/settaisanchusongbai` – (Admin) đặt tài sản tối thiểu.

Quy tắc:
- Cược tối đa mặc định = 20% tài sản, có thể chỉnh 20%–50%.
- Hoa hồng 10% trên mỗi ván chẵn/lẻ.
- Chủ sòng trả thưởng khi người chơi thắng, ăn cược khi họ thua.
- Sau 4 giờ hoặc phá sản sẽ tự động gỡ role và thông báo tại kênh sòng.

### Bầu Cua
- `/baucua`: đặt cược, đếm ngược 2 phút, khóa 15 giây cuối, tự động xoay ván.
- Có thống kê tần suất xuất hiện từng linh vật.

## 🧭 Bí Cảnh

- Mỗi người có level Bí Cảnh riêng.
- `/sotaithuve` giới hạn 10 lượt/ngày, reset 00:00 (GMT+7).

## 📦 Yêu cầu

- Node.js 18+
- Quyền bot:
  - Manage Nicknames
  - Use Application Commands
  - Read/Send Messages

## ⚙️ Cấu hình môi trường

Tạo file `.env`:

```env
DISCORD_TOKEN=
DB_PATH=./data.db
CLIENT_ID=
GUILD_ID=

INFO_CHANNEL_ID=
RENAME_CHANNEL_ID=
MINING_CHANNEL_ID=
CHANLE_CHANNEL_ID=
BICANH_CHANNEL_ID=
SHOP_CHANNEL_ID=
LEADERBOARD_CHANNEL_ID=
BAUCUA_CHANNEL_ID=

CASINO_CHANNEL_ID=
CASINO_ROLE_ID=
ADMIN_CHANNEL_ID=
ADMIN_ROLE_ID=
```

## 🛠 Cài đặt

```bash
npm install
```

## 🚀 Deploy Slash Commands

```bash
npm run deploy:commands
```

## ▶️ Chạy bot

```bash
npm start
```

## 📌 Ghi chú kỹ thuật

- Công thức EXP: `Math.floor(300 * Math.pow(level, 2.35))`
- Thể lực: hồi 1 điểm/giờ, tối đa 10.
- Chẵn/Lẻ: trả thưởng x1.95, lưu lịch sử 20 ván.
- Farm Hầm Ngục: mỗi phút nhận `level x 1000` (±20%).