FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN python3 -m venv /opt/video && /opt/video/bin/pip install --no-cache-dir 'yt-dlp[default]'
ENV PYTHON_BIN=/opt/video/bin/python FFMPEG_BIN=ffmpeg HOST=0.0.0.0 PORT=8787
COPY --chown=node:node package.json server.mjs media.mjs lib.mjs ./
COPY --chown=node:node public ./public
USER node
EXPOSE 8787
CMD ["node", "server.mjs"]
