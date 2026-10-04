// Wire-level throughput meter, fed by the fetch shim.
//
// The Cloudflare engine reports one rate per request. Summing those rates over-reads whenever
// concurrent requests finish at different times (a request that ran alone for its last stretch
// still reports its own average), so aggregate throughput is derived here from bytes on the wire.
//
// average() is the result (all bytes over first byte to last completion). live() only drives the
// display, and the two directions are observed differently:
//   download  bytes are seen as they arrive, so a trailing window is faithful.
//   upload    bytes are seen as they are handed to the socket, and the kernel accepts several MB
//             into its send buffers at once (about half of a 20 MB test within the first 300 ms,
//             then a trickle while that buffer drains). Any average over handed-off bytes is
//             therefore wrong early on, so uploads show the median of recent 100 ms buckets after
//             the opening burst: it ramps up instead of spiking, and settles on the real rate.
const WINDOW_MS = 1000;
const MIN_SPAN_MS = 250;
const BUCKET_MS = 100;
const UPLOAD_SKIP_MS = 400;
const UPLOAD_BUCKETS = 12;

const fresh = () => ({ events: [], buckets: new Map(), first: 0, last: 0, bytes: 0 });
const phases = { down: fresh(), up: fresh() };

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = (sorted.length - 1) / 2;
  return (sorted[Math.floor(mid)] + sorted[Math.ceil(mid)]) / 2;
};

export const meter = {
  rateLimit: null,

  reset() {
    phases.down = fresh();
    phases.up = fresh();
    this.rateLimit = null;
  },

  add(dir, count) {
    const phase = phases[dir];
    const now = performance.now();
    if (!phase.bytes) phase.first = now;
    phase.last = now;
    phase.bytes += count;
    if (dir === "down") {
      phase.events.push([now, count]);
    } else {
      const bucket = Math.floor((now - phase.first) / BUCKET_MS);
      phase.buckets.set(bucket, (phase.buckets.get(bucket) ?? 0) + count);
    }
  },

  // A request completed (upload: the server's ack arrived). Extends the phase to that moment.
  mark(dir) {
    if (phases[dir].bytes) phases[dir].last = performance.now();
  },

  // Mbps right now, for display.
  live(dir) {
    const phase = phases[dir];
    if (!phase.bytes) return 0;
    const now = performance.now();
    const elapsed = now - phase.first;
    if (dir === "up") {
      const current = Math.floor(elapsed / BUCKET_MS);
      const from = Math.max(UPLOAD_SKIP_MS / BUCKET_MS, current - UPLOAD_BUCKETS);
      if (current - from < 3) return 0;
      const rates = [];
      for (let i = from; i < current; i += 1) rates.push(((phase.buckets.get(i) ?? 0) * 8) / (BUCKET_MS / 1000) / 1e6);
      // While the kernel buffer drains few buckets are non-empty and the median reads low or zero. The
      // average of everything handed off after the burst also under-reads then (never over), so showing
      // the larger of the two gives visible life early without ever spiking.
      let after = 0;
      for (const [bucket, count] of phase.buckets) if (bucket >= UPLOAD_SKIP_MS / BUCKET_MS) after += count;
      const sustained = elapsed > UPLOAD_SKIP_MS + 300 ? (after * 8) / ((elapsed - UPLOAD_SKIP_MS) / 1000) / 1e6 : 0;
      return Math.max(median(rates), sustained);
    }
    if (elapsed < MIN_SPAN_MS) return 0;
    const span = Math.min(WINDOW_MS, elapsed);
    let bytes = 0;
    for (let i = phase.events.length - 1; i >= 0; i -= 1) {
      const [time, count] = phase.events[i];
      if (time < now - span) break;
      bytes += count;
    }
    return (bytes * 8) / (span / 1000) / 1e6;
  },

  // Mbps for the whole phase: every byte over the time from first byte to last completion.
  average(dir) {
    const phase = phases[dir];
    const seconds = (phase.last - phase.first) / 1000;
    return phase.bytes && seconds > 0 ? (phase.bytes * 8) / seconds / 1e6 : 0;
  }
};
