# PongMetrics Clips

A YouTube video trimmer with quality selection, segment previews, and streamed downloads. It runs as a standalone local app or alongside the PongMetrics match workspace.

## Features

- Lists available video resolutions, frame rates, codecs, and HDR formats without a resolution cap.
- Supports timestamps in seconds, `mm:ss`, or `hh:mm:ss`, including milliseconds.
- Previews the selected segment with an embedded YouTube player.
- Exports original-quality MKV or compatible MP4 with audio.
- Streams exports directly to the browser without saving source videos or intermediate clips on the server.

## Requirements

- Node.js 22 or later
- Python 3.12 or later with pip
- Internet access to YouTube

The default setup runs video processing locally and requires no paid API or cloud subscription. Installing the software requires disk space; video processing uses the local machine's CPU, RAM, and network connection.

## Getting started

```sh
git clone https://github.com/sirhcl2037/ytclips.git
cd ytclips
npm run setup
npm start
```

Open [http://127.0.0.1:8787/clips/](http://127.0.0.1:8787/clips/).

Paste a YouTube link, load the video, select a time range and quality, then click **Prepare download** followed by **Download clip**. The processor must remain running during the download.

Setup installs `yt-dlp[default]` and `imageio-ffmpeg` into `.tools/python`. These provide the downloader, YouTube JavaScript solver, and FFmpeg executable. There are no npm package dependencies.

To use a specific Python interpreter:

```sh
npm run setup -- --python /path/to/python
```

If that interpreter is not on PATH, set `PYTHON_BIN` in `.env` as well. Rerunning `npm run setup` updates the video tools.

## Export formats

| Format | Behavior | Tradeoffs |
| --- | --- | --- |
| MKV (default) | Copies the selected video and best available audio without re-encoding. Preserves source resolution, frame rate, codecs, and HDR. | Cuts may begin at an earlier keyframe. Playback may require VLC; some formats will not play in the PongMetrics browser player. |
| MP4 | Re-encodes to H.264 and AAC at the selected resolution and frame rate for precise cuts and broad compatibility. | Uses more CPU and is not lossless. HDR exports currently require MKV. |

The preview uses YouTube playback, with boundaries rounded to whole seconds. Its playback quality is independent of the export selection. Videos with embedding disabled can still be opened through the source link.

If YouTube rejects the selected audio with a 403 before output starts, the processor retries with an available HLS audio stream and displays a notice. The selected video stream stays unchanged. For MKV, fallback audio is converted to lossless FLAC for container compatibility; MP4 uses its usual AAC encoding.

## Streaming and resource usage

```text
YouTube video and audio streams → FFmpeg → HTTP response → browser download
```

yt-dlp retrieves metadata and media URLs without downloading the source video. FFmpeg reads those URLs and sends the trimmed output through stdout to the browser. The browser writes the finished clip to its download destination.

The application does not save source videos, separate audio tracks, or temporary clips. Stream buffers and processing data use RAM. Backpressure pauses output when the browser cannot receive data fast enough, rather than buffering the whole video in memory. MP4 encoding can still use substantial memory, especially at high resolutions.

There is **no enforced byte limit on fetched data or hard RAM limit**. Depending on the source format, seeking may fetch surrounding segments or scan earlier footage. The clip duration limit does not limit total network traffic. Browsers may create partial-download files and caches, and the operating system may use disk-backed virtual memory.

## PongMetrics integration

From the `ytclips` repository, install the interface into a sibling PongMetrics checkout:

```sh
npm run integrate -- --frontend ../pongmetrics/frontend
cd ../pongmetrics/frontend
npm run build
```

The integration adds static assets under `frontend/public/clips/`, a workspace navigation link, and a Vite plugin for development routing and build identification. Edit the original assets in `ytclips/public/` and rerun the integration command to update the copies.

With the PongMetrics development server running:

- Main workspace: [http://127.0.0.1:5173/](http://127.0.0.1:5173/)
- Trimmer: [http://127.0.0.1:5173/clips/](http://127.0.0.1:5173/clips/)
- Video processor: `http://127.0.0.1:8787`

The video processor must run separately with `npm start` in this repository.

### Azure Static Web Apps

The interface can be included in the existing PongMetrics Azure Static Web Apps deployment on the Free plan. After integration, commit and push the PongMetrics changes to its deployment branch. The existing workflow builds `frontend` and uploads `dist`.

The deployed interface connects directly to the processor at `http://127.0.0.1:8787`. This address refers to the machine running the browser, so each user needs a local processor. Azure hosts only the static interface; it does not perform video processing.

Browsers may request local-network access or block connections from an HTTPS site to localhost. If that connection is unavailable, use the standalone local interface on port 8787.

A shared cloud processor requires separate hosting and may incur charges. The included Dockerfile provides container packaging but is not required for local use. This setup does not depend on Azure's linked backend API integration.

The build footer includes a commit identifier and UTC timestamp. CI builds can supply `PONGMETRICS_COMMIT_SHA`, `BUILD_SOURCEVERSION`, `GITHUB_SHA`, or `SCM_COMMIT_ID`; uncommitted local builds show `-local`.

## Configuration

Copy `.env.example` to `.env` to override the defaults.

| Setting | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Address the processor listens on |
| `PORT` | `8787` | HTTP port |
| `PYTHON_BIN` | Detected local virtual environment or system Python | Python interpreter for yt-dlp |
| `YTDLP_BIN` | Unset | Optional standalone yt-dlp executable |
| `FFMPEG_BIN` | Bundled FFmpeg or system executable | FFmpeg executable |
| `MAX_CLIP_SECONDS` | `1800` | Maximum output clip duration |
| `JOB_TTL_MINUTES` | `60` | Lifetime of in-memory jobs and download links |
| `MAX_JOBS` | `100` | Maximum retained jobs |
| `ALLOWED_ORIGINS` | Existing PongMetrics Azure origin | Additional allowed website origins, separated by commas |
| `APP_PASSWORD` | Unset | Processor password; at least 16 characters required for non-loopback binding |

The local interface and PongMetrics development origins on port 5173 are also allowed. Frontend connection settings can override the processor URL and store a password in the current tab's session storage. Keep secrets out of public configuration files.

## Development

```sh
npm run dev
npm test
```

Tests cover input validation, format selection, API access controls, accurate MP4 cuts, and streamed MP4 playback. The precise-cut test creates small temporary fixtures and deletes them afterward; the production export path does not use temporary media files.

An optional live check streams a short segment from the official Blender sample at its highest available quality and decodes the result in memory:

```sh
# Requires the processor to be running.
node scripts/check-youtube.mjs
```

| Path | Purpose |
| --- | --- |
| `server.mjs` | HTTP routes, jobs, access controls, and download streaming |
| `media.mjs` | yt-dlp and FFmpeg processes, cancellation, and stream backpressure |
| `lib.mjs` | URL and timestamp validation, format selection, and FFmpeg arguments |
| `public/` | Browser interface |
| `scripts/` | Setup, PongMetrics integration, and live checks |
| `test/` | Automated tests |
| `Dockerfile` | Optional container packaging |

## Limitations

- YouTube may block requests, require sign-in, restrict videos by region or age, or remove individual streams. Available quality depends on what YouTube returns for the request. Updating yt-dlp may resolve extraction failures.
- The processor supports one metadata worker and one active media download at a time. The pending queue is limited to eight jobs, and preparation requests are rate-limited.
- Jobs and download links exist only in memory. Restarting the processor clears them and interrupts active downloads.
- Interrupted downloads cannot resume because no server-side output file is retained.
- Maximum source quality and frame-exact cuts are separate export choices: MKV copies the source encoding; MP4 re-encodes for precise cuts.

Downloads should be limited to videos the user owns or has permission to use.

## References

- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [YouTube JavaScript runtime requirements](https://github.com/yt-dlp/yt-dlp/wiki/EJS)
- [FFmpeg documentation](https://ffmpeg.org/ffmpeg.html)
