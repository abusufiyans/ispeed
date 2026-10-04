// One palette, used with meaning:
//   brand   ispeed's identity (wordmark, key hints, help)
//   down/up identity of the two directions, everywhere they appear (hero, graph, trend)
//   good/warn/poor  quality only: ratings, ping/jitter tiers, notable run-to-run change
//   greys   chrome, labels and anything that should recede
export const theme = {
  brand: "#2DD4BF",
  down: "#60A5FA",
  up: "#C084FC",
  good: "#4ADE80",
  warn: "#FBBF24",
  poor: "#F87171",
  text: "#E5E7EB",
  muted: "#9CA3AF",
  faint: "#6B7280",
  border: "#4B5563",
  borderDim: "#374151",
  barBg: "#1F2937"
};

const channels = (color) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));

export const blend = (from, to, amount) => {
  const a = channels(from);
  const b = channels(to);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, "0")).join("")}`;
};

// 1 (bad) .. 5 (excellent)
export const tierColor = (score) => (score >= 4 ? theme.good : score === 3 ? theme.warn : theme.poor);
