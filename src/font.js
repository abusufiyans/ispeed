// Block fonts for the hero numbers and the launch wordmark.
//   5 rows: chunky full blocks, the dominant look
//   3 rows: half-block glyphs, for shorter terminals
const BIG = {
  0: ["█████", "█   █", "█   █", "█   █", "█████"],
  1: ["  █  ", " ██  ", "  █  ", "  █  ", " ███ "],
  2: ["█████", "    █", "█████", "█    ", "█████"],
  3: ["█████", "    █", " ████", "    █", "█████"],
  4: ["█   █", "█   █", "█████", "    █", "    █"],
  5: ["█████", "█    ", "█████", "    █", "█████"],
  6: ["█████", "█    ", "█████", "█   █", "█████"],
  7: ["█████", "    █", "   █ ", "  █  ", "  █  "],
  8: ["█████", "█   █", "█████", "█   █", "█████"],
  9: ["█████", "█   █", "█████", "    █", "█████"],
  ".": ["  ", "  ", "  ", "  ", "██"],
  "-": ["     ", "     ", " ███ ", "     ", "     "],
  i: ["  █  ", "     ", "  █  ", "  █  ", "  █  "],
  s: ["█████", "█    ", "█████", "    █", "█████"],
  p: ["█████", "█   █", "█████", "█    ", "█    "],
  e: ["█████", "█    ", "████ ", "█    ", "█████"],
  d: ["    █", "    █", "█████", "█   █", "█████"]
};

const SMALL = {
  0: ["█▀█", "█ █", "▀▀▀"],
  1: ["▄█ ", " █ ", "▄█▄"],
  2: ["▀▀█", "▄▀▀", "▀▀▀"],
  3: ["▀▀█", " ▀█", "▀▀▀"],
  4: ["█ █", "▀▀█", "  ▀"],
  5: ["█▀▀", "▀▀█", "▀▀▀"],
  6: ["█▀▀", "█▀█", "▀▀▀"],
  7: ["▀▀█", "  █", "  ▀"],
  8: ["█▀█", "█▀█", "▀▀▀"],
  9: ["█▀█", "▀▀█", "▀▀▀"],
  ".": [" ", " ", "▄"],
  "-": ["   ", "▄▄▄", "   "]
};

const fonts = { 5: BIG, 3: SMALL };

export function bigText(text, size) {
  const font = fonts[size];
  const rows = size;
  return Array.from({ length: rows }, (_, row) => [...text].map((char) => (font[char] ?? font["-"])[row]).join(" "));
}

export const bigWidth = (text, size) => bigText(text, size)[0].length;

// "44.8", "138", "1234": one decimal below 100, none above.
export const formatMbps = (value) => (value >= 100 ? value.toFixed(0) : value.toFixed(1));
