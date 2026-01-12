function expToNext(level) {
  return Math.floor(300 * Math.pow(level, 2.35));
}

module.exports = {
  expToNext,
};
