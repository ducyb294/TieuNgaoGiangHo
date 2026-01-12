require("dotenv").config();
const CURRENCY_NAME = "Linh Thạch";


const STAT_LABELS = {
  attack: "Tấn Công",
  defense: "Phòng Thủ",
  health: "Máu",
  dodge: "Né Tránh",
  accuracy: "Chính Xác",
  critRate: "Tỉ Lệ Chí Mạng",
  critDamageResistance: "Kháng ST Chí Mạng",
  armorPenetration: "Xuyên Giáp",
  armorResistance: "Kháng Xuyên Giáp",
};

const TEXT = {
  renameChannelOnly: `Dùng trong ${process.env.RENAME_CHANNEL_ID}`,
  infoChannelOnly: `Dùng trong ${process.env.INFO_CHANNEL_ID}`,
  miningChannelOnly: `Dùng trong ${process.env.MINING_CHANNEL_ID}`,
  chanLeChannelOnly: `Dùng trong ${process.env.CHANLE_CHANNEL_ID}`,
  renameSuccess: "Đã cập nhật tên.",
  renameInvalid:
    "Tên không hợp lệ.",
  notEnoughExp: "Chưa đủ exp.",
  levelUpSuccess: "Đột phá thành công!",
  noStamina: "Hết thể lực, hãy đợi hồi 1 giờ/lượt.",
  notEnoughCurrency: "Không đủ linh thạch.",
  noBalance: "Bạn chưa có linh thạch để cược.",
};

const MAX_STAMINA = 10;
const STAMINA_INTERVAL_MS = 60 * 60 * 1000;
const CHANLE_PAYOUT_RATE = 1.95;

function rollLinhThachReward() {
  const r = Math.random() * 100; // 0-100%

  if (r < 5) {
    return {
      tier: "Cực phẩm",
      amount: Math.floor(Math.random() * (100000 - 90000 + 1) + 90000) * 1000,
    };
  } else if (r < 15) {
    return {
      tier: "Thượng phẩm",
      amount: Math.floor(Math.random() * (80000 - 50000 + 1) + 50000) * 1000,
    };
  } else if (r < 40) {
    return {
      tier: "Trung phẩm",
      amount: Math.floor(Math.random() * (40000 - 10000 + 1) + 10000) * 1000,
    };
  } else {
    return {
      tier: "Hạ phẩm",
      amount: Math.floor(Math.random() * (5000 - 500 + 1) + 500) * 1000,
    };
  }
}

module.exports = {
  CURRENCY_NAME,
  STAT_LABELS,
  TEXT,
  MAX_STAMINA,
  STAMINA_INTERVAL_MS,
  CHANLE_PAYOUT_RATE,
  rollLinhThachReward,
};
