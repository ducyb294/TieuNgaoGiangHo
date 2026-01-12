const path = require("path");
const sharp = require("sharp");
const { STAT_LABELS } = require("../constants");
const { formatNumber } = require("../utils/format");
const { applyLevelBonus } = require("../utils/stats");

const TEMPLATE_PATH = path.join(__dirname, "..", "images", "templates", "info.png");

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildOverlay({ name, level, exp, expRequired, stats }) {
  const safeName = escapeXml(name || "Nhân Vật");
  const safeLevel = Number(level) || 0;
  const safeExp = Number(exp) || 0;
  const requiredExp = Math.max(1, Number(expRequired) || 1);

  const effective = applyLevelBonus(
    {
      attack: stats.attack,
      defense: stats.defense,
      health: stats.health,
    },
    safeLevel
  );

  const statRows = [
    {
      label: STAT_LABELS.attack,
      value: `${formatNumber(effective.attack)}`,
    },
    {
      label: STAT_LABELS.defense,
      value: `${formatNumber(effective.defense)}`,
    },
    {
      label: STAT_LABELS.health,
      value: `${formatNumber(effective.health)}`,
    },
    { label: STAT_LABELS.dodge, value: formatNumber(stats.dodge) },
    { label: STAT_LABELS.accuracy, value: formatNumber(stats.accuracy) },
    { label: STAT_LABELS.critRate, value: formatNumber(stats.crit_rate) },
    {
      label: STAT_LABELS.critDamageResistance,
      value: formatNumber(stats.crit_resistance),
    },
    {
      label: STAT_LABELS.armorPenetration,
      value: formatNumber(stats.armor_penetration),
    },
    {
      label: STAT_LABELS.armorResistance,
      value: formatNumber(stats.armor_resistance),
    },
  ];

  const statYStart = 360;
  const statLineHeight = 58;
  const statXLabel = 860;
  const statXValue = 1320;

  const statLines = statRows
    .map((row, index) => {
      const y = statYStart + index * statLineHeight;
      return `
        <text x="${statXLabel}" y="${y}" class="stat-label">${escapeXml(row.label)}</text>
        <text x="${statXValue}" y="${y}" class="stat-value" text-anchor="end">${escapeXml(
          row.value
        )}</text>
      `;
    })
    .join("");

  return `
    <svg width="1536" height="1024" viewBox="0 0 1536 1024" xmlns="http://www.w3.org/2000/svg">
      <style>
        .name { font-family: "Segoe UI", Arial, sans-serif; font-size: 48px; font-weight: 700; fill: #f4e3c5; letter-spacing: 1px; }
        .meta { font-family: "Segoe UI", Arial, sans-serif; font-size: 28px; font-weight: 600; fill: #d9c7a3; }
        .stat-label { font-family: "Segoe UI", Arial, sans-serif; font-size: 28px; font-weight: 600; fill: #c9b58b; }
        .stat-value { font-family: "Segoe UI", Arial, sans-serif; font-size: 28px; font-weight: 700; fill: #f4e3c5; }
      </style>
      <text x="1080" y="170" text-anchor="middle" class="name">${safeName}</text>
      <text x="1080" y="220" text-anchor="middle" class="meta">Level ${formatNumber(safeLevel)}</text>
      <text x="1080" y="260" text-anchor="middle" class="meta">EXP: ${formatNumber(
        safeExp
      )} / ${formatNumber(requiredExp)}</text>
      ${statLines}
    </svg>
  `;
}

async function buildInfoCard(data) {
  const svgOverlay = Buffer.from(buildOverlay(data));
  const imageBuffer = await sharp(TEMPLATE_PATH)
    .composite([{ input: svgOverlay, top: 0, left: 0 }])
    .png()
    .toBuffer();

  return {
    buffer: imageBuffer,
    fileName: "info.png",
  };
}

module.exports = {
  buildInfoCard,
};