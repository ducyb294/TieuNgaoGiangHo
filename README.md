# TieuNgaoGiangHo

Discord bot with leveling, nickname formatting, and currency tracking.

## Chuc nang chinh
- Thuong exp tu dong moi phut (ke ca khi bot restart, exp duoc tinh bo sung).
- Lenh `/dotpha` de nang level khi du exp (chi dung trong kenh thong tin).
- Lenh `/doiten` doi nickname theo dinh dang `Ten - Level x` (chi dung trong kenh doi ten).
- Lenh `/info` hien thi anh thong tin nhan vat (level, exp, chi so).
- Lenh `/daomo` tieu the luc de dao mo linh thach trong kenh rieng.
- Lenh `/chanle` va `/allinchanle` cuoc linh thach chan/le, tra thuong x1.95, gui bieu do lich su 20 lan gan nhat.
- Lenh `/bicanh` xem thu ve, `/sotaithuve` danh thu ve tang level, `/farmbicanh` tao thread farm moi phut nhan linh thach (auto tiep tuc sau restart).
- Lenh `/nhanthuongbicanh` nhan toan bo linh thach dang tich luy farm va reset thoi gian.
- Lenh `/shop` va `/muasll` mua chi so (ATK/DEF/HP random ~1000 ±20% moi lan, chi so % +1% moi lan; gia tang theo cong thuc price).
- Nickname tu dong cap nhat khi len level.
- Luu tru SQLite qua `sql.js`, luu file tai `DB_PATH`.
- Chi so nguoi choi: tan cong, phong thu, mau, ne tranh (%), chinh xac (%), ti le chi mang (%) toi da 100%, khang sat thuong chi mang (%), xuyen giap (%), khang xuyen giap (%).
- Tien te: Linh thach / Ngân Lượng.
- Chủ Sòng Bài: `/npc` nhận role (cần đủ min tài sản, auto set cược tối đa chẵn/lẻ = 20% tài sản, giới hạn 20%-50%), `/huynpc` hủy, `/setmaxchanle` chỉnh cược tối đa (chủ sòng), `/settaisanchusongbai` (admin) đặt tài sản tối thiểu; hoa hồng 10% trên mọi ván chẵn/lẻ, chủ sòng trả thưởng khi người chơi thắng, ăn cược khi họ thua; hết 4h hoặc phá sản sẽ bị gỡ role và thông báo kênh sòng.
- Bầu Cua: `/baucua` đặt cược, đếm ngược 2 phút, khóa 15s cuối, thống kê xuất hiện từng linh vật, tự xoay ván.
- Top: `/topdaigia` top 10 Ngân Lượng, `/topcaothu` top 10 level (tie exp).
- Bí cảnh: mỗi người có level riêng; `/sotaithuve` giới hạn 10 lượt/ngày, reset 00:00 GMT+7.

## Yeu cau
- Node.js 18+.
- Quyen bot: Manage Nicknames, Use Application Commands, Read/Send Messages trong cac kenh duoc chi dinh.

## Cau hinh moi truong
Tao file `.env` (tham khao `.env.example`):
```
DISCORD_TOKEN=
DB_PATH=./data.db
CLIENT_ID=
GUILD_ID=
INFO_CHANNEL_ID=   # Kenh dung /dotpha
RENAME_CHANNEL_ID= # Kenh dung /doiten
MINING_CHANNEL_ID= # Kenh dung /daomo
CHANLE_CHANNEL_ID= # Kenh dung /chanle va /allinchanle
BICANH_CHANNEL_ID= # Kenh dung /bicanh, /sotaithuve, /farmbicanh
SHOP_CHANNEL_ID= # Kenh dung /shop, /muasll
LEADERBOARD_CHANNEL_ID= # Kenh dung /topdaigia, /topcaothu
BAUCUA_CHANNEL_ID= # Kenh dung /baucua
CASINO_CHANNEL_ID= # Kenh dung lệnh sòng bài
CASINO_ROLE_ID= # Role Chủ Sòng Bài
ADMIN_CHANNEL_ID= # Kenh chi admin (backup, set tài sản Chủ Sòng)
ADMIN_ROLE_ID= # Role admin
```

## Cai dat
```bash
npm install
```

## Deploy slash commands
```bash
npm run deploy:commands
```

## Chay bot
```bash
npm start
```

## Ghi chu
- Cong thuc exp len level: `Math.floor(300 * Math.pow(level, 2.35))` (luu tai `utils/exp.js`).
- Buff chi so: atk/hp/def duoc cong them `level%` khi tinh toan (giu nguyen gia tri trong DB, cong thuc tai `utils/stats.js`).
- The luc: hoi 1/lon/1 gio, toi da 10 (luu `stamina`, thoi gian hoi `last_stamina_timestamp`, logic tai `index.js`).
- Chan/le: tra thuong x1.95, lich su chung 20 lan gan nhat (luu bang `chanle_history`, chart tai `services/chanLeChart.js`).
- Bi canh: thu ve tang 25k ATK/DEF/HP va +1% cac chi so khac moi level (level 1 = 0), luu bang `bicanh_state`; combat toi da 50 hiep, log 3 hiep dau/cuoi (service `services/combat.js`); farm moi phut nhan `level x 1000` (±20%) tai thread luu bang `farm_sessions`.
- Shop: gia `price(base, n)=floor(base*(1+r*n)^k)` (ATK/DEF/HP base=10k, chi so % base=50k, r=0.12, k=2.3); mua ATK/DEF/HP nhan ~1000 ±20%, chi so % +1%/lan; service tai `services/shop.js`.
- Ten nguoi dung duoc cat toi da 22 ky tu va chi chap nhan chu cai/so/khoang trang.
