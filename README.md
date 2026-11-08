# PongMetrics Clips

A YouTube trimmer for the existing PongMetrics site at https://green-wave-01024401e.3.azurestaticapps.net/. The interface is installed in the neighbouring PongMetrics checkout under `frontend/public/clips/`, with a navigation link from the match workspace.

## The three requirements

1. **No paid subscription:** keep the existing Azure Static Web App on its Free plan. Run the video processor on your own PC. No Azure video-processing compute, storage account, paid API, or subscription upgrade is required. Your usual electricity and internet usage still apply.
2. **Only the finished clip is saved:** YouTube streams go into FFmpeg and its output goes directly into the browser download. The app never saves the source video, intermediate video/audio tracks, or temporary clips. There are no video uploads or media databases. Small stream buffers and job metadata stay in RAM. Python, Node and FFmpeg themselves need installation space. The browser/operating system controls the final download, including its normal partial-download file, caches and paging; the application cannot disable those internals.
3. **Maximum available source quality:** every downloadable, non-DRM video stream returned by yt-dlp is listed. There is no 720p/1080p ceiling. Original-quality MKV is the default: it copies the selected video stream and the best available audio without re-encoding, preserving source resolution, frame rate and HDR. YouTube decides what is actually available for each video and request. No tool can guarantee formats that YouTube withholds or refuses to serve.

**The free deployment uses your PC as the processor.** The public Azure page cannot download videos by itself. Each person using the page needs their own local processor, or access to one they operate. Closing the processor stops downloads. An always-on shared cloud processor is a different setup with possible costs; nothing here provisions it.

## Run now

The video tools are already installed in this checkout and the local processor was tested here.

```powershell
cd C:\Users\liang\OneDrive\Github\ytclips
npm.cmd start
```

Open http://127.0.0.1:8787/clips/. Paste a YouTube video link, load it, enter the start/end, and optionally preview the selection. Leave **MKV** selected for maximum source quality. Click **Prepare download**, then **Download clip**. Only the final clip goes to your browser's chosen download folder.

For another computer, install Node.js 22+ and Python 3.12+ with pip, then:

```powershell
npm.cmd run setup
npm.cmd start
```

There are no npm dependencies to install. Setup installs `yt-dlp[default]` (including its YouTube JavaScript solver) and `imageio-ffmpeg` (a bundled FFmpeg executable) into this project's ignored `.tools/python` folder. Node is explicitly enabled as yt-dlp's JavaScript runtime.

If Python is installed under a different command/path:

```powershell
npm.cmd run setup -- --python "C:\path\to\python.exe"
```

Copy `.env.example` to `.env` and set `PYTHON_BIN` to that interpreter if it is not on PATH. `YTDLP_BIN` and `FFMPEG_BIN` can alternatively point at tools you already have installed. This checkout currently detects its own `.venv/Scripts/python.exe` automatically; it does not require changing the neighbouring PongMetrics Python environment.

## Put it on your existing FREE Azure site

The local PongMetrics integration is already prepared and its production build passes. No Azure resources or paid plans were created, and no Git changes were committed or pushed for you.

1. Review the changes in `C:\Users\liang\OneDrive\Github\pongmetrics`. They add the `/clips/` assets, the workspace navigation link, and a small Vite build plugin. Existing match-analysis functionality and its commit/UTC footer remain in place.
2. Commit and push the intended PongMetrics changes to its `main` branch. Your existing `.github/workflows/azure-static-web-apps-green-wave-01024401e.yml` already builds `./frontend`, uploads `dist`, and uses the existing Azure deployment secret. No change to that workflow is needed.
3. Wait for the existing GitHub Actions deployment to succeed. Then open https://green-wave-01024401e.3.azurestaticapps.net/clips/. Use the trailing slash so relative assets resolve correctly.
4. Keep `npm.cmd start` running in the `ytclips` folder on your PC. The deployed page is configured to call `http://127.0.0.1:8787`. This address always means **the device running the browser**.
5. If the browser asks for access to your local network/device, allow it for your PongMetrics site if you want the hosted page to reach the local processor. Cross-origin requests are restricted to your exact Azure origin. If the browser blocks HTTPS-to-localhost access, use the complete tool directly at http://127.0.0.1:8787/clips/ instead. This is free and has no cross-origin dependency.

Stay on the Static Web Apps **Free** plan. Do not add a linked Container App, App Service, or storage account for this free setup. Microsoft's linked external API integration requires the Standard plan; this app instead makes direct browser-to-localhost requests. Azure's `/api` proxy is not used.

When updating the trimmer later, copy the new version into PongMetrics and rebuild:

```powershell
cd C:\Users\liang\OneDrive\Github\ytclips
npm.cmd run integrate -- --frontend ..\pongmetrics\frontend
cd ..\pongmetrics\frontend
npm.cmd run build
```

Then commit/push the intended PongMetrics changes to trigger its existing workflow. The integration command is repeatable and preserves other source changes. It refreshes the copied trimmer assets; edit the original files in `ytclips/public`, not the installed copies.

The added build plugin generates the trimmer footer on each production build from the source commit and a UTC timestamp. Dirty local builds show `-local`, consistent with the existing repository instructions. It supports `PONGMETRICS_COMMIT_SHA`, `BUILD_SOURCEVERSION`, `GITHUB_SHA`, and `SCM_COMMIT_ID` for CI.

## How it works

```text
Azure Free static interface (or the local interface)
  → local Node HTTP API, bound to 127.0.0.1
  → yt-dlp reads video metadata and signed media URLs (no downloads/cache)
  → FFmpeg reads the selected remote video/audio streams
  → stdout pipes directly to the browser download
  → one finished file
```

- **Frontend:** plain HTML, CSS and browser JavaScript. Matches PongMetrics' dark/red styling. Time inputs support seconds, `mm:ss`, `hh:mm:ss`, and millisecond precision. Two sliders adjust the range. Quality labels include source resolution, FPS, codec, container, HDR and format ID.
- **Preview:** an on-demand YouTube privacy-enhanced embed plays the selected interval. Its start/end are rounded to whole seconds. YouTube chooses preview playback quality independently of export quality. It creates no application video file. Some owners disable embedding; the source link remains available. Preview is not a guarantee that export will succeed.
- **Metadata:** `POST /api/inspect` queues a yt-dlp extraction, returns a job ID, then the browser polls `GET /api/jobs/:id`. Metadata includes all available unencrypted video streams; audio-only entries and storyboards are excluded.
- **Preparation:** `POST /api/clips` validates the selected stream and times, resolves source availability, and returns a short-lived random download capability. No media is produced or stored at this point.
- **Download:** `GET /api/files/:id?ticket=...` obtains fresh signed source URLs and starts FFmpeg. The endpoint name does not refer to a disk file. Output is piped directly to the HTTP response with backpressure; a slow browser pauses the producer instead of accumulating a complete clip in RAM. No JavaScript Blob or whole-video ArrayBuffer is used in the product.
- **Original-quality MKV:** maps the exact selected video and best available audio; uses `-c copy` and a streaming Matroska container. Preserves original codecs/HDR. Stream copy can start at an earlier keyframe, so the start is approximate. MKV/VP9/AV1/HDR may need VLC and may not play in PongMetrics' browser video player.
- **Compatible MP4:** uses accurate input seeking and a duration limit, H.264 CRF 18, AAC 192 kbps, original resolution and frame rate. Odd source dimensions are padded to even values. This is a high-quality re-encode, not lossless source preservation; it uses more CPU. HDR selections require MKV rather than silently converting HDR incorrectly. Streamed MP4 uses fragmented MP4 flags because a conventional fast-start MP4 requires a seekable output file.
- **Progress/cancellation:** extraction jobs are cancellable; streaming progress appears while the original page remains open. Cancelling the browser download closes the connection and stops FFmpeg. Interrupted downloads cannot resume because no server-side file exists; prepare/download again.
- **Capacity:** one extraction worker and one active media stream per processor. Waiting extraction jobs are capped at eight, total in-memory jobs at 100, new preparation requests at 15/minute per direct peer. Default clip length is 30 minutes and can be changed with `MAX_CLIP_SECONDS`. There is no resolution cap. Links and metadata expire after 60 minutes by default; server restarts clear all of them.
- **Safety:** accepts canonical HTTPS YouTube video links only, never arbitrary user-provided media URLs. Uses subprocess argument arrays without a shell. FFmpeg inputs must be trusted YouTube/Googlevideo HTTPS addresses. No client cookies are collected. CORS allows the existing Azure origin and local UI. Public binding requires a 16+ character server password; the default loopback binding needs none. Download tickets are unguessable capabilities and should be kept private.
- **Privacy:** no analytics, database, media uploads, cloud storage, or video files on the processor. The source URL is sent to YouTube. A preview contacts YouTube. The browser may use its usual caches; the app sends `Cache-Control: no-store` on exports. The software installation itself occupies disk space, independently of media.

## Files and settings

| File | Purpose |
| --- | --- |
| `server.mjs` | HTTP routes, authentication, jobs, streaming downloads, CORS |
| `media.mjs` | yt-dlp/FFmpeg subprocesses, cancellation, backpressure, readable errors |
| `lib.mjs` | URL/time validation, format list, safe filenames, FFmpeg arguments |
| `public/` | Standalone interface copied into PongMetrics |
| `scripts/setup.mjs` | Local video-tool installation/update |
| `scripts/integrate.mjs` | Installs `/clips/` and navigation/build metadata into PongMetrics |
| `scripts/check-youtube.mjs` | Optional real network smoke test; short output stays in memory |
| `test/` | API, validation, security and real FFmpeg checks |
| `Dockerfile` | Optional self-hosted container packaging; not needed for the free Azure/static + local setup |

Settings are documented in `.env.example`. Defaults: `HOST=127.0.0.1`, `PORT=8787`, `MAX_CLIP_SECONDS=1800`, `JOB_TTL_MINUTES=60`, `MAX_JOBS=100`. Secrets belong in the ignored `.env`, never in public `config.js`. `ALLOWED_ORIGINS` is an exact comma-separated allowlist; add a custom site origin there if you change domains.

## Verification and problems

Run `npm.cmd test` for URL/time/quality validation, API security, and a real FFmpeg precise-cut test. The FFmpeg test generates small disposable fixtures in the OS test temp directory and deletes them; production streaming creates no such files. `node scripts/check-youtube.mjs` checks real maximum-quality streaming with a two-second Blender video sample held in memory only. Run it with the local processor started. It is intentionally separate from offline tests because YouTube/network availability varies.

Known limits:

- YouTube can return 403/429, demand sign-in, restrict age/region, remove a stream, or block automated requests. All available qualities means what the current extraction actually returns; it is not a promise of access to every YouTube video. Updating yt-dlp is often necessary: rerun `npm.cmd run setup`. The first legacy yt-dlp test video was unavailable during development; the official Blender sample was available.
- Network input seeking may fetch extra surrounding segments/keyframes, or scan earlier data for some streams. It does not save a full source file, but cannot guarantee that only the exact clip's bytes cross the network. Original-quality, high-bitrate footage still consumes bandwidth and bounded processing memory.
- The final clip must fit on the destination device. Your browser controls its Downloads folder and may use a partial file while it is receiving the clip. This app does not bypass disk-space requirements for the final file.
- Source-copy MKV prioritizes quality over frame-exact cuts/browser compatibility. MP4 prioritizes precise cuts/compatibility and re-encodes. These are explicit choices rather than a silent quality downgrade.
- No durable queue, multi-machine coordination, download resume, or restart recovery. Metadata is in memory, and a stopped processor interrupts active streams.
- The Docker image was provided for portability, not deployed or built here. Moving processing to a cloud provider requires checking that provider's compute, storage and bandwidth charges; no always-free cloud backend is claimed.
- The production Azure deployment remains a commit/push through your existing workflow. The existing Azure account/plan was not inspected or changed.

References: [yt-dlp documentation](https://github.com/yt-dlp/yt-dlp), [YouTube JavaScript runtime requirements](https://github.com/yt-dlp/yt-dlp/wiki/EJS), [FFmpeg stream copy and seeking](https://ffmpeg.org/ffmpeg.html), [Azure Static Web Apps API constraints and Standard-only linked backends](https://learn.microsoft.com/en-us/azure/static-web-apps/apis-overview). Use downloads only for videos you own or have permission to use.
