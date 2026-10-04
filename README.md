# ispeed

A live internet speed test for your terminal, measured against Cloudflare's edge network.

> **macOS only for now.** This release targets macOS, so `npm install` will fail with an unsupported-platform error (`EBADPLATFORM`) on Windows and Linux. Support for both is coming soon.

## Install

```sh
npm install -g @abusufiyans/ispeed
```

## Usage

```sh
ispeed
```

The test starts as soon as it launches. It finds the nearest Cloudflare edge, measures latency and jitter, then download, then upload. When it finishes, ispeed stays open so you can run it again or read the result.

`ispeed` takes no command-line arguments. It needs an interactive terminal: if its input or output is piped or redirected, it prints a message and exits.

### Keybindings

| Key | Action |
| --- | --- |
| `h` | Show or hide the help screen |
| `?` | Same as `h` |
| `esc` | Close the help screen |
| `r` | Run the test again (ignored while a test is running) |
| `q` | Quit |
| `ctrl+c` | Quit |

The help screen also shows a colour key, the thresholds behind each quality rating, and a short explanation of how the numbers are measured.

## Features

- **Live dashboard.** Download and upload speeds are shown as large digits that update while the test runs, with a progress bar and a pulsing border on the phase that is currently active.
- **Throughput graph.** A braille-character graph plots download and then upload speed over the course of the run.
- **Latency and jitter.** Ping is the median of 20 probes taken before the bandwidth phases, so it reflects an idle connection. Jitter is the average change between consecutive probes.
- **Wire-level throughput.** Speed is every byte transferred over parallel streams, divided by elapsed time, rather than a sum of per-request rates.
- **Quality rating.** Each finished run gets a rating from Bad to Excellent, built from three 1 to 5 scores: speed, response (ping) and stability (jitter). The thresholds are listed in the help screen.
- **History.** Every completed run is appended to `~/.ispeed/history.json` as `{ timestamp, download, upload, ping, jitter }`. Each new run is compared with the previous one, with the change shown as a percentage, and the dashboard shows a trend line across your past runs.
- **Cloudflare edge detection.** The header shows which Cloudflare location you are connected to.
- **Adapts to the terminal.** The layout resizes with the window and reduces detail on smaller terminals. 80×24 or larger is recommended. Resizing, including a window being tiled or snapped, redraws once rather than flickering.
- **Clean exit.** Quitting by any route (`q`, `ctrl+c`, a signal, or a crash) restores your terminal and leaves nothing behind on screen.
- **Rate limit message.** If Cloudflare rate limits your address, ispeed says so and shows when to try again, instead of a generic error.

A run transfers roughly 40 MB (20 MB down, 20 MB up). On a slower connection it takes longer.

## Requirements

- Node.js 18 or newer
- macOS. This release supports macOS only. Windows and Linux support is coming soon.
- A terminal with Unicode support. True color is recommended.

## License

MIT
