function levelStatMultiplier(level) {
  const numericLevel = Math.max(0, Number(level) || 0);
  return 1 + numericLevel / 100;
}

function applyLevelBonus(stats, level) {
  const multiplier = levelStatMultiplier(level);
  const baseAttack = Number(stats.attack) || 0;
  const baseDefense = Number(stats.defense) || 0;
  const baseHealth = Number(stats.health) || 0;

  return {
    attack: Math.round(baseAttack * multiplier),
    defense: Math.round(baseDefense * multiplier),
    health: Math.round(baseHealth * multiplier),
    multiplier,
  };
}

module.exports = {
  levelStatMultiplier,
  applyLevelBonus,
};
