import React from "react";
import { Box, Text } from "ink";
import { theme, blend, tierColor } from "./theme.js";
import { bigText, formatMbps } from "./font.js";
import { renderGraph, niceMax } from "./graph.js";
import { jitterScore, pingScore, rate } from "./quality.js";

export const spinnerFrames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const barScales = [50, 100, 250, 500, 1000, 2500, 5000, 10000];
const sparkBlocks = "▁▂▃▄▅▆▇█";
const seriesColor = { down: theme.down, up: theme.up };

export const seg = (text, color, bold = false, background) => ({ text, color, bold, background });
const length = (segments) => segments.reduce((sum, part) => sum + part.text.length, 0);
const faint = (text) => seg(text, theme.faint);

export const sparkline = (values, width) => {
  const recent = values.slice(-Math.max(1, width));
  const low = Math.min(...recent);
  const high = Math.max(...recent);
  return recent.map((v) => sparkBlocks[high === low ? 3 : Math.round(((v - low) / (high - low)) * 7)]).join("");
};

// What fits, richest first. Every row count is exact so the whole dashboard is one screen:
// header 1 + gap + hero panels + summary panel (border 2 + lines) + graph panel + status bar 1.
const heroRows = { 5: 9, 3: 7, 1: 4 };
const configs = [
  { gap: 1, pad: 1, font: 5, lines: 4, graphMin: 7 },
  { gap: 0, font: 5, lines: 3, graphMin: 7 },
  { gap: 0, font: 5, lines: 2, graphMin: 7 },
  { gap: 0, font: 3, lines: 3, graphMin: 7 },
  { gap: 0, font: 3, lines: 2, graphMin: 5 },
  { gap: 0, font: 3, lines: 1, graphMin: 5 },
  { gap: 0, font: 1, lines: 1, graphMin: 5 },
  { gap: 0, font: 1, lines: 1, graphMin: 0 }
];

export function chooseLayout(height, width) {
  for (const config of configs) {
    if (config.font === 5 && width < 55) continue;
    if (config.font === 3 && width < 40) continue;
    if (!config.graphMin) {
      // No room for the graph: give the summary every spare row.
      return { ...config, pad: 0, graphRows: 0, lines: Math.max(1, Math.min(4, height - 8)) };
    }
    const hero = heroRows[config.font] + (config.pad ?? 0) * 2; // pad = a blank row above and below the digits
    const graphRows = height - (1 + config.gap + hero + 2 + config.lines + 1);
    if (graphRows >= config.graphMin) {
      return { ...config, pad: config.pad ?? 0, graphRows: config.graphMin ? graphRows : 0 };
    }
  }
  return { ...configs.at(-1), pad: 0, graphRows: 0 };
}

export function Header({ columns, location, status }) {
  return (
    <Box width={columns} paddingX={1}>
      <Text bold color={theme.brand}>◈ ispeed</Text>
      <Text color={theme.borderDim}>   </Text>
      <Text color={theme.faint} wrap="truncate-end">{location}</Text>
      <Box flexGrow={1} />
      <Text color={status.color} bold={status.bold}>{status.text}</Text>
    </Box>
  );
}

export function HeroPanel({ label, arrow, series, value, state, width, font, pulse, reference, pad = 0 }) {
  const color = seriesColor[series];
  const inner = width - 4;
  const active = state === "active";
  const borderColor = active ? blend(theme.borderDim, color, 0.25 + 0.75 * pulse) : state === "done" ? theme.border : theme.borderDim;
  const labelColor = active ? blend(theme.muted, color, pulse) : state === "done" ? color : theme.faint;
  const digitColor = state === "idle" ? theme.border : color;
  const scale = barScales.find((s) => s >= Math.max(value, reference) * 1.1) ?? 10000;
  const barWidth = font === 1 ? Math.max(0, inner - 8) : inner;
  const filledNow = Math.max(0, Math.min(barWidth, Math.round((value / scale) * barWidth)));
  const bar = (
    <Text>
      <Text color={digitColor}>{"━".repeat(filledNow)}</Text>
      <Text color={theme.borderDim}>{"─".repeat(barWidth - filledNow)}</Text>
    </Text>
  );
  // Digits sit at a fixed, centred anchor (from the widest common reading) so they don't shift as the value grows.
  const anchor = font === 1 ? 0 : Math.max(0, Math.floor((inner - bigText("88.8", font)[0].length) / 2));
  const indent = " ".repeat(anchor);
  const title = `${arrow} ${label}`;
  const heading = (
    <Box justifyContent="space-between" width={inner}>
      <Text bold color={labelColor} wrap="truncate-end">{title}</Text>
      {inner >= title.length + 6 ? <Text color={theme.faint}>Mbps</Text> : null}
    </Box>
  );
  return (
    <Box borderStyle="round" borderColor={borderColor} flexDirection="column" paddingX={1} width={width}>
      {heading}
      {pad ? <Text> </Text> : null}
      {font === 1
        ? <Text wrap="truncate-end"><Text bold color={digitColor}>{formatMbps(value).padEnd(8)}</Text>{bar}</Text>
        : bigText(formatMbps(value), font).map((row, index) => <Text key={index} color={digitColor}>{indent}{row}</Text>)}
      {pad ? <Text> </Text> : null}
      {font === 1 ? null : bar}
    </Box>
  );
}

export function GraphPanel({ width, height, samples, running }) {
  const inner = width - 4;
  const axis = 5;
  const cells = Math.max(8, inner - axis);
  const rows = height - 3;
  const start = samples.length ? samples[0][0] : 0;
  const last = samples.length ? samples.at(-1)[0] : 0;
  const window = Math.max(10000, last - start + 300);
  const peak = samples.reduce((m, s) => Math.max(m, s[1]), 0);
  const max = niceMax(Math.max(peak, 5));
  const grid = renderGraph({ width: cells, rows, samples, start, window, max });
  const colorFor = (series) => seriesColor[series] ?? theme.borderDim;
  return (
    <Box borderStyle="round" borderColor={theme.borderDim} flexDirection="column" paddingX={1} width={width}>
      <Box justifyContent="space-between" width={inner}>
        <Text>
          <Text bold color={theme.muted}>Throughput  </Text>
          <Text color={theme.down}>●</Text><Text color={theme.faint}> download  </Text>
          <Text color={theme.up}>●</Text><Text color={theme.faint}> upload</Text>
        </Text>
        <Text color={theme.faint}>{peak > 0 ? `peak ${formatMbps(peak)} Mbps` : running ? "waiting for data" : ""}</Text>
      </Box>
      {grid.map((row, index) => {
        const groups = [];
        for (const cell of row) {
          const previous = groups.at(-1);
          if (previous && previous.series === cell.series) previous.text += cell.char;
          else groups.push({ series: cell.series, text: cell.char });
        }
        const label = index === 0 ? String(max) : index === rows - 1 ? "0" : "";
        return (
          <Box key={index}>
            <Text color={theme.faint}>{label.padStart(axis - 1)} </Text>
            {groups.map((group, i) => <Text key={i} color={colorFor(group.series)}>{group.text}</Text>)}
          </Box>
        );
      })}
    </Box>
  );
}

const dots = (score) => "●".repeat(score) + "○".repeat(5 - score);
const phaseNotes = {
  "locating server": "Finding the nearest Cloudflare edge…",
  "latency / jitter": "Measuring round-trip time with 20 probes…",
  download: "Downloading from the edge over parallel streams…",
  upload: "Uploading to the edge over parallel streams…"
};

const change = (label, now, before) => {
  if (!before) return null;
  const percent = Math.round(((now - before) / before) * 100);
  const color = Math.abs(percent) < 5 ? theme.muted : percent > 0 ? theme.good : theme.poor;
  return seg(percent === 0 ? `${label} unchanged` : `${label} ${percent > 0 ? "↑" : "↓"} ${Math.abs(percent)}% ${percent > 0 ? "faster" : "slower"}`, color);
};

// Summary rows in priority order; the layout decides how many fit.
export function summaryLines({ columns, current, previous, history, ping, jitter, location, phase, error, lineCount }) {
  const inner = columns - 4;
  const measured = ping > 0;
  const statsParts = [
    faint("PING "),
    seg(measured ? `${ping.toFixed(1)} ms` : "—", theme.muted),
    ...(measured ? [seg(" ●", tierColor(pingScore(ping)))] : []),
    faint("      JITTER "),
    seg(measured ? `${jitter.toFixed(1)} ms` : "—", theme.muted),
    ...(measured ? [seg(" ●", tierColor(jitterScore(jitter)))] : []),
  ];
  const server = [faint("      SERVER "), seg(location, theme.muted)];
  const stats = length([...statsParts, ...server]) <= inner ? [...statsParts, ...server] : statsParts;

  let verdict;
  if (error) {
    verdict = [seg(`⚠ ${error}`, theme.poor), faint("  ·  press r to retry")];
  } else if (current) {
    const q = rate(current);
    const color = tierColor(q.overall);
    const head = [faint("QUALITY  "), seg(dots(q.overall), color), seg(`  ${q.label}`, color, true)];
    const subs = [
      faint("     Speed "), seg(dots(q.speed), tierColor(q.speed)),
      faint("   Response "), seg(dots(q.response), tierColor(q.response)),
      faint("   Stability "), seg(dots(q.stability), tierColor(q.stability))
    ];
    const note = [seg(`   ${q.verdict}`, theme.muted)];
    verdict = [[...head, ...subs, ...note], [...head, ...subs], [...head, ...note], head].find((v) => length(v) <= inner);
  } else {
    verdict = [faint(phaseNotes[phase] ?? "")];
  }

  let compare;
  const fmt = (e) => `${formatMbps(e.download)} ↓  ${formatMbps(e.upload)} ↑  ${e.ping.toFixed(1)} ms`;
  if (!previous) {
    compare = [faint("LAST RUN  "), seg(current ? "none before this one" : "none yet, this will be your first", theme.muted)];
  } else if (current) {
    const down = change("Download", current.download, previous.download);
    const up = change("Upload", current.upload, previous.upload);
    const variants = [
      [faint("LAST RUN  "), seg(fmt(previous), theme.muted), faint("      "), down, faint("   "), up],
      [faint("VS LAST RUN  "), down, faint("   "), up],
      [faint("VS LAST  "), down, faint("  "), up]
    ];
    compare = variants.find((v) => length(v) <= inner) ?? variants.at(-1);
  } else {
    compare = [faint("LAST RUN  "), seg(fmt(previous), theme.muted)];
  }

  const spark = Math.max(6, Math.min(24, Math.floor((inner - 34) / 2)));
  const trend = history.length
    ? [
      faint("TREND     "), seg("↓ ", theme.down), seg(sparkline(history.map((e) => e.download), spark), theme.down),
      faint("   "), seg("↑ ", theme.up), seg(sparkline(history.map((e) => e.upload), spark), theme.up),
      faint(`   ${history.length} run${history.length === 1 ? "" : "s"}`)
    ]
    : [faint("TREND     "), seg("builds up as you run more tests", theme.muted)];

  const ordered = current && lineCount === 1 ? [verdict] : [stats, verdict, compare, trend];
  return ordered.slice(0, lineCount);
}

export function SummaryPanel({ width, lines }) {
  return (
    <Box borderStyle="round" borderColor={theme.borderDim} flexDirection="column" paddingX={1} width={width}>
      {lines.map((segments, index) => (
        <Text key={index} wrap="truncate-end">
          {segments.filter(Boolean).map((part, i) => <Text key={i} color={part.color} bold={part.bold}>{part.text}</Text>)}
        </Text>
      ))}
    </Box>
  );
}

export function StatusBar({ columns, helpOpen, version }) {
  const hints = [["r", "run again"], ["h", helpOpen ? "close help" : "help"], ["q", "quit"]];
  const width = (list) => list.reduce((sum, [k, label]) => sum + k.length + 2 + label.length + 3, 1);
  const right = `ispeed v${version} `;
  // Widest variant that fits: full hints + version, full hints, then bare keys.
  const variants = [
    { list: hints, right },
    { list: hints, right: "" },
    { list: hints.map(([k, label]) => [k, label.split(" ")[0]]), right: "" }
  ];
  const chosen = variants.find((v) => width(v.list) + v.right.length <= columns) ?? variants.at(-1);
  const used = width(chosen.list) + chosen.right.length;
  return (
    <Text backgroundColor={theme.barBg} wrap="truncate-end">
      <Text color={theme.muted}> </Text>
      {chosen.list.map(([k, label]) => (
        <Text key={k}>
          <Text backgroundColor={theme.brand} color="#0B1220" bold>{` ${k} `}</Text>
          <Text color={theme.muted}>{` ${label}  `}</Text>
        </Text>
      ))}
      <Text color={theme.muted}>{" ".repeat(Math.max(0, columns - used))}</Text>
      <Text color={theme.faint}>{chosen.right}</Text>
    </Text>
  );
}

export const wrapText = (text, width) => {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
};

export function Intro({ columns, height, progress }) {
  const letters = [..."ispeed"];
  const palette = [theme.brand, "#38BDF8", theme.down, "#A78BFA", theme.up, "#E879F9"];
  const shown = Math.floor(progress * (letters.length + 1));
  const rows = [0, 1, 2, 3, 4].map((row) => letters.map((letter, i) => (i < shown ? bigText(letter, 5)[row] : "     ")));
  return (
    <Box width={columns} height={height} flexDirection="column" alignItems="center" justifyContent="center">
      {rows.map((cells, row) => (
        <Box key={row}>
          {cells.map((cell, i) => <Text key={i} color={palette[i]}>{cell}{i < cells.length - 1 ? " " : ""}</Text>)}
        </Box>
      ))}
      <Text> </Text>
      <Text color={progress > 0.7 ? theme.faint : theme.borderDim}>terminal speed test · cloudflare edge</Text>
    </Box>
  );
}
