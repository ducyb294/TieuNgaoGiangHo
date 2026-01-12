const path = require("path");
const sharp = require("sharp");
const { STAT_LABELS, CURRENCY_NAME } = require("../constants");
const { formatNumber } = require("../utils/format");
const { applyLevelBonus } = require("../utils/stats");

const TEMPLATE_PATH = path.join(__dirname, "..", "images", "templates", "info.png");

const LAYOUT = {
  avatar: { left: 104, top: 169, width: 203, height: 203, radius: 12 },
  name: { left: 380, top: 175, width: 860, height: 100 },
  level: { left: 380, top: 265, width: 860, height: 180 },
  exp: { left: 380, top: 325, width: 860, height: 70 },
  statLeft: { left: 800, top: 430, width: 320, gap: 95 },
  statRight: { left: 1150, top: 430, width: 320, gap: 95 },
};

function sanitizeSvgText(input) {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function createTextSvg(text, width, height, options = {}) {
  const {
    fontSize = 48,
    color = "#f6e4c5",
    fontWeight = 600,
    align = "left",
    verticalAlign = "top",
    lineHeight = 1.2,
  } = options;
  const anchorMap = { left: "start", center: "middle", right: "end" };
  const anchor = anchorMap[align] || "start";
  const xPositions = { left: 10, center: width / 2, right: width - 10 };
  const firstLineY =
    verticalAlign === "middle"
      ? height / 2 + fontSize * 0.35
      : verticalAlign === "bottom"
      ? height - 10
      : fontSize;

  const normalizedLines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => sanitizeSvgText(line));
  const tspans = normalizedLines
    .map((line, idx) => {
      const dy = idx === 0 ? 0 : fontSize * lineHeight;
      const posAttr = idx === 0 ? `y="${firstLineY}"` : `dy="${dy}"`;
      return `<tspan x="${xPositions[align] ?? 10}" ${posAttr}>${line}</tspan>`;
    })
    .join("");

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
<style>
text { font-family: 'Segoe UI', 'Arial', sans-serif; font-weight: ${fontWeight}; font-size: ${fontSize}; fill: ${color}; }
</style>
<text text-anchor="${anchor}">${tspans}</text>
</svg>`;
  return Buffer.from(svg);
}

function createRoundedRectMask(width, height, radius) {
  const r = Math.max(0, Math.min(radius || 0, width / 2, height / 2));
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" rx="${r}" ry="${r}" fill="#ffffff"/></svg>`;
  return Buffer.from(svg);
}

async function fetchImageBuffer(url) {
  if (!url) return null;
  if (typeof fetch !== "function") return null;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetch failed with status ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    console.error("Failed to fetch avatar:", error);
    return null;
  }
}

async function buildInfoCard({ name, level, exp, expRequired, stats, avatarUrl, currency }) {
  const safeName = sanitizeSvgText(name || "NHÂN VẬT");
  const safeLevel = Math.max(0, Number(level) || 0);
  const safeExp = Math.max(0, Number(exp) || 0);
  const requiredExp = Math.max(1, Number(expRequired) || 1);

  const effective = applyLevelBonus(
    {
      attack: stats.attack,
      defense: stats.defense,
      health: stats.health,
    },
    safeLevel
  );

  const statColumns = [
    [
      { label: STAT_LABELS.attack, value: `${formatNumber(effective.attack)}` },
      { label: STAT_LABELS.defense, value: `${formatNumber(effective.defense)}` },
      { label: STAT_LABELS.health, value: `${formatNumber(effective.health)}` },
      { label: STAT_LABELS.dodge, value: `${formatNumber(stats.dodge)}%` },
      { label: STAT_LABELS.accuracy, value: `${formatNumber(stats.accuracy)}%` },
    ],
    [
      { label: STAT_LABELS.critRate, value: `${formatNumber(stats.crit_rate)}%` },
      {
        label: STAT_LABELS.critDamageResistance,
        value: `${formatNumber(stats.crit_resistance)}%`,
      },
      {
        label: STAT_LABELS.armorPenetration,
        value: `${formatNumber(stats.armor_penetration)}%`,
      },
      {
        label: STAT_LABELS.armorResistance,
        value: `${formatNumber(stats.armor_resistance)}%`,
      },
    ],
  ];

  const composites = [];

  // Avatar
  const avatarLayout = LAYOUT.avatar;
  const avatarBuffer = await fetchImageBuffer(avatarUrl);
  const avatarSharp = avatarBuffer
    ? sharp(avatarBuffer).resize(avatarLayout.width, avatarLayout.height, { fit: "cover" })
    : sharp({
        create: {
          width: avatarLayout.width,
          height: avatarLayout.height,
          channels: 4,
          background: "#1c120a",
        },
      });
  const avatarImage = await avatarSharp
    .composite([
      {
        input: createRoundedRectMask(avatarLayout.width, avatarLayout.height, avatarLayout.radius),
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
  composites.push({ input: avatarImage, left: avatarLayout.left, top: avatarLayout.top });

  // Text blocks
  composites.push({
    input: createTextSvg(safeName, LAYOUT.name.width, LAYOUT.name.height, {
      fontSize: 64,
      color: "#f6e5c6",
      fontWeight: 800,
    }),
    left: LAYOUT.name.left,
    top: LAYOUT.name.top,
  });
  composites.push({
    input: createTextSvg(`Level ${formatNumber(safeLevel)}`, LAYOUT.level.width, LAYOUT.level.height, {
      fontSize: 42,
      color: "#d9c7a3",
      fontWeight: 700,
    }),
    left: LAYOUT.level.left,
    top: LAYOUT.level.top,
  });
  composites.push({
    input: createTextSvg(
      `EXP: ${formatNumber(safeExp)} | ${CURRENCY_NAME}: ${formatNumber(currency)}`,
      LAYOUT.exp.width,
      LAYOUT.exp.height,
      { fontSize: 38, color: "#cbb185", fontWeight: 600 }
    ),
    left: LAYOUT.exp.left,
    top: LAYOUT.exp.top,
  });

  // Stats columns
  const maxRows = Math.max(statColumns[0].length, statColumns[1].length);
  for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
    [LAYOUT.statLeft, LAYOUT.statRight].forEach((layout, colIdx) => {
      const statInfo = statColumns[colIdx][rowIndex];
      if (!statInfo) return;
      const top = layout.top + rowIndex * layout.gap;
      composites.push({
        input: createTextSvg(statInfo.label.toUpperCase(), layout.width, 34, {
          fontSize: 26,
          color: "#a88959",
          fontWeight: 700,
        }),
        left: layout.left,
        top,
      });
      composites.push({
        input: createTextSvg(statInfo.value, layout.width, 60, {
          fontSize: 40,
          color: "#f6e5c6",
          fontWeight: 800,
        }),
        left: layout.left,
        top: top + 30,
      });
    });
  }

  const imageBuffer = await sharp(TEMPLATE_PATH).composite(composites).png().toBuffer();

  return {
    buffer: imageBuffer,
    fileName: "info.png",
  };
}

module.exports = {
  buildInfoCard,
};