function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pickFirstAttacker(a, b) {
  if (typeof a.priority === "number" && typeof b.priority === "number" && a.priority !== b.priority) {
    return a.priority > b.priority ? [a, b] : [b, a];
  }
  if (a.level !== b.level) {
    return a.level > b.level ? [a, b] : [b, a];
  }
  if (a.exp !== b.exp) {
    return a.exp > b.exp ? [a, b] : [b, a];
  }
  return Math.random() < 0.5 ? [a, b] : [b, a];
}

function simulateCombat(attacker, defender, options = {}) {
  const maxRounds = options.maxRounds || 50;
  const critMultiplier = options.critMultiplier || 1.5;

  const [first, second] = pickFirstAttacker(attacker, defender);

  const state = {
    [first.id]: { hp: first.health },
    [second.id]: { hp: second.health },
  };

  const rounds = [];

  const fightRound = (atk, def) => {
    if (state[atk.id].hp <= 0 || state[def.id].hp <= 0) return;

    const dodge = def.dodge || 0;
    const accuracy = atk.accuracy || 0;

    const effectiveDodge = Math.max(dodge - accuracy, 0);

    const hitChance = 100 - effectiveDodge;

    const roll = Math.random() * 100;
    if (roll > hitChance) {
      rounds.push(`${atk.name} tấn công nhưng bị né!`);
      return;
    }

    const critChance = clamp((atk.crit_rate || 0) - (def.crit_resistance || 0), 0, 100);
    const isCrit = Math.random() * 100 < critChance;

    const effectiveDefense =
      (def.defense || 0) *
      (1 + (def.armor_resistance || 0) / 100) *
      (1 - (atk.armor_penetration || 0) / 100);
    const baseDamage = Math.max(1, (atk.attack || 0) - effectiveDefense);
    const damage = Math.max(1, Math.round(baseDamage * (isCrit ? critMultiplier : 1)));

    state[def.id].hp = Math.max(0, state[def.id].hp - damage);
    rounds.push(
      `${atk.name} gây ${damage} sát thương${isCrit ? " (CHÍ MẠNG)" : ""} vào ${
        def.name
      } (${state[def.id].hp} HP còn lại)`
    );
  };

  for (let i = 1; i <= maxRounds; i++) {
    fightRound(first, second);
    if (state[second.id].hp <= 0) break;
    fightRound(second, first);
    if (state[first.id].hp <= 0) break;
  }

  const attackerAlive = state[first.id].hp > 0;
  const defenderAlive = state[second.id].hp > 0;
  let winner = null;
  if (attackerAlive && !defenderAlive) winner = first.id;
  else if (!attackerAlive && defenderAlive) winner = second.id;
  else if (attackerAlive && defenderAlive) winner = state[first.id].hp > state[second.id].hp ? first.id : second.id;

  const logs =
    rounds.length <= 6
      ? rounds
      : [...rounds.slice(0, 3), "...", ...rounds.slice(-3)];

  return {
    winner,
    rounds: logs,
    totalRounds: rounds.length,
    hp: {
      [first.id]: state[first.id].hp,
      [second.id]: state[second.id].hp,
    },
  };
}

module.exports = {
  simulateCombat,
};