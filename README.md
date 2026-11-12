# ytbarber

ytbarber trims YouTube videos into downloadable clips. Paste a link, choose a time range and video quality, and export the clip as MP4 or MKV. The browser interface and video processor run locally by default.

## Getting started

Requires Node.js 22 or later, Python 3.12 or later with pip, and internet access to YouTube.

```sh
git clone https://github.com/sirhcl2037/ytbarber.git
cd ytbarber
npm run setup
npm start
```

Open [ytbarber](http://127.0.0.1:8787/clips/). Load a YouTube link, set the start and end times, and choose an available video stream. Use **Preview selection** to check the segment, then select **Prepare download** and **Download clip**. Keep the processor running until the download finishes.

`npm run setup` installs yt-dlp and FFmpeg into `.tools/python`. Run it again to update the tools if YouTube extraction stops working. To use a specific Python interpreter, run `npm run setup -- --python /path/to/python` and set `PYTHON_BIN` in `.env`.

## Export formats

| Format | When to use it |
| --- | --- |
| MKV (default) | Preserve the selected source video encoding, resolution, frame rate, and HDR. Cuts can begin at an earlier keyframe. |
| MP4 | Get precise cuts and broad playback compatibility. Video is re-encoded to H.264 and audio to AAC. HDR export requires MKV. |

The quality menu lists the streams yt-dlp finds for the video. The preview uses YouTube's embedded player, which chooses its own playback quality and rounds the clip boundaries to whole seconds. Some videos disable embedding.

If YouTube rejects an audio stream before the download starts, ytbarber can retry with an alternate stream while preserving the selected video quality. MKV uses lossless FLAC for this fallback audio.

## How downloads work

FFmpeg reads the selected YouTube streams, trims them, and pipes the output directly to the browser. The processor does not save the full source video or create temporary media files. The browser writes the clip to its download folder, typically as a partial file until the transfer finishes.

The processor uses the computer's network, CPU, and RAM. Seeking can fetch extra footage around the selected segment, and high-resolution MP4 encoding can use substantial memory. The clip length limit applies to the output duration. Fetch size and RAM usage have no hard caps.

## Configuration

Copy `.env.example` to `.env` to override the defaults.

| Setting | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `8787` | HTTP port |
| `PYTHON_BIN` | Local virtual environment or system Python | Python interpreter |
| `YTDLP_BIN` | Unset | Optional standalone yt-dlp executable |
| `FFMPEG_BIN` | Bundled FFmpeg or system executable | FFmpeg executable |
| `MAX_CLIP_SECONDS` | `1800` | Maximum output duration in seconds |
| `JOB_TTL_MINUTES` | `60` | Lifetime of jobs and download links |
| `MAX_JOBS` | `100` | Maximum retained jobs |
| `ALLOWED_ORIGINS` | Built-in origins | Comma-separated origins for a separately hosted frontend |
| `APP_PASSWORD` | Unset | Required when binding to a non-loopback address, with a minimum of 16 characters |

The default local setup requires no paid API or cloud subscription. A Dockerfile is available for container-based setups.

## Limitations

- YouTube may block requests or restrict access to individual videos and formats.
- The processor handles one active media download at a time.
- Jobs and download links are stored in memory. Restarting the processor clears them, and interrupted downloads need to start again.

## Development

Run `npm run dev` to restart the server automatically when source files change. Run `npm test` after setup to check input validation, API behavior, and FFmpeg exports. With the server running, `node scripts/check-youtube.mjs` runs an optional live download check in memory.
