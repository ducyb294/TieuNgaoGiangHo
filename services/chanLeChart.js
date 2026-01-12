const sharp = require("sharp");

async function buildChanLeChartImage(history) {
  const data = history && history.length ? history.slice(-20) : [];
  const len = Math.max(data.length, 1);
  const block = 20;
  const gap = 4;
  const pad = 8;
  const width = len * block + (len - 1) * gap + pad * 2;
  const height = block * 2 + pad * 2; // upper row = chẵn, lower row = lẻ
  const buffer = Buffer.alloc(width * height * 4, 255); // white background
  const midY = pad + block;

  const setPixel = (x, y, r, g, b, a = 255) => {
    const idx = (y * width + x) * 4;
    buffer[idx] = r;
    buffer[idx + 1] = g;
    buffer[idx + 2] = b;
    buffer[idx + 3] = a;
  };

  // baseline
  for (let x = 0; x < width; x++) {
    setPixel(x, midY - 1, 200, 200, 200, 255);
    setPixel(x, midY, 200, 200, 200, 255);
  }

  data.forEach((res, idx) => {
    const color = res === "chan" ? [52, 152, 219] : [231, 76, 60]; // blue / red
    const startX = pad + idx * (block + gap);
    const startY = res === "chan" ? pad : midY;
    for (let y = startY; y < startY + block; y++) {
      for (let x = startX; x < startX + block; x++) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          setPixel(x, y, color[0], color[1], color[2], 255);
        }
      }
    }
  });

  return sharp(buffer, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

module.exports = {
  buildChanLeChartImage,
};
