# BalticM yt-dlp + bgutil PO Token test

Separate Render test service. Does not replace the current youtube-resolver.

Render settings:
- Runtime: Docker
- Root Directory: youtube-pot-test
- Health Check Path: /health
- Instance: Free

After deploy:
GET /test?url=<encoded YouTube URL>

This tests whether yt-dlp can resolve a bestaudio URL while the bgutil PO Token provider is installed.
