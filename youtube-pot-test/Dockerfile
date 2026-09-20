FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git nodejs npm \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --no-cache-dir -U yt-dlp bgutil-ytdlp-pot-provider

# The PyPI package is the yt-dlp plugin only. Build the actual BgUtils
# token generator/server as well, matching the installed 2.0.x provider.
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
