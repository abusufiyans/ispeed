import { EventEmitter } from "node:events";

const clearScreen = "\u001b[2J\u001b[H";
export const resizeQuietMs = 80;

// A window manager's tile/snap animates the terminal through many intermediate sizes a few
// milliseconds apart, and each one raises its own resize event. Reacting to every one (Ink does, by
// default: it re-lays-out and repaints immediately) clears and redraws the screen dozens of times,
// which shows as flicker. This wrapper is what Ink is given as its stdout:
//   - it never forwards `resize` to Ink; consumers listen for `settled` instead, which fires once
//     after the size has been stable for `resizeQuietMs`;
//   - `columns` and `rows` report the last settled size;
//   - frame writes are held back while a burst is in flight (they would be drawn at a size that no
//     longer exists), then the screen is cleared once and redrawn.
export class SettledStdout extends EventEmitter {
  constructor(real) {
    super();
    this.real = real;
    this.size = { columns: real.columns, rows: real.rows };
    this.resizing = false;
    this.latestFrame = null;
    this.timer = null;
    const onChange = () => {
      this.resizing = true;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.settle(), resizeQuietMs);
    };
    real.on("resize", onChange);
    // Node only emits `resize` when the size differs from the last one it saw. A window dragged away and
    // back (or several signals coalescing while the loop is busy) can end at the original size, having
    // reflowed the terminal in between, so the raw signal triggers a repaint as well.
    process.on("SIGWINCH", onChange);
  }

  get columns() { return this.size.columns; }
  get rows() { return this.size.rows; }
  get isTTY() { return this.real.isTTY; }
  get fd() { return this.real.fd; }

  write(chunk, ...rest) {
    // Frames are the long writes; short control sequences (cursor, mode switches) always pass.
    if (typeof chunk === "string" && chunk.length > 256) {
      this.latestFrame = chunk;
      if (this.resizing) return true;
    }
    return this.real.write(chunk, ...rest);
  }

  settle() {
    this.resizing = false;
    const changed = this.real.columns !== this.size.columns || this.real.rows !== this.size.rows;
    this.size = { columns: this.real.columns, rows: this.real.rows };
    this.real.write(clearScreen);
    // A new size makes the app re-render (via `settled`) and paint itself. An unchanged size produces an
    // identical frame that Ink would skip, so repaint the latest one directly.
    if (!changed && this.latestFrame) this.real.write(this.latestFrame);
    this.emit("settled", this.size);
  }
}
