const TARGETS = [
  { name: "Main Bot", urls: ["https://balticm.eu/discord-bot", "https://balticm.eu/discord-bot/"] },
  { name: "Reaction Roles", urls: ["https://balticm.eu/reactions", "https://balticm.eu/reactions/"] }
];

async function checkTarget(target) {
  let lastError = "No response";

  for (const url of target.urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "Accept": "application/json,text/plain,*/*",
          "User-Agent": "BalticM-Bot-Control-Center/1.1"
        }
      });

      clearTimeout(timer);

      const text = await response.text();
      let data = null;

      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text ? { response: text.slice(0, 300) } : null;
      }

      if (response.ok) {
        return {
          name: target.name,
          ok: true,
          status: response.status,
          url,
          data
        };
      }

      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError =
        error && error.name === "AbortError"
          ? "Request timed out"
          : String(error && error.message ? error.message : error);
    }
  }

  return {
    name: target.name,
    ok: false,
    status: 0,
    error: lastError
  };
}

export async function onRequestGet() {
  const services = await Promise.all(TARGETS.map(checkTarget));

  return Response.json(
    {
      ok: services.every((service) => service.ok),
      checkedAt: new Date().toISOString(),
      services
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Access-Control-Allow-Origin": "*"
      }
    }
  );
}
