FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --break-system-packages --no-cache-dir -U yt-dlp bgutil-ytdlp-pot-provider

RUN git clone --depth 1 --branch 2.0.0 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil \
    && cd /opt/bgutil/server \
    && npm ci \
    && npx tsc

WORKDIR /app
COPY start.sh /app/start.sh
COPY server.py /app/server.py
RUN chmod +x /app/start.sh

ENV PORT=10000
CMD ["/app/start.sh"]
