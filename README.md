# TieuNgaoGiangHo

Discord bot with leveling, nickname formatting, and currency tracking.

## Chuc nang chinh
- Thuong exp tu dong moi phut (ke ca khi bot restart, exp duoc tinh bo sung).
- Lenh `/dotpha` de nang level khi du exp (chi dung trong kenh thong tin).
- Lenh `/doiten` doi nickname theo dinh dang `Ten - Level x` (chi dung trong kenh doi ten).
- Lenh `/info` hien thi anh thong tin nhan vat (level, exp, chi so).
- Lenh `/daomo` tieu the luc de dao mo linh thach trong kenh rieng.
- Nickname tu dong cap nhat khi len level.
- Luu tru SQLite qua `sql.js`, luu file tai `DB_PATH`.
- Chi so nguoi choi: tan cong, phong thu, mau, ne tranh (%), chinh xac (%), ti le chi mang (%) toi da 100%, khang sat thuong chi mang (%), xuyen giap (%), khang xuyen giap (%).
- Tien te: Linh thach.

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
- Ten nguoi dung duoc cat toi da 22 ky tu va chi chap nhan chu cai/so/khoang trang.
