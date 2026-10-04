// Braille line graph: every terminal cell is a 2x4 dot grid, so a W x R cell area is 2W x 4R dots.
// Samples are [timeMs, value, series]; each series keeps its own colour. The curve is drawn as a
// solid top line over a stippled fill, with a dim baseline so the panel is never empty.
const DOT = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80]
];
const steps = [5, 10, 20, 25, 50, 75, 100, 150, 200, 250, 500, 750, 1000, 1500, 2500, 5000, 10000];

// A tidy axis ceiling just above the data.
export const niceMax = (value) => steps.find((step) => step >= value * 1.1) ?? 10000;

export function renderGraph({ width, rows, samples, start, window, max }) {
  const dotWidth = width * 2;
  const dotHeight = rows * 4;
  const cells = Array.from({ length: rows }, () => Array.from({ length: width }, () => ({ mask: 0, series: null })));
  const set = (x, y, series) => {
    if (x < 0 || x >= dotWidth || y < 0 || y >= dotHeight) return;
    const cell = cells[y >> 2][x >> 1];
    cell.mask |= DOT[x & 1][y & 3];
    if (series !== "base" || !cell.series) cell.series = cell.series && series === "base" ? cell.series : series;
  };

  for (let x = 0; x < dotWidth; x += 1) set(x, dotHeight - 1, "base");

  const columns = new Array(dotWidth).fill(null);
  const xOf = (time) => Math.round(((time - start) / window) * (dotWidth - 1));
  const yOf = (value) => Math.round((Math.min(value, max) / max) * (dotHeight - 2));
  for (let i = 0; i < samples.length; i += 1) {
    const [time, value, series] = samples[i];
    const x = xOf(time);
    if (x < 0 || x >= dotWidth) continue;
    columns[x] = { height: yOf(value), series };
    const next = samples[i + 1];
    if (next && next[2] === series) {
      const nextX = xOf(next[0]);
      for (let between = x + 1; between < Math.min(nextX, dotWidth); between += 1) {
        const ratio = (between - x) / (nextX - x);
        columns[between] = { height: Math.round(yOf(value) + (yOf(next[1]) - yOf(value)) * ratio), series };
      }
    }
  }
  columns.forEach((column, x) => {
    if (!column) return;
    const top = dotHeight - 2 - column.height;
    set(x, top, column.series);
    if (column.height > 1) set(x, top + 1, column.series);
    for (let y = top + 2; y < dotHeight - 1; y += 1) if ((x + y) % 2 === 0) set(x, y, column.series);
  });

  return cells.map((row) => row.map((cell) => ({ char: String.fromCharCode(0x2800 + cell.mask), series: cell.series })));
}
