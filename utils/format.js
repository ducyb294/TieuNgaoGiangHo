const VI_NUMBER_FORMATTER = new Intl.NumberFormat("vi-VN");

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60)
        .toString()
        .padStart(2, "0");
    const seconds = (totalSeconds % 60)
        .toString()
        .padStart(2, "0");
    return `${minutes}:${seconds}`;
}

function formatNumber(value) {
    if (typeof value !== "number") {
        value = Number(value) || 0;
    }
    return VI_NUMBER_FORMATTER.format(Math.round(value));
}

module.exports = {
    formatDuration,
    formatNumber,
    VI_NUMBER_FORMATTER
};