require("dotenv").config();
const CURRENCY_NAME = "Linh Thạch";


const STAT_LABELS = {
  attack: "Tấn Công",
  defense: "Phòng Thủ",
  health: "Máu",
  dodge: "Né Tránh (%)",
  accuracy: "Chính Xác (%)",
  critRate: "Tỉ Lệ Chí Mạng (%)",
  critDamageResistance: "Kháng Sát Thương Chí Mạng (%)",
  armorPenetration: "Xuyên Giáp (%)",
  armorResistance: "Kháng Xuyên Giáp (%)",
};

const TEXT = {
  renameChannelOnly: `Dùng trong ${process.env.RENAME_CHANNEL_ID}`,
  infoChannelOnly: `Dùng trong ${process.env.INFO_CHANNEL_ID}`,
  renameSuccess: "Đã cập nhật tên.",
  renameInvalid:
    "Tên không hợp lệ.",
  notEnoughExp: "Chưa đủ exp.",
  levelUpSuccess: "Đột phá thành công!",
};

module.exports = {
  CURRENCY_NAME,
  STAT_LABELS,
  TEXT,
};