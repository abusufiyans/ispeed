import { EventEmitter } from "node:events";

const clearScreen = "\u001b[2J\u001b[H";
export const resizeQuietMs = 80;

// Ink repaints by erasing every line of the previous frame (ESC[2K ESC[1A per line, then ESC[G) and then
// writing the whole screen again. A terminal that paints between reads of a large frame shows the blank
// state in the middle, which is visible flicker on bigger terminals. Frames that replace a frame of the
// same height are rewritten here as an in-place update of only the lines that changed instead.
const erasePrefix = /^(?:\u001b\[2K\u001b\[1A)*\u001b\[2K\u001b\[G/;
const visibleWidth = (line) => [...line.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")].length;

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
    this.shown = null; // lines of the frame currently on screen, when known
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
      const update = this.frameUpdate(chunk);
      return update === "" ? true : this.real.write(update, ...rest);
    }
    return this.real.write(chunk, ...rest);
  }

  // Ink's frame as written: erase the previous frame's lines, then the new lines, each ending in "\n".
  // When the previous frame on screen is known and has the same height, return a single in-place update
  // that rewrites only the changed lines; otherwise return the frame untouched (and remember it).
  frameUpdate(chunk) {
    const prefix = erasePrefix.exec(chunk);
    const erased = prefix ? prefix[0].split("\u001b[2K").length - 1 : 0;
    const body = prefix ? chunk.slice(prefix[0].length) : chunk;
    const lines = body.split("\n");
    if (body === "" || lines.length < 2 || lines.at(-1) !== "") {
      this.shown = null; // an erase on its own, or not a frame: the screen state is no longer known
      return chunk;
    }
    const previous = this.shown;
    this.shown = lines;
    if (!previous || erased !== previous.length || lines.length !== previous.length) return chunk;

    const height = lines.length - 1;
    let update = "";
    for (let i = 0; i < height; i += 1) {
      if (lines[i] !== previous[i]) {
        // Rewrite the line over the old one, then clear whatever of the old line is left to its right (not
        // when the line fills the width: the cursor is on its last cell and would erase it).
        update += lines[i] + "\u001b[0m" + (visibleWidth(lines[i]) < this.size.columns ? "\u001b[K" : "");
      }
      update += "\n";
    }
    return update === "\n".repeat(height) ? "" : `\u001b[${height}A\u001b[G${update}`;
  }

  settle() {
    this.resizing = false;
    const changed = this.real.columns !== this.size.columns || this.real.rows !== this.size.rows;
    this.size = { columns: this.real.columns, rows: this.real.rows };
    this.real.write(clearScreen);
    this.shown = null;
    // A new size makes the app re-render (via `settled`) and paint itself. An unchanged size produces an
    // identical frame that Ink would skip, so repaint the latest one directly.
    if (!changed && this.latestFrame) this.real.write(this.frameUpdate(this.latestFrame));
    this.emit("settled", this.size);
  }
}
