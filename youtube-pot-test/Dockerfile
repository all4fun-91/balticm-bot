FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates nodejs npm \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --no-cache-dir -U yt-dlp bgutil-ytdlp-pot-provider

WORKDIR /app

COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

ENV PORT=10000
CMD ["/app/start.sh"]
