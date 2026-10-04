import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { theme, tierColor } from "./theme.js";
import { seg, wrapText } from "./ui.js";

// Help screen: a set of bordered panels composed to fit the terminal, in the same visual language as the
// dashboard (grey borders, brand-coloured titles, the same keycaps and palette).

const width = (segments) => segments.reduce((sum, part) => sum + part.text.length, 0);
const padTo = (segments, size) => [...segments, seg(" ".repeat(Math.max(0, size - width(segments))))];
const faint = (text) => seg(text, theme.faint);
const muted = (text) => seg(text, theme.muted);
const blank = [seg(" ")];
const dots = (score) => "●".repeat(score) + "○".repeat(5 - score);

// Same keycap as the status bar: teal for the keys you use, grey for alternates. Caps in a column share a width.
const keycap = (key, primary, size) => {
  const gap = Math.max(0, size - 2 - key.length);
  const text = ` ${" ".repeat(Math.floor(gap / 2))}${key}${" ".repeat(Math.ceil(gap / 2))} `;
  return primary ? seg(text, "#0B1220", true, theme.brand) : seg(text, theme.text, true, theme.border);
};

function keysLines(inner, spaced) {
  const left = [["h", "help", true], ["?", "help (alt)", false], ["esc", "close help", false]];
  const right = [["r", "run again", true], ["q", "quit", true], ["ctrl+c", "quit", false]];
  const capWidth = (list) => Math.max(...list.map(([key]) => key.length)) + 2;
  const labelWidth = (list) => Math.max(...list.map(([, label]) => label.length));
  const cell = ([key, label, primary], cap) => [keycap(key, primary, cap), muted(` ${label}`)];
  const leftCap = capWidth(left);
  const rightCap = capWidth(right);
  const leftCell = leftCap + 1 + labelWidth(left);
  let rows;
  if (inner < leftCell + 1 + rightCap + 1 + labelWidth(right)) {
    const all = [...left, ...right];
    rows = all.map((entry) => cell(entry, capWidth(all)));
  } else {
    rows = left.map((entry, i) => [...padTo(cell(entry, leftCap), leftCell + (inner >= leftCell + 3 + rightCap + 1 + labelWidth(right) ? 3 : 1)), ...cell(right[i], rightCap)]);
  }
  // Roomy layouts put a blank row between key rows so the caps read as separate keys, not one bar.
  return spaced ? rows.flatMap((row, i) => (i < rows.length - 1 ? [row, blank] : [row])) : rows;
}

function colorLines(inner, mode) {
  const swatch = (color) => seg("████", color);
  if (mode === "compact") {
    return [
      [swatch(theme.down), muted(" Download  "), swatch(theme.up), muted(" Upload")],
      [swatch(theme.good), muted(" Good  "), swatch(theme.warn), muted(" Fair  "), swatch(theme.poor), muted(" Poor")],
      [faint("colour = direction or quality")]
    ];
  }
  const rows = [
    [theme.down, "Download", "data in"],
    [theme.up, "Upload", "data out"],
    [theme.good, "Good", "4-5, or 5%+ faster"],
    [theme.warn, "Fair", "3"],
    [theme.poor, "Poor", "1-2, or 5%+ slower"],
    [theme.brand, "ispeed", "keys, active, brand"]
  ];
  return rows.map(([color, name, note]) => [swatch(color), seg(` ${name.padEnd(9)}`, theme.text), faint(note)]);
}

const tiers = [
  [5, "Excellent", "≤20", "≤3", "≥100", "≥50"],
  [4, "Good", "≤40", "≤8", "≥50", "≥25"],
  [3, "Fair", "≤70", "≤15", "≥25", "≥12"],
  [2, "Poor", "≤120", "≤30", "≥10", "≥5"],
  [1, "Bad", ">120", ">30", "<10", "<5"]
];

function qualityLines(inner, note) {
  const columns = inner >= 43 ? 4 : inner >= 29 ? 2 : 1;
  const names = ["PING", "JITTER", "DOWN", "UP"].slice(0, columns);
  const cell = (text, color) => seg(text.padStart(7), color);
  const lines = [
    [faint("ping and jitter in ms, speed in Mbps")],
    [faint("RATING".padEnd(15)), ...names.map((name) => cell(name, theme.faint))]
  ];
  for (const [score, name, ...limits] of tiers) {
    const color = tierColor(score);
    lines.push([seg(dots(score), color), seg(` ${name.padEnd(9)}`, theme.text), ...limits.slice(0, columns).map((limit) => cell(limit, theme.muted))]);
  }
  if (note && inner >= 44) lines.push([faint("overall = mean of speed, response, stability")]);
  return lines;
}

const entries = [
  {
    label: "Throughput",
    long: "Megabits per second over parallel streams to and from the nearest Cloudflare edge. Every byte on the wire is counted and divided by elapsed time: true aggregate throughput, not a sum of per-request rates.",
    short: "Parallel streams to the nearest Cloudflare edge; every byte on the wire counted over elapsed time."
  },
  {
    label: "Ping",
    long: "Round-trip time: the median of 20 probes, taken before the bandwidth phases so it reflects an unloaded connection.",
    short: "Median of 20 probes on an idle line."
  },
  {
    label: "Jitter",
    long: "How much latency varies: the average change between consecutive probes. Lower means a steadier line.",
    short: "Average change between consecutive probes."
  }
];

function measureLines(inner, variant) {
  const labelWidth = 12;
  const lines = [];
  for (const entry of entries) {
    wrapText(entry[variant], Math.max(10, inner - labelWidth)).forEach((text, i) => {
      lines.push([seg((i === 0 ? entry.label : "").padEnd(labelWidth), theme.text, true), muted(text)]);
    });
  }
  return lines;
}

const guide = [
  ["Hero numbers", "Live speed. They glide toward the measured rate, then settle on the final result."],
  ["Graph", "Throughput over time: download in blue, then upload in violet, with the peak top right."],
  ["Borders", "The active phase pulses, finished panels are still, and waiting ones are dim."],
  ["Summary", "Ping and jitter dots follow the quality tiers; QUALITY is ispeed's own rating."],
  ["History", "This run against the last, plus a trend line across your past runs."]
];

function guideLines(inner) {
  const labelWidth = 14;
  const lines = [];
  for (const [label, text] of guide) {
    wrapText(text, Math.max(10, inner - labelWidth)).forEach((part, i) => {
      lines.push([seg((i === 0 ? label : "").padEnd(labelWidth), theme.text, true), muted(part)]);
    });
  }
  return lines;
}

function aboutLines(info, compact, inner) {
  const row = (label, value) => [faint(label.padEnd(9)), muted(value)];
  const lines = [
    [seg("◈ ispeed", theme.brand, true), muted(`  v${info.version}`)],
    ...(compact ? [] : [[faint("Terminal speed test, Cloudflare edge")]]),
    row("License", info.license),
    row("Repo", info.repo)
  ];
  // The full link when it fits the panel, otherwise just the package name.
  if (!compact) lines.push(row("npm", inner - 9 >= info.npm.length ? info.npm : info.name));
  return lines;
}

const flavors = [
  { gap: 1, guide: true, measure: "long", colors: "full", about: "full", note: true },
  { gap: 0, guide: true, measure: "long", colors: "full", about: "full", note: true },
  { gap: 1, measure: "long", colors: "full", about: "full", note: true },
  { gap: 0, measure: "long", colors: "full", about: "full", note: true },
  { gap: 1, measure: "short", colors: "full", about: "full", note: true },
  { gap: 0, measure: "short", colors: "full", about: "full", note: true },
  { gap: 0, measure: "short", colors: "compact", about: "compact", note: false },
  { gap: 0, measure: "short", colors: "compact", about: null, note: false },
  { gap: 0, measure: null, colors: "compact", about: null, note: false },
  { gap: 0, measure: null, colors: null, about: null, note: false }
];

function makePanel(kind, size, flavor, info) {
  const inner = size - 4;
  // Builders are functions so only the requested panel's content is computed.
  const built = {
    keys: () => ({ title: "KEYS", hint: inner >= 30 ? "h or esc to close" : "", lines: keysLines(inner, flavor.gap === 1) }),
    colors: () => ({ title: "COLOUR KEY", lines: colorLines(inner, flavor.colors) }),
    quality: () => ({ title: "QUALITY RATINGS", lines: qualityLines(inner, flavor.note) }),
    measure: () => ({ title: "HOW IT MEASURES", lines: measureLines(inner, flavor.measure) }),
    about: () => ({ title: "ABOUT", lines: aboutLines(info, flavor.about === "compact", inner) }),
    guide: () => ({ title: "READING THE SCREEN", lines: guideLines(inner) })
  }[kind]();
  const natural = built.lines.length + 3;
  return { kind, width: size, natural, height: natural, hint: built.hint, title: built.title, lines: built.lines };
}

const total = (panels) => panels.reduce((sum, panel) => sum + panel.natural, 0);
const stretch = (panels, to) => {
  const extra = to - total(panels);
  panels.at(-1).height += extra;
};

// Returns a tree of { dir, children, gap } / { panel } plus its total height.
function compose(columns, flavor, info) {
  const make = (kind, size) => makePanel(kind, size, flavor, info);
  const wanted = (value) => value !== null;
  if (columns >= 134) {
    const keys = make("keys", 40);
    const colors = make("colors", 40);
    const quality = make("quality", columns - 40 - 40 - 2);
    const top = [keys, colors, quality];
    const topHeight = Math.max(...top.map((p) => p.natural));
    top.forEach((p) => { p.height = topHeight; });
    const bottom = [];
    if (wanted(flavor.measure)) bottom.push(make("measure", flavor.about ? columns - 41 : columns));
    if (flavor.about) bottom.push(make("about", 40));
    const bottomHeight = bottom.length ? Math.max(...bottom.map((p) => p.natural)) : 0;
    bottom.forEach((p) => { p.height = bottomHeight; });
    const rows = [{ dir: "row", children: top.map((panel) => ({ panel })) }];
    let height = topHeight;
    if (bottom.length) {
      rows.push({ dir: "row", children: bottom.map((panel) => ({ panel })) });
      height += flavor.gap + bottomHeight;
    }
    if (flavor.guide) {
      const reading = make("guide", columns);
      rows.push({ panel: reading });
      height += flavor.gap + reading.natural;
    }
    return { node: { dir: "col", gap: flavor.gap, children: rows }, height };
  }
  if (columns >= 80) {
    const leftWidth = Math.floor((columns - 1) / 2);
    const rightWidth = columns - 1 - leftWidth;
    const left = [make("keys", leftWidth)];
    if (flavor.colors) left.push(make("colors", leftWidth));
    const right = [make("quality", rightWidth)];
    if (flavor.about) right.push(make("about", rightWidth));
    const columnHeight = Math.max(total(left), total(right));
    stretch(left, columnHeight);
    stretch(right, columnHeight);
    const children = [{ dir: "row", children: [{ dir: "col", children: left.map((panel) => ({ panel })) }, { dir: "col", children: right.map((panel) => ({ panel })) }] }];
    let height = columnHeight;
    if (wanted(flavor.measure)) {
      const measure = make("measure", columns);
      children.push({ panel: measure });
      height += flavor.gap + measure.natural;
    }
    if (flavor.guide) {
      const reading = make("guide", columns);
      children.push({ panel: reading });
      height += flavor.gap + reading.natural;
    }
    return { node: { dir: "col", gap: flavor.gap, children }, height };
  }
  const stack = [make("keys", columns), make("quality", columns)];
  if (flavor.colors) stack.push(make("colors", columns));
  if (wanted(flavor.measure)) stack.push(make("measure", columns));
  if (flavor.about) stack.push(make("about", columns));
  return { node: { dir: "col", gap: flavor.gap, children: stack.map((panel) => ({ panel })) }, height: total(stack) + flavor.gap * (stack.length - 1) };
}

function Lines({ lines }) {
  return lines.map((segments, i) => (
    <Text key={i} wrap="truncate-end">
      {segments.map((part, j) => <Text key={j} color={part.color} bold={part.bold} backgroundColor={part.background}>{part.text}</Text>)}
    </Text>
  ));
}

function Panel({ panel }) {
  return (
    <Box borderStyle="round" borderColor={theme.border} flexDirection="column" paddingX={1} width={panel.width} height={panel.height}>
      <Box justifyContent="space-between" width={panel.width - 4}>
        <Text bold color={theme.brand}>{panel.title}</Text>
        {panel.hint ? <Text color={theme.faint}>{panel.hint}</Text> : null}
      </Box>
      <Lines lines={panel.lines} />
    </Box>
  );
}

function Tree({ node }) {
  if (node.panel) return <Panel panel={node.panel} />;
  const spacer = node.dir === "row" ? <Box width={1} /> : (node.gap ? <Box height={node.gap} /> : null);
  const parts = [];
  node.children.forEach((child, i) => {
    if (i > 0 && spacer) parts.push(React.cloneElement(spacer, { key: `gap-${i}` }));
    parts.push(<Tree key={i} node={child} />);
  });
  return <Box flexDirection={node.dir}>{parts}</Box>;
}

// `height` is the room between the header and the status bar. The richest variant that fits is used.
export function HelpScreen({ columns, height, info }) {
  const chosen = useMemo(
    () => flavors.map((flavor) => compose(columns, flavor, info)).find((layout) => layout.height <= height)
      ?? compose(columns, flavors.at(-1), info),
    [columns, height, info]
  );
  const spare = height - chosen.height;
  return (
    <Box flexDirection="column" width={columns} height={height} overflow="hidden" justifyContent={spare >= 6 ? "center" : "flex-start"}>
      <Tree node={chosen.node} />
    </Box>
  );
}
