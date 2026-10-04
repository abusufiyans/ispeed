import diagnostics from "node:diagnostics_channel";
import { Agent, setGlobalDispatcher } from "undici";
import { meter } from "./meter.js";

const originalFetch = globalThis.fetch;
const timings = new Map();
const chunk = Buffer.alloc(65536, 48);

setGlobalDispatcher(new Agent({
  connections: 32,
  pipelining: 1
}));

if (!globalThis.window) {
  globalThis.window = { location: { origin: "https://speed.cloudflare.com" } };
}

// A browser's PerformanceResourceTiming starts `requestStart` once the connection is up, and the
// engine derives latency from requestStart..responseStart. fetch() hides that split, so it is
// recovered from undici's diagnostics events. Without it the TCP+TLS handshake (about three round
// trips; Cloudflare closes idle-probe connections, so every probe pays it) lands in every ping and
// inflates both latency and jitter. Fetches are matched to undici requests by path, in call order.
const waiting = new Map();
const wire = new WeakMap();
let lastConnected = -1;
const channelNames = {
  "undici:request:create": (message, now) => {
    const queue = waiting.get(message.request.path);
    const record = queue?.shift();
    if (record) {
      record.created = now;
      wire.set(message.request, record);
    }
  },
  "undici:client:connected": (message, now) => {
    lastConnected = now;
  },
  "undici:client:sendHeaders": (message, now) => {
    const record = wire.get(message.request);
    if (record) {
      record.sent = now;
      // A connection finished between this request being queued and its headers going out: it paid a handshake.
      record.handshake = lastConnected >= (record.created ?? Infinity);
    }
  },
  "undici:request:headers": (message, now) => {
    const record = wire.get(message.request);
    if (record) record.headers = now;
  }
};
for (const [name, handler] of Object.entries(channelNames)) {
  diagnostics.subscribe(name, (message) => handler(message, performance.now()));
}

// Bandwidth requests carry a byte count; latency probes (bytes=0) and everything else are not metered.
const bandwidthDirection = (url) => {
  try {
    const { pathname, searchParams } = new URL(url);
    if (!Number(searchParams.get("bytes"))) return null;
    if (pathname.endsWith("/__down")) return "down";
    if (pathname.endsWith("/__up")) return "up";
  } catch {
    // Not an absolute URL; not one of ours.
  }
  return null;
};

// The engine uploads a string of zeros. Send the same bytes as a stream so progress is observable.
function meteredUploadBody(text) {
  const total = Buffer.byteLength(text);
  let sent = 0;
  return {
    total,
    stream: new ReadableStream({
      pull(controller) {
        if (sent >= total) return controller.close();
        const size = Math.min(chunk.length, total - sent);
        controller.enqueue(size === chunk.length ? chunk : chunk.subarray(0, size));
        sent += size;
        meter.add("up", size);
      }
    })
  };
}

if (originalFetch && !globalThis.__ispeedFetchShim) {
  globalThis.__ispeedFetchShim = true;
  const originalGetEntriesByName = performance.getEntriesByName.bind(performance);
  const originalClearResourceTimings = performance.clearResourceTimings.bind(performance);
  performance.getEntriesByName = (name, type) => (
    timings.has(name) ? timings.get(name) : originalGetEntriesByName(name, type)
  );
  performance.clearResourceTimings = () => {
    originalClearResourceTimings();
  };
  globalThis.fetch = async (input, init = {}) => {
    const started = performance.now();
    const direction = bandwidthDirection(String(input?.url || input));
    let options = init;
    if (direction === "up" && typeof init.body === "string") {
      const { total, stream } = meteredUploadBody(init.body);
      const headers = new Headers(init.headers);
      headers.set("content-length", String(total));
      options = { ...init, body: stream, headers, duplex: "half" };
    }
    const record = { path: null };
    try {
      const { pathname, search } = new URL(String(input?.url || input));
      record.path = pathname + search;
      if (!waiting.has(record.path)) waiting.set(record.path, []);
      waiting.get(record.path).push(record);
    } catch {
      // Not an absolute URL: fall back to unsplit timing below.
    }
    let response;
    try {
      response = await originalFetch(input, options);
    } finally {
      const queue = waiting.get(record.path);
      if (queue?.includes(record)) queue.splice(queue.indexOf(record), 1);
    }
    const headersAt = performance.now();
    const originalText = response.text.bind(response);
    const url = response.url || String(input);

    if (response.status === 429 && /speed\.cloudflare\.com\/__/.test(url)) {
      // The engine would wait out Retry-After (up to an hour); fail fast and let the UI explain.
      meter.rateLimit = { retryAfter: Number(response.headers.get("retry-after")) || null };
      response.body?.cancel().catch(() => {});
      throw new Error("Cloudflare rate limited the test request (HTTP 429).");
    }
    if (direction === "up") meter.mark("up");

    response.text = async () => {
      let body = "";
      let received = 0;
      if (direction === "down") {
        // The engine ignores the payload; count it as it arrives instead of buffering a string.
        for await (const part of response.body) {
          received += part.byteLength;
          meter.add("down", part.byteLength);
        }
      } else {
        body = await originalText();
      }
      const ended = performance.now();
      // Real connection/request split when undici reported it; otherwise unsplit (handshake included).
      const connectStart = record.created ?? started;
      const requestStart = Math.max(connectStart, record.sent ?? started);
      const responseStart = Math.max(requestStart, record.headers ?? headersAt);
      // A reused connection has no connect phase. Browsers report exactly zero there, which makes the
      // engine skip its server-time calibration; a near-zero but truthy value would instead make it
      // absorb a whole round trip and under-read every later ping in the run.
      const connectEnd = record.handshake ? requestStart : connectStart;
      const entries = timings.get(url) || [];
      entries.push({
        name: url,
        startTime: started,
        requestStart,
        responseStart,
        responseEnd: ended,
        connectStart,
        connectEnd,
        secureConnectionStart: connectStart,
        // undici's fetch speaks HTTP/1.1 only, so this is accurate rather than a guess.
        nextHopProtocol: "h1",
        transferSize: received || Number(response.headers.get("content-length")) || new TextEncoder().encode(body).length
      });
      timings.set(url, entries.slice(-32));
      return body;
    };
    return response;
  };
}
