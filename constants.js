require("dotenv").config();

const CURRENCY_NAME = "Ngân Lượng";

const STAT_LABELS = {
  attack: "Tấn Công",
  defense: "Phòng Thủ",
  health: "Máu",
  dodge: "Né Tránh",
  accuracy: "Chính Xác",
  critRate: "Tỉ lệ Chí Mạng",
  critDamageResistance: "Kháng ST Chí Mạng",
  armorPenetration: "Xuyên Giáp",
  armorResistance: "Kháng Xuyên Giáp",
};

const TEXT = {
  renameChannelOnly: `Dùng trong <@${process.env.RENAME_CHANNEL_ID}>`,
  infoChannelOnly: `Dùng trong <@${process.env.INFO_CHANNEL_ID}>`,
  miningChannelOnly: `Dùng trong <@${process.env.MINING_CHANNEL_ID}>`,
  chanLeChannelOnly: `Dùng trong <@${process.env.CHANLE_CHANNEL_ID}>`,
  bauCuaChannelOnly: `Dùng trong <@${process.env.BAUCUA_CHANNEL_ID}>`,
  leaderboardChannelOnly: `Dùng trong <@${process.env.LEADERBOARD_CHANNEL_ID}>`,
  casinoChannelOnly: `Dùng trong <@${process.env.CASINO_CHANNEL_ID}>`,
  bicanhChannelOnly: `Dùng trong <@${process.env.BICANH_CHANNEL_ID}>`,
  shopChannelOnly: `Dùng trong <@${process.env.SHOP_CHANNEL_ID}>`,
  backupChannelOnly: `Dùng trong <@${process.env.BACKUP_CHANNEL_ID}>`,
  renameSuccess: "Đã cập nhật tên.",
  renameInvalid: "Tên không hợp lệ.",
  notEnoughExp: "Chưa đủ exp.",
  levelUpSuccess: "Đột phá thành công!",
  noStamina: "Hết thể lực, hãy đợi hồi 1 giờ/lượt.",
  notEnoughCurrency: "Không đủ linh thạch.",
  noBalance: "Bạn chưa có linh thạch để cược.",
  bauCuaLocked: "Cửa đã đóng, hãy đợi ván sau.",
  bauCuaMinBet: "Số cược phải lớn hơn 0.",
  bauCuaInsufficient: "Không đủ Ngân Lượng.",
  bauCuaBetPlaced: "Đã đặt cược Bầu Cua.",
  bauCuaWaiting: "Đang chờ cược đầu tiên.",
  bauCuaResultTitle: "Kết quả Bầu Cua",
  bauCuaNoBets: "Chưa có ai tham gia ván này.",
  casinoNoOwner: "Hiện chưa có Chủ Sòng Bài.",
  casinoAlreadyOwner: "Đã có Chủ Sòng Bài khác.",
  casinoClaimed: "Bạn đã nhận vai Chủ Sòng Bài.",
  casinoReleased: "Đã hủy vai Chủ Sòng Bài.",
  casinoBelowMin: "Ngân lượng chưa đủ để nhận vai.",
  casinoMaxSet: "Đã cập nhật cược tối đa chẵn lẻ.",
  casinoMinSet: "Đã cập nhật tài sản tối thiểu để nhận vai.",
  casinoExpired: "Thời gian Chủ Sòng Bài đã hết, vai được trả lại.",
  casinoBankrupt: "Chủ Sòng Bài đã phá sản, vai được trả lại.",
  casinoNotOwner: "Bạn không phải Chủ Sòng Bài.",
  casinoOwnerRequired: "Chỉ Chủ Sòng Bài mới dùng lệnh này.",
  bicanhChallengeLimit: "Bạn đã hết lượt khiêu chiến hôm nay.",
  bicanhChallengeReset: "Lượt sẽ được đặt lại lúc 00:00 (GMT+7).",
};

const MAX_STAMINA = 10;
const STAMINA_INTERVAL_MS = 60 * 60 * 1000;
const CHANLE_PAYOUT_RATE = 1.95;
const BAUCUA_COUNTDOWN_MS = 2 * 60 * 1000;
const BAUCUA_LOCK_WINDOW_MS = 15 * 1000;
const CASINO_OWNER_DURATION_MS = 4 * 60 * 60 * 1000;
const CASINO_COMMISSION_RATE = 0.1;
const BICANH_DAILY_CHALLENGES = 10;

const BAUCUA_FACES = [
  { id: "cop", label: "Cọp", emoji: "🐯" },
  { id: "cua", label: "Cua", emoji: "🦀" },
  { id: "ca", label: "Cá", emoji: "🐟" },
  { id: "tom", label: "Tôm", emoji: "🦐" },
  { id: "ga", label: "Gà", emoji: "🐔" },
  { id: "bau", label: "Bầu", emoji: "🎃" },
];

function rollLinhThachReward() {
  const r = Math.random() * 100; // 0-100%

  if (r < 5) {
    return {
      tier: "Cực phẩm",
      amount: Math.floor(Math.random() * (100000 - 90000 + 1) + 90000) * 100,
    };
  } else if (r < 15) {
    return {
      tier: "Thượng phẩm",
      amount: Math.floor(Math.random() * (80000 - 50000 + 1) + 50000) * 100,
    };
  } else if (r < 40) {
    return {
      tier: "Trung phẩm",
      amount: Math.floor(Math.random() * (40000 - 10000 + 1) + 10000) * 100,
    };
  } else {
    return {
      tier: "Hạ phẩm",
      amount: Math.floor(Math.random() * (5000 - 500 + 1) + 500) * 100,
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
  CASINO_OWNER_DURATION_MS,
  CASINO_COMMISSION_RATE,
  BICANH_DAILY_CHALLENGES,
  BAUCUA_COUNTDOWN_MS,
  BAUCUA_LOCK_WINDOW_MS,
  BAUCUA_FACES,
  rollLinhThachReward,
};
