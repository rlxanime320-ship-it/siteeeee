FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/yt-dlp \
  && /opt/yt-dlp/bin/pip install --no-cache-dir --upgrade pip yt-dlp

ENV PATH="/opt/yt-dlp/bin:${PATH}"
ENV NODE_ENV=production
WORKDIR /app
COPY media-provider/server.mjs ./server.mjs

CMD ["node", "server.mjs"]
