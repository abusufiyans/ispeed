#!/usr/bin/env node
import "./timing-shim.js";
import React, { useCallback, useEffect, useRef, useState } from "react";
import fs from "node:fs";
import { render, Text, Box, useInput } from "ink";
import SpeedTest from "@cloudflare/speedtest";
import { appendHistory, readHistory } from "./history.js";
import { meter } from "./meter.js";
import { SettledStdout } from "./resize.js";
import { HelpScreen } from "./help.js";
import { theme } from "./theme.js";
import {
  GraphPanel, Header, HeroPanel, Intro, StatusBar, SummaryPanel,
  chooseLayout, spinnerFrames, summaryLines
} from "./ui.js";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.stderr.write("ispeed needs an interactive terminal.\n");
  process.exit(1);
}

const alternateScreen = "\u001b[?1049h\u001b[?25l\u001b[2J\u001b[H";
const normalScreen = "\u001b[?25h\u001b[?1049l";
let terminalRestored = false;
let shuttingDown = false;
let app = null;
const activeTests = new Set();
const originalConsole = globalThis.console;
const mutedConsole = Object.create(originalConsole);
const discard = () => {};
Object.defineProperties(mutedConsole, {
  log: { configurable: false, get: () => discard, set: () => {} },
  warn: { configurable: false, get: () => discard, set: () => {} }
});

function pauseAll() {
  for (const test of activeTests) {
    try { test.pause(); } catch { /* already stopped */ }
  }
  activeTests.clear();
}

function restoreTerminal() {
  if (!terminalRestored) {
    terminalRestored = true;
    globalThis.console = originalConsole;
    process.stdout.write(normalScreen);
  }
}

// The single exit path for q, Ctrl+C, signals and crashes.
function shutdown(code = 0, error) {
  if (shuttingDown) return;
  shuttingDown = true;
  pauseAll();
  // Unmount while still on the alternate screen: Ink paints a final frame on unmount, and that
  // frame has to land there (and be discarded) rather than on the user's shell.
  try { app?.unmount(); } catch { /* terminal is restored below regardless */ }
  restoreTerminal();
  if (error) process.stderr.write(`${error.stack || error}\n`);
  process.exit(code);
}

process.stdout.write(alternateScreen);
// Frames are repainted at animation rate. Terminals that support synchronized output (DEC mode 2026)
// apply each frame atomically; the rest ignore the markers. Short control writes pass through as-is.
const nativeWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => (
  typeof chunk === "string" && chunk.length > 256
    ? nativeWrite(`\u001b[?2026h${chunk}\u001b[?2026l`, ...rest)
    : nativeWrite(chunk, ...rest)
);
process.once("exit", restoreTerminal);
process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));
process.on("SIGHUP", () => shutdown(129));
process.on("uncaughtException", (error) => shutdown(1, error));
process.on("unhandledRejection", (error) => shutdown(1, error instanceof Error ? error : new Error(String(error))));

const latencyMeasurement = { type: "latency", numPackets: 20 };
const bandwidthMeasurement = (type) => ({
  type,
  bytes: 1e7,
  count: 1,
  bypassMinDuration: true
});
const engineOptions = {
  autoStart: false,
  logAimApiUrl: null,
  logMeasurementApiUrl: null,
  measureDownloadLoadedLatency: false,
  measureUploadLoadedLatency: false
};
const engineTimeoutMs = 45000;
const bandwidthWorkers = 2;
// Ink draws to this, not to process.stdout, so tile/snap resize bursts repaint once, not per event.
const terminal = new SettledStdout(process.stdout);
const frameMs = 50;
const phaseNames = { "locating server": "locating server", "latency / jitter": "latency", download: "download", upload: "upload" };
// Package details for the help screen's About panel. Repo and npm links fall back to obvious placeholders.
const info = (() => {
  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  } catch {
    // Running from an odd location: show defaults.
  }
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  return {
    version: pkg.version ?? "dev",
    license: pkg.license ?? "unlicensed",
    repo: repo ? repo.replace(/^git\+/, "").replace(/\.git$/, "").replace(/^https?:\/\//, "") : "github.com/<owner>/ispeed",
    name: pkg.name ?? "ispeed",
    npm: `npmjs.com/package/${pkg.name ?? "ispeed"}`
  };
})();
const version = info.version;

const value = (results, method) => {
  try {
    const result = results[method]();
    return Number.isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
};
const describe = (failure) => {
  if (meter.rateLimit) {
    const seconds = meter.rateLimit.retryAfter;
    return `Rate limited by Cloudflare${seconds ? `, try again in ~${Math.ceil(seconds / 60)} min` : ""}`;
  }
  return failure instanceof Error ? failure.message : String(failure);
};

function runEngine(measurements) {
  return new Promise((resolve, reject) => {
    const test = new SpeedTest({ ...engineOptions, measurements });
    let settled = false;
    const timeout = setTimeout(() => {
      test.pause();
      finish(reject, new Error("Cloudflare test timed out"));
    }, engineTimeoutMs);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      activeTests.delete(test);
      callback(value);
    };
    test.onError = (error) => finish(reject, error);
    test.onFinish = (results) => finish(resolve, results);
    activeTests.add(test);
    try {
      test.play();
    } catch (error) {
      finish(reject, error);
    }
  });
}

// The engines do the requesting; throughput comes from the wire-level meter so that concurrent
// requests aggregate into one honest number.
async function measureBandwidth(type) {
  const direction = type === "download" ? "down" : "up";
  await Promise.all(Array.from({ length: bandwidthWorkers }, () => runEngine([bandwidthMeasurement(type)])));
  const mbps = meter.average(direction);
  if (!mbps) throw new Error(`No ${type} data received`);
  return mbps;
}

function App() {
  const [dimensions, setDimensions] = useState({
    columns: terminal.columns || 80,
    rows: terminal.rows || 24
  });
  const [phase, setPhase] = useState("locating server");
  const phaseRef = useRef("locating server");
  const [location, setLocation] = useState("finding nearest edge…");
  const [ping, setPing] = useState(0);
  const [jitter, setJitter] = useState(0);
  const [running, setRunning] = useState(true);
  const runningRef = useRef(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(readHistory);
  const [previous, setPrevious] = useState(() => readHistory().at(-1) ?? null);
  const [current, setCurrent] = useState(null);
  const [help, setHelp] = useState(false);
  const [intro, setIntro] = useState(() => (terminal.columns || 80) >= 40 && (terminal.rows || 24) >= 14);
  const introStart = useRef(performance.now());
  const [animating, setAnimating] = useState(true);
  const [, setFrame] = useState(0);
  // Animation state lives in refs: the clock below writes it ~20 times a second.
  const shown = useRef({ down: 0, up: 0 });
  const finals = useRef({ down: 0, up: 0 });
  const samples = useRef([]);
  const lastSample = useRef({ down: 0, up: 0 });

  const go = useCallback((next) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  // `settled` fires once per resize burst, after the terminal has already been cleared.
  useEffect(() => {
    const onSettled = () => setDimensions({ columns: terminal.columns || 80, rows: terminal.rows || 24 });
    terminal.on("settled", onSettled);
    return () => terminal.off("settled", onSettled);
  }, []);

  useEffect(() => {
    if (!intro) return undefined;
    const timer = setTimeout(() => setIntro(false), 850);
    return () => clearTimeout(timer);
  }, [intro]);

  // The clock: eases the displayed numbers toward the meter's live reading (so they glide instead of
  // stepping), records the graph, and drives the spinner and pulse. It stops once everything is still.
  useEffect(() => {
    if (!animating) return undefined;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const ease = 1 - Math.exp(-Math.min(0.25, (now - last) / 1000) / 0.14);
      last = now;
      let moving = false;
      for (const dir of ["down", "up"]) {
        const active = phaseRef.current === (dir === "down" ? "download" : "upload");
        const target = active ? meter.live(dir) : finals.current[dir];
        const gap = target - shown.current[dir];
        const settling = Math.abs(gap) >= 0.01;
        shown.current[dir] = settling ? shown.current[dir] + gap * ease : target;
        moving = moving || settling;
        if ((active || (settling && finals.current[dir] > 0)) && now - lastSample.current[dir] >= 100) {
          lastSample.current[dir] = now;
          samples.current.push([now, shown.current[dir], dir]);
          if (samples.current.length > 600) samples.current.shift();
        }
      }
      setFrame((f) => f + 1);
      if (!runningRef.current && !moving && !intro) setAnimating(false);
    }, frameMs);
    return () => clearInterval(timer);
  }, [animating, intro]);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    globalThis.console = mutedConsole;
    meter.reset();
    shown.current = { down: 0, up: 0 };
    finals.current = { down: 0, up: 0 };
    samples.current = [];
    lastSample.current = { down: 0, up: 0 };
    setAnimating(true);
    setRunning(true);
    go("locating server");
    setLocation("finding nearest edge…");
    setPing(0);
    setJitter(0);
    setCurrent(null);
    setError("");
    setPrevious(readHistory().at(-1) ?? null);

    try {
      try {
        const trace = await fetch("https://speed.cloudflare.com/cdn-cgi/trace").then((response) => response.text());
        const fields = Object.fromEntries(trace.split("\n").filter(Boolean).map((line) => line.split("=")));
        setLocation(fields.colo ? `${fields.city || "Cloudflare"} (${fields.colo})` : "Cloudflare edge network");
      } catch {
        setLocation("Cloudflare edge network");
      }

      go("latency / jitter");
      const latencyResults = await runEngine([latencyMeasurement]);
      const pingMs = value(latencyResults, "getUnloadedLatency");
      const jitterMs = value(latencyResults, "getUnloadedJitter");
      setPing(pingMs);
      setJitter(jitterMs);

      go("download");
      const downloadMbps = await measureBandwidth("download");
      finals.current.down = downloadMbps;

      go("upload");
      const uploadMbps = await measureBandwidth("upload");
      finals.current.up = uploadMbps;

      const entry = {
        timestamp: new Date().toISOString(),
        download: downloadMbps,
        upload: uploadMbps,
        ping: pingMs,
        jitter: jitterMs
      };
      setHistory(appendHistory(entry));
      setCurrent(entry);
      go("done");
    } catch (failure) {
      pauseAll();
      go("error");
      setError(describe(failure));
    } finally {
      globalThis.console = originalConsole;
      runningRef.current = false;
      setRunning(false);
    }
  }, [go]);

  useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useInput((input, key) => {
    if (key.ctrl && input === "c") return shutdown(130);
    if (input === "q") return shutdown(0);
    if (intro) return setIntro(false);
    if (input === "h" || input === "?") return setHelp((open) => !open);
    if (key.escape) return setHelp(false);
    if (input === "r" && !runningRef.current) return run();
    return undefined;
  });

  // Ink repaints the whole terminal on every frame once output reaches the terminal's height,
  // so the layout stays one row short of it.
  const { columns } = dimensions;
  const height = Math.max(8, dimensions.rows - 1);
  const now = performance.now();

  if (intro) {
    return <Intro columns={columns} height={height} progress={Math.min(1, (now - introStart.current) / 560)} />;
  }

  const status = error
    ? { text: "✕ failed", color: theme.poor, bold: true }
    : running
      ? { text: `${spinnerFrames[Math.floor(now / 80) % spinnerFrames.length]} ${phaseNames[phase] ?? phase}`, color: theme.brand, bold: false }
      : { text: "● done", color: theme.brand, bold: true };
  const header = <Header columns={columns} location={location} status={status} />;
  const statusBar = <StatusBar columns={columns} helpOpen={help} version={version} />;

  if (help) {
    return (
      <Box flexDirection="column" width={columns} height={height}>
        {header}
        <HelpScreen columns={columns} height={height - 2} info={info} />
        {statusBar}
      </Box>
    );
  }

  const layout = chooseLayout(height, columns);
  const pulse = (Math.sin((now / 1000) * ((2 * Math.PI) / 1.8)) + 1) / 2;
  const stateOf = (dir, active) => (phase === active ? "active" : finals.current[dir] > 0 ? "done" : "idle");
  const firstWidth = Math.floor((columns - 1) / 2);
  const lines = summaryLines({
    columns, current, previous, history, ping, jitter, location, phase, error, lineCount: layout.lines
  });

  return (
    <Box flexDirection="column" width={columns} height={height}>
      {header}
      {layout.gap ? <Text> </Text> : null}
      <Box>
        <HeroPanel
          label="DOWNLOAD" arrow="↓" series="down" font={layout.font} pad={layout.pad} width={firstWidth} pulse={pulse}
          value={shown.current.down} state={stateOf("down", "download")} reference={previous?.download ?? 0}
        />
        <Box width={1} />
        <HeroPanel
          label="UPLOAD" arrow="↑" series="up" font={layout.font} pad={layout.pad} width={columns - 1 - firstWidth} pulse={pulse}
          value={shown.current.up} state={stateOf("up", "upload")} reference={previous?.upload ?? 0}
        />
      </Box>
      {layout.graphRows > 0 && <GraphPanel width={columns} height={layout.graphRows} samples={samples.current} running={running} />}
      <SummaryPanel width={columns} lines={lines} />
      <Box flexGrow={1} />
      {statusBar}
    </Box>
  );
}

app = render(<App />, { exitOnCtrlC: false, stdout: terminal });
// Ink swallows render errors unless someone is waiting on it. Any way out of the UI, including a crash
// while rendering, goes through the one shutdown path so the terminal is restored and the error shown.
app.waitUntilExit().then(() => shutdown(0), (error) => shutdown(1, error));
