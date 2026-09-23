import http from "node:http";
import { randomUUID } from "node:crypto";
import { Shoukaku, Connectors } from "shoukaku";

import {
  ChannelType,
  Client,
  GatewayIntentBits,
  SlashCommandBuilder
} from "discord.js";

import play from "@iamtraction/play-dl";

/*
 * ============================================================
 * BALTICM MUSIC SERVICE
 * v1.8.0-player-controls
 * ============================================================
 *
 * Supported input:
 *
 *   /play song name
 *   /play YouTube URL
 *   /play YouTube Music URL
 *   /play SoundCloud URL
 *   /play Spotify URL
 *   /play Deezer URL
 *   /play Apple Music URL
 *
 * Playback:
 *
 *   YouTube / SoundCloud -> playable source
 *
 * Spotify / Deezer / Apple Music ->
 *   metadata / page title ->
 *   playable source search
 *
 * ============================================================
 */

const PORT = Number(process.env.PORT || 3000);

const DISCORD_TOKEN =
  process.env.DISCORD_TOKEN ||
  process.env.DISCORD_BOT_TOKEN ||
  "";

const SERVICE_SECRET =
  process.env.BALTICM_MUSIC_SERVICE_SECRET ||
  "";

const CONTROL_URL =
  (
    process.env.BALTICM_CONTROL_URL ||
    "https://bot.balticm.eu"
  ).replace(/\/$/, "");

/*
 * ============================================================
 * DISCORD CLIENT
 * ============================================================
 */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const LAVALINK_HOST = String(process.env.LAVALINK_HOST || "").trim();
const LAVALINK_PORT = String(process.env.LAVALINK_PORT || "").trim();
const LAVALINK_PASSWORD = String(process.env.LAVALINK_PASSWORD || "").trim();
const LAVALINK_SECURE = /^(1|true|yes|on)$/i.test(
  String(process.env.LAVALINK_SECURE || "false").trim()
);

const LAVALINK_NODES = [
  ...(LAVALINK_HOST && LAVALINK_PORT && LAVALINK_PASSWORD
    ? [{
        name: "KeritGermany",
        url: `${LAVALINK_HOST}:${LAVALINK_PORT}`,
        auth: LAVALINK_PASSWORD,
        secure: LAVALINK_SECURE
      }]
    : [])
];

console.log(
  "[BalticM Lavalink] Configured nodes:",
  LAVALINK_NODES.map(node => node.name).join(", ")
);

if (!LAVALINK_HOST || !LAVALINK_PORT || !LAVALINK_PASSWORD) {
  console.warn(
    "[BalticM Lavalink] Kerit env vars incomplete; no Lavalink node is available."
  );
}

const shoukaku = new Shoukaku(
  new Connectors.DiscordJS(client),
  LAVALINK_NODES,
  {
    resume: true,
    resumeTimeout: 120,
    resumeByLibrary: true,
    reconnectTries: 5,
    reconnectInterval: 5,
    moveOnDisconnect: true,
    restTimeout: 20,
    voiceConnectionTimeout: 20
  }
);

function lavaDiag(event, data = {}) {
  console.log(
    `[BalticM DIAG ${new Date().toISOString()}] ${event}`,
    data
  );
}

shoukaku.on("ready", name => {
  console.log(`[BalticM Lavalink] READY: ${name}`);
  lavaDiag("NODE READY", { node: name });
});

shoukaku.on("error", (name, error) => {
  console.error(`[BalticM Lavalink] ERROR: ${name}`, error);
  lavaDiag("NODE ERROR", {
    node: name,
    error: error?.message || String(error)
  });
});

shoukaku.on("close", (name, code, reason) => {
  console.warn(`[BalticM Lavalink] CLOSE: ${name} code=${code} reason=${reason || ""}`);
  lavaDiag("NODE CLOSE", {
    node: name,
    code,
    reason: reason || ""
  });
});

shoukaku.on("disconnect", (name, count) => {
  lavaDiag("NODE DISCONNECT", {
    node: name,
    reconnectsLeft: count
  });
});

/*
 * Lavalink RAW diagnostics.
 * Shoukaku 4.3.0 receives PLAYER_UPDATE and EVENT packets here.
 */
const rawPlayerDiag = new Map();

shoukaku.on("raw", (name, packet) => {
  if (!packet || typeof packet !== "object") return;

  const now = Date.now();

  if (packet.op !== "stats") {
    console.log(
      `[BalticM RAW ${new Date().toISOString()}]`,
      {
        node: name,
        op: packet.op ?? null,
        type: packet.type ?? null,
        guildId: packet.guildId ?? null,
        sessionId: packet.op === "ready" ? packet.sessionId ?? null : undefined,
        resumed: packet.op === "ready" ? packet.resumed ?? null : undefined,
        state: packet.op === "playerUpdate" ? packet.state ?? null : undefined
      }
    );
  }

  if (packet.op === "stats") {
    const previousStatsAt = rawPlayerDiag.get("__stats_at__") || 0;
    if (now - previousStatsAt >= 60000) {
      rawPlayerDiag.set("__stats_at__", now);
      lavaDiag("NODE STATS", {
        node: name,
        players: packet.players ?? null,
        playingPlayers: packet.playingPlayers ?? null,
        uptime: packet.uptime ?? null,
        cpu: packet.cpu ?? null,
        frameStats: packet.frameStats ?? null
      });
    }
    return;
  }

  if (packet.op === "playerUpdate") {
    const guildId = packet.guildId || "unknown";
    const state = packet.state || {};

    const position = Number(state.position ?? 0);
    const ping = Number(state.ping ?? -1);

    const previous = rawPlayerDiag.get(guildId);

    const updateGapMs =
      previous
        ? now - previous.at
        : null;

    const positionDelta =
      previous
        ? position - previous.position
        : null;

    lavaDiag("RAW PLAYER UPDATE", {
      node: name,
      guildId,
      position,
      positionDelta,
      ping,
      updateGapMs,
      connected: state.connected ?? null
    });

    rawPlayerDiag.set(guildId, {
      at: now,
      position
    });

    return;
  }

  if (packet.op === "event") {
    const interestingEvents = new Set([
      "TrackStuckEvent",
      "TrackExceptionEvent",
      "WebSocketClosedEvent",
      "TrackStartEvent",
      "TrackEndEvent"
    ]);

    if (interestingEvents.has(packet.type)) {
      lavaDiag(`RAW ${packet.type}`, {
        node: name,
        guildId: packet.guildId || null,
        thresholdMs: packet.thresholdMs ?? null,
        code: packet.code ?? null,
        reason: packet.reason ?? null,
        byRemote: packet.byRemote ?? null,
        exception: packet.exception ?? null
      });
    }
  }
});

/*
 * ============================================================
 * PLAYERS
 * ============================================================
 */

const players = new Map();

/*
 * ============================================================
 * DIAGNOSTICS
 * ============================================================
 */

const diagnostic = {
  pid: process.pid,

  tokenConfigured: Boolean(DISCORD_TOKEN),
  tokenLength: DISCORD_TOKEN
    ? DISCORD_TOKEN.length
    : 0,

  loginStarted: false,
  loginResolved: false,
  clientReady: false,

  readyAt: null,
  user: null,

  lastError: null,
  lastErrorAt: null
};

function safeError(error) {
  if (!error) {
    return "Unknown error";
  }

  return String(
    error?.stack ||
    error?.message ||
    error
  ).slice(0, 2000);
}

function setLastError(error) {
  diagnostic.lastError =
    safeError(error);

  diagnostic.lastErrorAt =
    new Date().toISOString();

  console.error(
    "[BalticM Music]",
    diagnostic.lastError
  );
}

/*
 * ============================================================
 * HTTP HELPERS
 * ============================================================
 */

function json(
  res,
  status,
  body
) {
  res.writeHead(
    status,
    {
      "Content-Type":
        "application/json; charset=utf-8",

      "Cache-Control":
        "no-store"
    }
  );

  res.end(
    JSON.stringify(body)
  );
}

function authorized(req) {
  if (!SERVICE_SECRET) {
    return false;
  }

  return (
    req.headers[
      "x-balticm-service-secret"
    ] === SERVICE_SECRET
  );
}

async function readBody(req) {
  let body = "";

  for await (
    const chunk
    of req
  ) {
    body += chunk;

    if (
      body.length >
      1024 * 1024
    ) {
      throw new Error(
        "Request body too large"
      );
    }
  }

  if (!body) {
    return {};
  }

  return JSON.parse(body);
}

/*
 * ============================================================
 * DISCORD STATUS
 * ============================================================
 */

function getDiscordStatus() {
  return {
    tokenConfigured:
      diagnostic.tokenConfigured,

    tokenLength:
      diagnostic.tokenLength,

    loginStarted:
      diagnostic.loginStarted,

    loginResolved:
      diagnostic.loginResolved,

    clientReady:
      client.isReady(),

    readyEventReceived:
      diagnostic.clientReady,

    wsStatus:
      client.ws?.status ?? null,

    readyAt:
      diagnostic.readyAt,

    user:
      diagnostic.user,

    guilds:
      client.guilds.cache.size,

    lastError:
      diagnostic.lastError,

    lastErrorAt:
      diagnostic.lastErrorAt
  };
}

/*
 * ============================================================
 * SMALL HELPERS
 * ============================================================
 */

function isHttpUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function hostnameOf(value) {
  try {
    return new URL(value)
      .hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

function publicTrack(track) {
  if (!track) {
    return null;
  }

  return {
    id: track.id || null,
    title:
      track.title || null,

    artist:
      track.artist || null,

    url:
      track.originalUrl ||
      track.playbackUrl ||
      null,

    playbackUrl:
      track.playbackUrl ||
      null,

    source:
      track.source ||
      null,

    requestedBy:
      track.requestedBy ||
      null,

    duration:
      track.duration ||
      null,

    thumbnail:
      track.thumbnail ||
      null
  };
}

/*
 * ============================================================
 * PLAYER STATE
 * ============================================================
 */

function getGuildState(guildId) {
  const player = players.get(guildId);
  if (!player) {
    return { connected:false, channelId:null, channelName:null, listeners:0, queue:[], queueLength:0, playing:false, paused:false, volume:100, loopMode:"off", currentTrack:null };
  }
  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels.cache.get(player.channelId);
  const listeners = channel?.members?.filter(member => !member.user.bot).size || 0;
  const lava = shoukaku.players.get(guildId);
  return {
    connected: Boolean(lava),
    voiceConnected: Boolean(player.voiceConnected),
    position: player.position || 0,
    ping: player.ping ?? null,
    lastPlayerUpdate: player.lastPlayerUpdate || null,
    error: player.lastPlaybackError || null,
    channelId: player.channelId,
    channelName: channel?.name || player.channelName || null,
    listeners,
    queue: (player.queue || []).map(publicTrack),
    queueLength: player.queue?.length || 0,
    playing: Boolean(player.currentTrack) && !player.paused,
    paused: Boolean(player.paused),
    volume: player.volume ?? 100,
    loopMode: player.loopMode || "off",
    currentTrack: publicTrack(player.currentTrack)
  };
}

/*
 * ============================================================
 * PLAYER CREATION
 * ============================================================
 */

/* Lavalink owns the Discord audio player in v1.5. */

/*
 * ============================================================
 * VOICE DIAGNOSTIC BUFFER
 * Keeps the latest voice connection events in memory so they
 * can be inspected from the public health endpoint.
 * ============================================================
 */

const voiceDiagnostic = [];
const VOICE_DIAGNOSTIC_LIMIT = 100;

function normalizeVoiceDiagnosticValue(value) {
  if (value instanceof Error) {
    return {
      name: value.name || "Error",
      message: value.message || String(value)
    };
  }

  if (value && typeof value === "object") {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }

  return value ?? null;
}

function pushVoiceDiagnostic(level, event, data = null) {
  voiceDiagnostic.push({
    time: new Date().toISOString(),
    pid: process.pid,
    level,
    event,
    data: normalizeVoiceDiagnosticValue(data)
  });

  if (voiceDiagnostic.length > VOICE_DIAGNOSTIC_LIMIT) {
    voiceDiagnostic.splice(
      0,
      voiceDiagnostic.length - VOICE_DIAGNOSTIC_LIMIT
    );
  }
}

function voiceLog(event, data = null) {
  pushVoiceDiagnostic("info", event, data);
  if (data === null) {
    console.log(`[BalticM Voice] ${event}`);
  } else {
    console.log(`[BalticM Voice] ${event}`, data);
  }
}

function voiceError(event, data = null) {
  pushVoiceDiagnostic("error", event, data);
  if (data === null) {
    console.error(`[BalticM Voice] ${event}`);
  } else {
    console.error(`[BalticM Voice] ${event}`, data);
  }
}

/*
 * ============================================================
 * CONNECT PLAYER
 * ============================================================
 */

const guildOperations = new Map();
function withGuild(guildId, operation) {
  const previous = guildOperations.get(guildId) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  guildOperations.set(guildId, current);
  current.finally(() => { if (guildOperations.get(guildId) === current) guildOperations.delete(guildId); }).catch(() => {});
  return current;
}
function connectPlayer(guildId, channelId) {
  const normalizedGuildId = String(guildId || "").trim();
  const normalizedChannelId = String(channelId || "").trim();
  return withGuild(normalizedGuildId, () => connectPlayerUnlocked(normalizedGuildId, normalizedChannelId));
}
async function connectPlayerUnlocked(guildId, channelId) {
  if (!client.isReady()) throw new Error("Discord client is not ready");
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error("Guild not found");
  const channel =
    guild.channels.cache.get(channelId) ||
    await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) throw new Error("Voice channel not found");
  if (channel.guildId && channel.guildId !== guildId) {
    throw new Error("Voice channel does not belong to this guild");
  }
  if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
    throw new Error("Selected channel is not a voice channel");
  }

  voiceLog("LAVALINK CONNECT START",{guildId,channelId,channelName:channel.name});
  let state=players.get(guildId);
  let lava=shoukaku.players.get(guildId);

  if (lava && state?.channelId !== channelId) {
    await shoukaku.leaveVoiceChannel(guildId).catch(()=>{});
    lava=null;
    if (state) { state.currentTrack = null; state.paused = false; }
  }
  if (!lava) {
    lava=await shoukaku.joinVoiceChannel({
      guildId,
      channelId,
      shardId: guild.shardId ?? 0,
      deaf: true,
      mute: false
    });
  }

  if (!state) {
    state={guildId,channelId,channelName:channel.name,queue:[],volume:100,loopMode:"off",currentTrack:null,paused:false,connectedAt:Date.now()};
    players.set(guildId,state);
  } else {
    state.channelId=channelId;
    state.channelName=channel.name;
  }
  state.lavalinkPlayer=lava;

  if (state.eventsPlayer !== lava) {
    state.eventsPlayer=lava;
    lava.on("end", data => {
      lavaDiag("TRACK END", {
        guildId,
        node: lava.node?.name || null,
        reason: data?.reason || null
      });

      if (!["finished", "loadFailed"].includes(data?.reason)) return;
      const playbackId = data?.track?.userData?.playbackId;
      withGuild(guildId, async () => {
        const p = players.get(guildId);
        if (!p || p.lavalinkPlayer !== lava || !p.currentTrack) return;
        if (playbackId && p.currentTrack.playbackId !== playbackId) return;
        if (!playbackId && data?.track?.encoded !== p.currentTrack.lavalinkEncoded) return;
        const completedTrack = p.currentTrack;
        p.currentTrack = null; p.paused = false;
        if (data?.reason === "finished" && p.loopMode === "track") {
          completedTrack.playbackRecoveryAttempts = 0;
          completedTrack.forceSearchFallback = false;
          p.queue.unshift(completedTrack);
        } else if (data?.reason === "finished" && p.loopMode === "queue") {
          completedTrack.playbackRecoveryAttempts = 0;
          completedTrack.forceSearchFallback = false;
          p.queue.push(completedTrack);
        }
        await playNext(guildId);
      }).catch(setLastError);
    });

    lava.on("exception", data => {
      lavaDiag("TRACK EXCEPTION", {
        guildId,
        node: lava.node?.name || null,
        message: data?.exception?.message || "unknown",
        severity: data?.exception?.severity || null,
        cause: data?.exception?.cause || null
      });

      const playbackError = new Error(
        `Lavalink track exception: ${data?.exception?.message || "unknown"}`
      );

      withGuild(guildId, async () => {
        const p = players.get(guildId);
        if (!p || p.lavalinkPlayer !== lava || !p.currentTrack) return;

        const playbackId = data?.track?.userData?.playbackId;
        if (playbackId && p.currentTrack.playbackId !== playbackId) return;

        const failedTrack = p.currentTrack;
        p.currentTrack = null;
        p.paused = false;

        if (Number(failedTrack.playbackRecoveryAttempts || 0) < 1) {
          failedTrack.playbackRecoveryAttempts = Number(failedTrack.playbackRecoveryAttempts || 0) + 1;
          failedTrack.forceSearchFallback = true;
          failedTrack.lavalinkEncoded = null;
          p.queue.unshift(failedTrack);
          await playNext(guildId);
          return;
        }

        p.lastPlaybackError = "Audio source failed. Skipped to the next track.";
        setLastError(playbackError);
        if (p.queue.length) await playNext(guildId);
      }).catch(setLastError);
    });

    lava.on("stuck", data => {
      withGuild(guildId, async () => {
        const p = players.get(guildId);
        if (!p || p.lavalinkPlayer !== lava || !p.currentTrack) return;
        if (data?.track?.userData?.playbackId && data.track.userData.playbackId !== p.currentTrack.playbackId) return;
        p.lastPlaybackError = "The audio source stalled. Skipped to the next track.";
        await lava.stopTrack();
        p.currentTrack = null; p.paused = false;
        await playNext(guildId);
      }).catch(setLastError);
      lavaDiag("TRACK STUCK", {
        guildId,
        node: lava.node?.name || null,
        thresholdMs: data?.thresholdMs || null
      });

      setLastError(
        new Error(
          `Lavalink track stuck: ${data?.thresholdMs || "unknown"}ms`
        )
      );
    });

    lava.on("closed", data => {
      lavaDiag("VOICE WEBSOCKET CLOSED", {
        guildId,
        node: lava.node?.name || null,
        code: data?.code || null,
        reason: data?.reason || null,
        byRemote: data?.byRemote ?? null
      });
    });

    let lastDiagPosition = null;
    let lastDiagAt = 0;

    lava.on("update", data => {
      if (players.get(guildId)?.lavalinkPlayer === lava) {
        const p = players.get(guildId);
        p.voiceConnected = Boolean(data?.state?.connected ?? data?.connected);
        p.lastPlayerUpdate = Date.now();
        p.position = Number(data?.state?.position ?? data?.position ?? 0);
        p.ping = Number(data?.state?.ping ?? data?.ping ?? -1);
      }
      const now = Date.now();
      const position =
        Number(data?.state?.position ?? data?.position ?? 0);

      const ping =
        Number(data?.state?.ping ?? data?.ping ?? -1);

      const deltaMs =
        lastDiagAt
          ? now - lastDiagAt
          : null;

      const positionDelta =
        lastDiagPosition !== null
          ? position - lastDiagPosition
          : null;

      if (!lastDiagAt || now - lastDiagAt >= 5000) {
        lavaDiag("PLAYER UPDATE", {
          guildId,
          node: lava.node?.name || null,
          position,
          positionDelta,
          ping,
          updateGapMs: deltaMs,
          paused: players.get(guildId)?.paused || false
        });

        lastDiagAt = now;
        lastDiagPosition = position;
      }
    });
  }

  voiceLog("LAVALINK CONNECTED",{guildId,channelId,node:lava.node?.name || null});
  return getGuildState(guildId);
}

/*
 * ============================================================
 * DISCONNECT PLAYER
 * ============================================================
 */

function disconnectPlayer(guildId) {
  return withGuild(guildId, async () => {
    await shoukaku.leaveVoiceChannel(guildId);
    players.delete(guildId);
    return getGuildState(guildId);
  });
}

/*
 * ============================================================
 * HTML METADATA
 *
 * Used as fallback for Apple Music and other music URLs.
 * ============================================================
 */

async function getPageMetadata(
  url
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      8000
    );

  try {
    const response =
      await fetch(
        url,
        {
          redirect: "follow",

          signal:
            controller.signal,

          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; BalticM-Music/1.3)",

            "Accept":
              "text/html,application/xhtml+xml"
          }
        }
      );

    if (!response.ok) {
      throw new Error(
        `Metadata request failed (${response.status})`
      );
    }

    const html =
      (
        await response.text()
      ).slice(
        0,
        1000000
      );

    const property = name => {
      const patterns = [
        new RegExp(
          `<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
          "i"
        ),

        new RegExp(
          `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${name}["'][^>]*>`,
          "i"
        ),

        new RegExp(
          `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
          "i"
        )
      ];

      for (
        const pattern
        of patterns
      ) {
        const match =
          html.match(pattern);

        if (match?.[1]) {
          return cleanText(
            decodeHtml(
              match[1]
            )
          );
        }
      }

      return "";
    };

    const titleMatch =
      html.match(
        /<title[^>]*>([\s\S]*?)<\/title>/i
      );

    return {
      title:
        property(
          "og:title"
        ) ||
        cleanText(
          decodeHtml(
            titleMatch?.[1] || ""
          )
        ),

      description:
        property(
          "og:description"
        ),

      image:
        property(
          "og:image"
        )
    };
  } finally {
    clearTimeout(
      timer
    );
  }
}

/*
 * ============================================================
 * YOUTUBE SEARCH
 * ============================================================
 */

async function searchYouTube(
  query
) {
  const results =
    await play.search(
      query,
      {
        limit: 1,

        source: {
          youtube:
            "video"
        }
      }
    );

  const video =
    results?.[0];

  if (
    !video ||
    !video.url
  ) {
    throw new Error(
      `No playable result found for "${query}"`
    );
  }

  return {
    title:
      video.title ||
      query,

    artist:
      video.channel?.name ||
      video.channel?.title ||
      null,

    playbackUrl:
      video.url,

    source:
      "YouTube",

    duration:
      video.durationRaw ||
      null,

    thumbnail:
      video.thumbnails?.[
        video.thumbnails.length - 1
      ]?.url ||
      null
  };
}

/*
 * ============================================================
 * YOUTUBE URL
 * ============================================================
 */

async function resolveYouTube(
  url
) {
  let info = null;

  try {
    info =
      await play.video_info(
        url
      );
  } catch {
    info = null;
  }

  const details =
    info?.video_details;

  return {
    title:
      details?.title ||
      "YouTube",

    artist:
      details?.channel?.name ||
      details?.channel?.title ||
      null,

    originalUrl:
      url,

    playbackUrl:
      url,

    source:
      "YouTube",

    duration:
      details?.durationRaw ||
      null,

    thumbnail:
      details?.thumbnails?.[
        details.thumbnails.length - 1
      ]?.url ||
      null
  };
}

/*
 * ============================================================
 * SOUNDCLOUD
 * ============================================================
 */

async function resolveSoundCloud(
  url
) {
  // Strip SoundCloud playlist/set context such as ?in=user/sets/playlist.
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    url = parsed.toString();
  } catch {}

  let info = null;

  try {
    info =
      await play.soundcloud(
        url
      );
  } catch {
    info = null;
  }

  return {
    title:
      info?.name ||
      info?.title ||
      "SoundCloud track",

    artist:
      info?.user?.name ||
      info?.publisher_metadata?.artist ||
      null,

    originalUrl:
      url,

    playbackUrl:
      url,

    source:
      "SoundCloud",

    duration:
      info?.durationInSec
        ? `${Math.floor(info.durationInSec / 60)}:${String(info.durationInSec % 60).padStart(2, "0")}`
        : null,

    thumbnail:
      info?.thumbnail ||
      null
  };
}

/*
 * ============================================================
 * SPOTIFY
 * ============================================================
 */

async function resolveSpotify(
  url
) {
  let searchQuery = "";

  let title = "";
  let artist = "";
  let thumbnail = null;

  /*
   * First try play-dl's Spotify metadata.
   */

  try {
    const data =
      await play.spotify(
        url
      );

    title =
      cleanText(
        data?.name ||
        data?.title ||
        ""
      );

    if (
      Array.isArray(
        data?.artists
      )
    ) {
      artist =
        cleanText(
          data.artists
            .map(
              item =>
                item?.name ||
                item
            )
            .filter(Boolean)
            .join(", ")
        );
    } else {
      artist =
        cleanText(
          data?.artist?.name ||
          data?.artist ||
          ""
        );
    }

    thumbnail =
      data?.thumbnail?.url ||
      data?.thumbnail ||
      null;
  } catch {
    // HTML fallback below
  }

  /*
   * Spotify metadata fallback.
   */

  if (!title) {
    try {
      const meta =
        await getPageMetadata(
          url
        );

      title =
        meta.title
          .replace(
            /\s*[|–-]\s*Spotify.*$/i,
            ""
          )
          .replace(
            /\s*song and lyrics by\s*/i,
            " "
          )
          .trim();

      thumbnail =
        thumbnail ||
        meta.image ||
        null;
    } catch {
      // ignore
    }
  }

  searchQuery =
    cleanText(
      `${artist} ${title}`
    );

  if (!searchQuery) {
    throw new Error(
      "Could not read this Spotify link."
    );
  }

  const playable =
    await searchYouTube(
      searchQuery
    );

  return {
    ...playable,

    title:
      title ||
      playable.title,

    artist:
      artist ||
      playable.artist,

    originalUrl:
      url,

    source:
      "Spotify → YouTube",

    thumbnail:
      thumbnail ||
      playable.thumbnail
  };
}

/*
 * ============================================================
 * DEEZER
 * ============================================================
 */

async function resolveDeezer(
  url
) {
  let title = "";
  let artist = "";
  let thumbnail = null;

  try {
    const data =
      await play.deezer(
        url
      );

    title =
      cleanText(
        data?.title ||
        data?.name ||
        ""
      );

    artist =
      cleanText(
        data?.artist?.name ||
        data?.artist ||
        ""
      );

    thumbnail =
      data?.thumbnail ||
      data?.cover ||
      null;
  } catch {
    // HTML fallback
  }

  if (!title) {
    try {
      const meta =
        await getPageMetadata(
          url
        );

      title =
        meta.title
          .replace(
            /\s*[|–-]\s*Deezer.*$/i,
            ""
          )
          .trim();

      thumbnail =
        thumbnail ||
        meta.image ||
        null;
    } catch {
      // ignore
    }
  }

  const searchQuery =
    cleanText(
      `${artist} ${title}`
    );

  if (!searchQuery) {
    throw new Error(
      "Could not read this Deezer link."
    );
  }

  const playable =
    await searchYouTube(
      searchQuery
    );

  return {
    ...playable,

    title:
      title ||
      playable.title,

    artist:
      artist ||
      playable.artist,

    originalUrl:
      url,

    source:
      "Deezer → YouTube",

    thumbnail:
      thumbnail ||
      playable.thumbnail
  };
}

/*
 * ============================================================
 * APPLE MUSIC
 * ============================================================
 */

async function resolveAppleMusic(
  url
) {
  const meta =
    await getPageMetadata(
      url
    );

  let title =
    cleanText(
      meta.title
    );

  title =
    title
      .replace(
        /\s*[|–-]\s*Apple Music.*$/i,
        ""
      )
      .replace(
        /^.*? by /i,
        match => match
      )
      .trim();

  let searchQuery =
    title;

  /*
   * Apple often exposes useful track information
   * in the OG description too.
   */

  if (
    meta.description &&
    meta.description.length < 300
  ) {
    const description =
      cleanText(
        meta.description
      );

    if (
      !searchQuery ||
      searchQuery.length < 3
    ) {
      searchQuery =
        description;
    }
  }

  if (!searchQuery) {
    throw new Error(
      "Could not read this Apple Music link."
    );
  }

  const playable =
    await searchYouTube(
      searchQuery
    );

  return {
    ...playable,

    originalUrl:
      url,

    source:
      "Apple Music → YouTube",

    thumbnail:
      meta.image ||
      playable.thumbnail
  };
}

/*
 * ============================================================
 * GENERIC MUSIC URL
 * ============================================================
 */

async function resolveGenericUrl(
  url
) {
  const meta =
    await getPageMetadata(
      url
    );

  const query =
    cleanText(
      meta.title ||
      meta.description
    );

  if (!query) {
    throw new Error(
      "Could not determine the song from this URL."
    );
  }

  const playable =
    await searchYouTube(
      query
    );

  return {
    ...playable,

    originalUrl:
      url,

    source:
      "Web → YouTube",

    thumbnail:
      meta.image ||
      playable.thumbnail
  };
}

/*
 * ============================================================
 * TRACK RESOLVER
 * ============================================================
 */

async function searchSoundCloud(query) {
  const node = shoukaku.getIdealNode();
  if (!node) throw new Error("No Lavalink node is ready.");

  const result = await node.rest.resolve(`scsearch:${cleanText(query)}`);
  let found = null;

  if (result?.loadType === "search") {
    found = Array.isArray(result.data) ? result.data[0] || null : null;
  } else if (result?.loadType === "track") {
    found = result.data || null;
  }

  if (!found?.info?.uri) {
    throw new Error(`No SoundCloud result found for "${query}"`);
  }

  return {
    title: found.info.title || query,
    artist: found.info.author || null,
    originalUrl: null,
    playbackUrl: found.info.uri,
    source: "SoundCloud",
    duration: found.info.length || null,
    thumbnail: found.info.artworkUrl || null,
    lavalinkEncoded: found.encoded || null
  };
}

async function resolveTrack(
  input,
  requestedBy = null,
  source = "auto"
) {
  const query =
    cleanText(
      input
    );

  if (!query) {
    throw new Error(
      "Enter a song name or music URL."
    );
  }

  let track;

  /*
   * Plain song name.
   */

  if (!isHttpUrl(query)) {
    const selectedSource = String(source || "auto").toLowerCase();

    if (selectedSource === "soundcloud" || selectedSource === "auto") {
      const startedAt = Date.now();
      track = await searchSoundCloud(query);
      console.log(`[BalticM Search] SoundCloud via Kerit: ${Date.now() - startedAt}ms | ${query}`);
    } else if (selectedSource === "spotify") {
      throw new Error("Spotify source currently requires a Spotify track URL.");
    } else {
      const startedAt = Date.now();
      track = await searchYouTube(query);
      track.originalUrl = null;
      console.log(`[BalticM Search] YouTube metadata search: ${Date.now() - startedAt}ms | ${query}`);
    }
  } else {
    const host =
      hostnameOf(
        query
      );

    /*
     * YouTube / YouTube Music
     */

    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtu.be"
    ) {
      track =
        await resolveYouTube(
          query
        );
    }

    /*
     * SoundCloud
     */

    else if (
      host === "soundcloud.com" ||
      host === "m.soundcloud.com" ||
      host === "on.soundcloud.com"
    ) {
      track =
        await resolveSoundCloud(
          query
        );
    }

    /*
     * Spotify
     */

    else if (
      host === "open.spotify.com"
    ) {
      track =
        await resolveSpotify(
          query
        );
    }

    /*
     * Deezer
     */

    else if (
      host === "deezer.com" ||
      host.endsWith(
        ".deezer.com"
      ) ||
      host === "deezer.page.link"
    ) {
      track =
        await resolveDeezer(
          query
        );
    }

    /*
     * Apple Music
     */

    else if (
      host === "music.apple.com"
    ) {
      track =
        await resolveAppleMusic(
          query
        );
    }

    /*
     * Unknown music/web link.
     */

    else {
      track =
        await resolveGenericUrl(
          query
        );
    }
  }

  track.requestedBy =
    requestedBy;

  return track;
}

/*
 * ============================================================
 * CREATE AUDIO RESOURCE
 * ============================================================
 */

async function resolveLavalinkTrack(track) {
  const lava = track?.guildId ? shoukaku.players.get(track.guildId) : null;
  const node = lava?.node || shoukaku.getIdealNode();
  if (!node) throw new Error("No Lavalink node is ready.");

  let identifier = track?.playbackUrl || track?.originalUrl || `ytsearch:${track?.artist ? track.artist + " " : ""}${track?.title || ""}`;

  // A normal YouTube watch URL can carry Mix/radio playlist parameters.
  // Lavalink then returns loadType=playlist instead of a single track.
  // Strip those parameters when the request points at one concrete video.
  try {
    const parsed = new URL(identifier);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (
      (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") &&
      parsed.pathname === "/watch" &&
      parsed.searchParams.get("v")
    ) {
      identifier = `https://www.youtube.com/watch?v=${encodeURIComponent(parsed.searchParams.get("v"))}`;
    }
  } catch {
    // Search identifiers such as ytsearch: are not URLs; leave them unchanged.
  }

  const youtubeVideoId = (() => {
    try {
      const parsed = new URL(identifier);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      if (host === "youtu.be") return parsed.pathname.split("/").filter(Boolean)[0] || null;
      if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
        return parsed.searchParams.get("v") || null;
      }
    } catch {}
    return null;
  })();

  const title = cleanText(track?.title || "");
  const artist = cleanText(track?.artist || "");
  const usefulTitle = title && !/^youtube$/i.test(title) ? title : "";
  const searchText = cleanText(`${artist} ${usefulTitle}`) || youtubeVideoId;
  const isYouTube = Boolean(youtubeVideoId) || /youtube/i.test(String(track?.source || ""));
  const candidates = [];

  if (!track?.forceSearchFallback) candidates.push(identifier);
  if (isYouTube && searchText) candidates.push(`ytsearch:${searchText}`);
  if (isYouTube && usefulTitle) candidates.push(`scsearch:${searchText}`);
  if (!candidates.length) candidates.push(identifier);

  let lastDetail = "no track";
  for (const candidate of [...new Set(candidates)]) {
    let result;
    try {
      result = await node.rest.resolve(candidate);
    } catch (error) {
      lastDetail = error?.message || String(error);
      continue;
    }

    let found = null;
    if (result?.loadType === "track") {
      found = result.data || null;
    } else if (result?.loadType === "search") {
      found = Array.isArray(result.data) ? result.data[0] || null : null;
    } else if (result?.loadType === "playlist") {
      const tracks = result?.data?.tracks;
      const selectedTrack = Number(result?.data?.info?.selectedTrack);
      found =
        (Array.isArray(tracks) && Number.isInteger(selectedTrack) && selectedTrack >= 0
          ? tracks[selectedTrack]
          : null) ||
        (Array.isArray(tracks) ? tracks[0] || null : null);
    } else {
      const legacyList =
        result?.data && Array.isArray(result.data)
          ? result.data
          : (result?.data?.tracks && Array.isArray(result.data.tracks)
              ? result.data.tracks
              : (result?.data ? [result.data] : []));
      found = legacyList[0] || result?.tracks?.[0] || null;
    }

    if (found?.encoded) {
      track.forceSearchFallback = false;
      return found;
    }

    lastDetail = result?.data?.message || result?.data?.cause || result?.loadType || "no track";
  }

  throw new Error(`Lavalink could not resolve: ${track?.title || identifier} (${lastDetail})`);
}

/*
 * ============================================================
 * PLAY NEXT
 * ============================================================
 */

async function playNext(guildId) {
  const player=players.get(guildId);
  if (!player || player.currentTrack) return player?.currentTrack || null;
  const next=player.queue.shift();
  if (!next) { console.log(`[BalticM Music] ${guildId}: queue empty`); return null; }

  try {
    const lava=shoukaku.players.get(guildId);
    if (!lava) throw new Error("Lavalink player is not connected.");
    next.guildId=guildId;
    const resolveStartedAt=Date.now();
    const hadEncoded=Boolean(next.lavalinkEncoded);
    const metadata=hadEncoded
      ? {encoded:next.lavalinkEncoded,info:{title:next.title,author:next.artist,length:next.duration,artworkUrl:next.thumbnail,uri:next.playbackUrl}}
      : await resolveLavalinkTrack(next);
    console.log(`[BalticM Search] Playback resolve: ${Date.now() - resolveStartedAt}ms | cached=${hadEncoded} | ${next.title}`);
    next.lavalinkEncoded=metadata.encoded;
    if (metadata.info) {
      next.title=metadata.info.title || next.title;
      next.artist=metadata.info.author || next.artist;
      next.duration=metadata.info.length || next.duration;
      next.thumbnail=metadata.info.artworkUrl || next.thumbnail;
      next.playbackUrl=metadata.info.uri || next.playbackUrl;
    }
    player.currentTrack=next;
    player.paused=false;
    next.playbackId = randomUUID();
    await lava.setGlobalVolume(Math.max(0,Math.min(200,Number(player.volume ?? 100))));
    await lava.playTrack({track:{encoded:metadata.encoded,userData:{playbackId:next.playbackId}}});
    player.lastPlaybackError = null;
    console.log(`[BalticM Music] Now playing via Lavalink: ${next.title} [${lava.node?.name || "node"}]`);
    return next;
  } catch(error) {
    setLastError(error); player.currentTrack=null;
    player.lastPlaybackError = "Audio source could not be played. Try another track or source.";
    if (player.queue.length) return playNext(guildId);
    throw new Error(player.lastPlaybackError);
  }
}

/*
 * ============================================================
 * ADD TRACK
 * ============================================================
 */

function addTrack(guildId, query, requestedBy = null, source = "auto") {
  return withGuild(guildId, () => addTrackUnlocked(guildId, query, requestedBy, source));
}
async function addTrackUnlocked(
  guildId,
  query,
  requestedBy = null,
  source = "auto"
) {
  const player =
    players.get(guildId);

  if (!player) {
    throw new Error(
      "Music player is not connected."
    );
  }

  const track =
    await resolveTrack(
      query,
      requestedBy,
      source
    );

  const wasPlaying =
    Boolean(
      player.currentTrack
    );

  if (player.queue.length >= 100) throw new Error("Queue limit reached (100 tracks).");
  track.id = randomUUID();
  player.queue.push(
    track
  );

  if (!wasPlaying) {
    await playNext(
      guildId
    );
  }

  return {
    track,
    queued:
      wasPlaying,

    position:
      wasPlaying
        ? player.queue.length
        : 0
  };
}

/*
 * ============================================================
 * MUSIC CONFIG
 * ============================================================
 */

async function getMusicCommandConfig(
  guildId
) {
  if (!SERVICE_SECRET) {
    throw new Error(
      "BALTICM_MUSIC_SERVICE_SECRET is missing"
    );
  }

  const response =
    await fetch(
      `${CONTROL_URL}/api/music/service/config?guildId=${encodeURIComponent(guildId)}`,
      {
        headers: {
          "X-BalticM-Service-Secret":
            SERVICE_SECRET,

          "Accept":
            "application/json"
        }
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (!response.ok) {
    throw new Error(
      data?.error ||
      `Music config request failed (${response.status})`
    );
  }

  return (
    data?.config ||
    null
  );
}

/*
 * ============================================================
 * DISCORD MUSIC COMMANDS
 * ============================================================
 */

const PLAY_COMMAND =
  new SlashCommandBuilder()
    .setName(
      "play"
    )
    .setDescription(
      "Play music in your current voice channel"
    )
    .addStringOption(
      option =>
        option
          .setName(
            "query"
          )
          .setDescription(
            "Song name or music URL"
          )
          .setRequired(
            true
          )
    )
    .addStringOption(
      option =>
        option
          .setName("source")
          .setDescription("Where to search (optional)")
          .setRequired(false)
          .addChoices(
            { name: "Auto / Default", value: "auto" },
            { name: "YouTube", value: "youtube" },
            { name: "SoundCloud", value: "soundcloud" },
            { name: "Spotify", value: "spotify" }
          )
    )
    .toJSON();

const simpleMusicCommand = (name, description) =>
  new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .toJSON();

const VOLUME_COMMAND =
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set the Music Bot volume")
    .addIntegerOption(option =>
      option
        .setName("percent")
        .setDescription("Volume from 0 to 200 percent")
        .setMinValue(0)
        .setMaxValue(200)
        .setRequired(true)
    )
    .toJSON();

const REMOVE_COMMAND =
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a song from the queue")
    .addIntegerOption(option =>
      option
        .setName("position")
        .setDescription("Queue position to remove")
        .setMinValue(1)
        .setRequired(true)
    )
    .toJSON();

const LOOP_COMMAND =
  new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Set the Music Bot loop mode")
    .addStringOption(option =>
      option
        .setName("mode")
        .setDescription("Choose what should repeat")
        .setRequired(true)
        .addChoices(
          { name: "Off", value: "off" },
          { name: "Current track", value: "track" },
          { name: "Queue", value: "queue" }
        )
    )
    .toJSON();

const MUSIC_COMMANDS = [
  PLAY_COMMAND,
  simpleMusicCommand("pause", "Pause the current song"),
  simpleMusicCommand("resume", "Resume the paused song"),
  simpleMusicCommand("skip", "Skip the current song"),
  simpleMusicCommand("stop", "Stop playback and clear the queue"),
  simpleMusicCommand("queue", "Show the current music queue"),
  simpleMusicCommand("nowplaying", "Show the current song"),
  simpleMusicCommand("np", "Show the current song"),
  VOLUME_COMMAND,
  REMOVE_COMMAND,
  simpleMusicCommand("clear", "Clear the queued songs"),
  simpleMusicCommand("shuffle", "Shuffle the queued songs"),
  LOOP_COMMAND,
  simpleMusicCommand("join", "Join your current voice channel"),
  simpleMusicCommand("disconnect", "Disconnect Music Bot from voice")
];

/*
 * ============================================================
 * REGISTER COMMANDS
 * ============================================================
 */

async function registerGuildCommands(
  guild
) {
  try {
    await guild.commands.set(MUSIC_COMMANDS);

    console.log(
      `[BalticM Music] ${MUSIC_COMMANDS.length} commands registered for ${guild.name} (${guild.id})`
    );
  } catch (error) {
    setLastError(
      error
    );
  }
}

async function registerAllGuildCommands() {
  for (
    const guild
    of client.guilds.cache.values()
  ) {
    await registerGuildCommands(
      guild
    );
  }
}

/*
 * ============================================================
 * READY
 * ============================================================
 */

client.once(
  "clientReady",
  readyClient => {
    diagnostic.clientReady =
      true;

    diagnostic.readyAt =
      new Date()
        .toISOString();

    diagnostic.user =
      readyClient.user?.tag ||
      readyClient.user?.username ||
      null;

    console.log(
      `[BalticM Music] Discord connected as ${diagnostic.user}`
    );

    console.log(
      `[BalticM Music] Guilds: ${client.guilds.cache.size}`
    );

    registerAllGuildCommands()
      .catch(
        setLastError
      );
  }
);

client.on(
  "guildCreate",
  guild => {
    registerGuildCommands(
      guild
    ).catch(
      setLastError
    );
  }
);

/*
 * ============================================================
 * GATEWAY MUSIC COMMANDS
 * ============================================================
 */

client.on(
  "interactionCreate",
  async interaction => {
    const commandNames = new Set(MUSIC_COMMANDS.map(command => command.name));
    if (!interaction.isChatInputCommand() || !commandNames.has(interaction.commandName)) {
      return;
    }

    try {
      await interaction.deferReply({
        ephemeral: true
      });
    } catch (error) {
      setLastError(
        error
      );

      return;
    }

    try {
      if (
        !interaction.inGuild() ||
        !interaction.guildId
      ) {
        return interaction.editReply({
          content:
            "❌ Music commands can only be used inside a Discord server."
        });
      }

      const config =
        await getMusicCommandConfig(
          interaction.guildId
        );

      if (
        !config?.commandChannelId
      ) {
        return interaction.editReply({
          content:
            "❌ Music command channel is not configured yet."
        });
      }

      if (
        interaction.channelId !==
        config.commandChannelId
      ) {
        return interaction.editReply({
          content:
            `❌ Music commands are only allowed in <#${config.commandChannelId}>.`
        });
      }

      const guildId = interaction.guildId;
      const command = interaction.commandName === "np" ? "nowplaying" : interaction.commandName;
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const voiceChannel = member.voice?.channel || null;
      const existing = players.get(guildId);

      const needsVoice = ["play", "join"].includes(command);
      if (needsVoice && !voiceChannel) {
        return interaction.editReply({content:"❌ Join a voice channel first."});
      }

      const controlsPlayer = ["play", "pause", "resume", "skip", "stop", "volume", "remove", "clear", "shuffle", "loop", "disconnect"].includes(command);
      if (controlsPlayer && existing && voiceChannel?.id !== existing.channelId) {
        return interaction.editReply({content:`❌ Join <#${existing.channelId}> to control this server's player.`});
      }

      if (command === "queue" || command === "nowplaying") {
        const state = getGuildState(guildId);
        if (command === "nowplaying") {
          const track = state.currentTrack;
          return interaction.editReply({content:track
            ? `${state.paused ? "⏸️" : "▶️"} **${track.title}**${track.artist ? ` — ${track.artist}` : ""}\n${formatMusicDuration(state.position)} / ${formatMusicDuration(track.duration)} · volume ${state.volume}% · loop ${state.loopMode}`
            : "ℹ️ Nothing is playing."});
        }
        const rows = state.queue.slice(0, 15).map((track, index) => `${index + 1}. **${track.title}**${track.artist ? ` — ${track.artist}` : ""}`);
        const current = state.currentTrack ? `Now: **${state.currentTrack.title}**\n` : "";
        const more = state.queue.length > rows.length ? `\n…and ${state.queue.length - rows.length} more.` : "";
        return interaction.editReply({content:current + (rows.length ? rows.join("\n") + more : "Queue is empty.")});
      }

      if (command === "join") {
        if (existing && existing.channelId !== voiceChannel.id) {
          return interaction.editReply({content:`❌ Music Bot is already active in <#${existing.channelId}>.`});
        }
        const state = await connectPlayer(guildId, voiceChannel.id);
        return interaction.editReply({content:`✅ Connected to **${state.channelName || voiceChannel.name}**.`});
      }

      if (command === "play") {
        const query = interaction.options.getString("query")?.trim() || "";
        const source = interaction.options.getString("source")?.trim().toLowerCase() || "auto";
        if (!query) return interaction.editReply({content:"❌ Enter a song name or music URL."});
        if (!existing) await connectPlayer(guildId, voiceChannel.id);
        const result = await addTrack(guildId, query, interaction.user.id, source);
        const track = result.track;
        return interaction.editReply({content:result.queued
          ? `➕ Added to queue: **${track.title}**${track.artist ? ` — ${track.artist}` : ""}`
          : `▶️ Now playing: **${track.title}**${track.artist ? ` — ${track.artist}` : ""}`});
      }

      if (!existing || !shoukaku.players.get(guildId)) {
        return interaction.editReply({content:"❌ Music player is not connected. Use /join or /play first."});
      }

      if (command === "disconnect") {
        await disconnectPlayer(guildId);
        return interaction.editReply({content:"👋 Music Bot disconnected."});
      }

      const result = await withGuild(guildId, async () => {
        const player = players.get(guildId);
        const lava = shoukaku.players.get(guildId);
        if (!player || !lava) throw new Error("Music player is not connected.");
        if (command === "pause" || command === "resume") {
          if (!player.currentTrack) throw new Error("Nothing is playing.");
          await lava.setPaused(command === "pause");
          player.paused = command === "pause";
          return command === "pause" ? "⏸️ Playback paused." : "▶️ Playback resumed.";
        }
        if (command === "volume") {
          const volume = interaction.options.getInteger("percent", true);
          await lava.setGlobalVolume(volume); player.volume = volume;
          return `🔊 Volume set to ${volume}%.`;
        }
        if (command === "remove") {
          const position = interaction.options.getInteger("position", true);
          if (position > player.queue.length) throw new Error("That queue position does not exist.");
          const [removed] = player.queue.splice(position - 1, 1);
          return `➖ Removed **${removed.title}** from the queue.`;
        }
        if (command === "clear") {
          player.queue = [];
          return "🧹 Queue cleared.";
        }
        if (command === "shuffle") {
          for (let i = player.queue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [player.queue[i], player.queue[j]] = [player.queue[j], player.queue[i]];
          }
          return `🔀 Shuffled ${player.queue.length} queued song${player.queue.length === 1 ? "" : "s"}.`;
        }
        if (command === "loop") {
          player.loopMode = interaction.options.getString("mode", true);
          return `🔁 Loop mode: **${player.loopMode}**.`;
        }
        if (command === "skip" || command === "stop") {
          if (!player.currentTrack && !player.queue.length) throw new Error("Nothing is playing.");
          await lava.stopTrack();
          player.currentTrack = null; player.paused = false; player.position = 0;
          if (command === "stop") player.queue = [];
          else await playNext(guildId);
          return command === "stop" ? "⏹️ Playback stopped and queue cleared." : "⏭️ Track skipped.";
        }
        throw new Error("Unsupported music command.");
      });
      return interaction.editReply({content:result});
    } catch (error) {
      setLastError(
        error
      );

      return interaction
        .editReply({
          content:
            `❌ Music error: ${error?.message || "Music command failed."}`
        })
        .catch(
          () => {}
        );
    }
  }
);

function formatMusicDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/*
 * ============================================================
 * DISCORD ERRORS
 * ============================================================
 */

client.on(
  "error",
  error => {
    setLastError(
      error
    );
  }
);

client.on(
  "warn",
  warning => {
    console.warn(
      "[BalticM Music] Discord warning:",
      warning
    );
  }
);

client.on(
  "shardError",
  error => {
    setLastError(
      error
    );
  }
);

client.on(
  "shardDisconnect",
  (
    event,
    shardId
  ) => {
    console.warn(
      `[BalticM Music] Shard ${shardId} disconnected`,
      {
        code:
          event?.code,

        reason:
          event?.reason ||
          null
      }
    );
  }
);

client.on(
  "shardReconnecting",
  shardId => {
    console.log(
      `[BalticM Music] Shard ${shardId} reconnecting`
    );
  }
);

client.on(
  "shardResume",
  (
    shardId,
    replayedEvents
  ) => {
    console.log(
      `[BalticM Music] Shard ${shardId} resumed (${replayedEvents} replayed events)`
    );
  }
);

/*
 * ============================================================
 * HTTP SERVER
 * ============================================================
 */

const server =
  http.createServer(
    async (
      req,
      res
    ) => {
      try {
        const base =
          `http://${req.headers.host || "localhost"}`;

        const url =
          new URL(
            req.url || "/",
            base
          );

        /*
         * PUBLIC HEALTH
         */

        if (
          req.method ===
            "GET" &&
          (
            url.pathname ===
              "/" ||

            url.pathname ===
              "/music" ||

            url.pathname ===
              "/music/"
          )
        ) {
          return json(
            res,
            200,
            {
              ok: true,

              service:
                "BalticM Music Service",

              version:
                "1.8.0-player-controls",

              pid:
                process.pid,

              discord:
                client.isReady()
                  ? "connected"
                  : "connecting",

              guilds:
                client.guilds
                  .cache
                  .size,

              players:
                players.size,

              supportedSources: [
                "YouTube",
                "YouTube Music",
                "SoundCloud",
                "Spotify",
                "Apple Music",
                "Deezer",
                "Search"
              ],

              ...(authorized(req) ? { diagnostic: getDiscordStatus(), voiceDiagnostic: voiceDiagnostic.slice(-100) } : {})
            }
          );
        }

        /*
         * EVERYTHING BELOW IS PROTECTED
         */

        if (
          !authorized(req)
        ) {
          return json(
            res,
            401,
            {
              ok: false,

              error:
                "Unauthorized"
            }
          );
        }

        /*
         * STATE
         */

        if (
          req.method ===
            "GET" &&
          (
            url.pathname ===
              "/state" ||

            url.pathname ===
              "/music/state"
          )
        ) {
          const guildId =
            url.searchParams
              .get(
                "guildId"
              );

          if (!guildId) {
            return json(
              res,
              400,
              {
                ok: false,

                error:
                  "guildId is required"
              }
            );
          }

          return json(
            res,
            200,
            {
              ok: true,

              ...getGuildState(
                guildId
              )
            }
          );
        }

        /*
         * CONNECT
         */

        if (
          req.method ===
            "POST" &&
          (
            url.pathname ===
              "/connect" ||

            url.pathname ===
              "/music/connect"
          )
        ) {
          const body =
            await readBody(
              req
            );

          const guildId =
            String(
              body.guildId ||
              ""
            );

          const channelId =
            String(
              body.channelId ||
              ""
            );

          if (
            !guildId ||
            !channelId
          ) {
            return json(
              res,
              400,
              {
                ok: false,

                error:
                  "guildId and channelId are required"
              }
            );
          }

          const state =
            await connectPlayer(
              guildId,
              channelId
            );

          return json(
            res,
            200,
            {
              ok: true,
              state
            }
          );
        }

        /*
         * DISCONNECT
         */

        if (
          req.method ===
            "POST" &&
          (
            url.pathname ===
              "/disconnect" ||

            url.pathname ===
              "/music/disconnect"
          )
        ) {
          const body =
            await readBody(
              req
            );

          const guildId =
            String(
              body.guildId ||
              ""
            );

          if (!guildId) {
            return json(
              res,
              400,
              {
                ok: false,

                error:
                  "guildId is required"
              }
            );
          }

          const state =
            await disconnectPlayer(
              guildId
            );

          return json(
            res,
            200,
            {
              ok: true,
              state
            }
          );
        }

        /*
         * PLAY FROM HTTP INTERACTION SERVICE
         */

        if (
          req.method ===
            "POST" &&
          (
            url.pathname ===
              "/command/play" ||

            url.pathname ===
              "/music/command/play"
          )
        ) {
          const body =
            await readBody(
              req
            );

          const guildId =
            String(
              body.guildId ||
              ""
            );

          const userId =
            String(
              body.userId ||
              ""
            );

          const commandChannelId =
            String(
              body.commandChannelId ||
              ""
            );

          const query =
            String(
              body.query ||
              ""
            ).trim();

          const source =
            String(
              body.source ||
              "auto"
            ).trim().toLowerCase();

          voiceLog(
            "HTTP PLAY RECEIVED",
            {
              pid: process.pid,
              guildId,
              userId,
              commandChannelId,
              hasQuery: Boolean(query)
            }
          );

          if (
            !guildId ||
            !userId ||
            !commandChannelId
          ) {
            return json(
              res,
              400,
              {
                ok: false,

                error:
                  "guildId, userId and commandChannelId are required"
              }
            );
          }

          if (!query) {
            return json(
              res,
              400,
              {
                ok: false,

                error:
                  "Enter a song name or music URL."
              }
            );
          }

          if (
            !client.isReady()
          ) {
            return json(
              res,
              503,
              {
                ok: false,

                error:
                  "Discord client is not ready"
              }
            );
          }

          const guild =
            client.guilds.cache.get(
              guildId
            );

          if (!guild) {
            return json(
              res,
              404,
              {
                ok: false,

                error:
                  "Guild not found"
              }
            );
          }

          /*
           * Validate configured Music text channel.
           */

          const config =
            await getMusicCommandConfig(
              guildId
            );

          if (
            !config?.commandChannelId
          ) {
            return json(
              res,
              400,
              {
                ok: false,

                error:
                  "Music command channel is not configured yet. Set it in BalticM Control Center."
              }
            );
          }

          if (
            commandChannelId !==
            String(
              config.commandChannelId
            )
          ) {
            return json(
              res,
              400,
              {
                ok: false,

                error:
                  `Music commands are only allowed in <#${config.commandChannelId}>.`
              }
            );
          }

          /*
           * Fetch member.
           */

          const member =
            await guild.members.fetch(
              userId
            );

          const voiceChannel =
            member.voice?.channel;

          if (!voiceChannel) {
            return json(
              res,
              400,
              {
                ok: false,

                error:
                  "Join a voice channel first, then use /play in the Music channel."
              }
            );
          }

          if (
            voiceChannel.type !==
              ChannelType.GuildVoice &&
            voiceChannel.type !==
              ChannelType.GuildStageVoice
          ) {
            return json(
              res,
              400,
              {
                ok: false,

                error:
                  "Your current channel is not a supported voice channel."
              }
            );
          }

          /*
           * Connect/reuse voice connection.
           */

          await connectPlayer(
            guildId,
            voiceChannel.id
          );

          /*
           * Resolve + queue + play.
           */

          const result =
            await addTrack(
              guildId,
              query,
              userId,
              source
            );

          const track =
            result.track;

          return json(
            res,
            200,
            {
              ok: true,

              channelId:
                voiceChannel.id,

              channelName:
                voiceChannel.name,

              query,

              queued:
                result.queued,

              queuePosition:
                result.position,

              track:
                publicTrack(
                  track
                ),

              message:
                result.queued
                  ? `Added to queue: ${track.title}`
                  : `Now playing: ${track.title}`
            }
          );
        }

        const action = url.pathname.replace(/^\/music(?=\/)/, "");
        if (req.method === "POST" && ["/play", "/pause", "/resume", "/skip", "/stop", "/volume", "/queue/remove", "/queue/clear", "/queue/shuffle", "/loop"].includes(action)) {
          const body = await readBody(req);
          const guildId = String(body.guildId || "");
          if (!/^\d{16,22}$/.test(guildId)) return json(res, 400, {error:"Invalid guildId"});
          if (action === "/play") {
            const query = String(body.query || "").trim();
            if (!query || query.length > 1000) return json(res,400,{error:"Enter a song name or URL (up to 1000 characters)."});
            const source = String(body.source || "auto");
            if (!["auto", "youtube", "soundcloud"].includes(source)) return json(res,400,{error:"Invalid source"});
            const result = await addTrack(guildId, query, String(body.requestedBy || ""), source);
            return json(res,200,{ok:true,queued:result.queued,state:getGuildState(guildId)});
          }
          const result = await withGuild(guildId, async () => {
            const player = players.get(guildId);
            const lava = shoukaku.players.get(guildId);
            if (!player || !lava) return {status:409,error:"Player not connected"};
            if (action === "/volume") {
              if (typeof body.volume !== "number" || !Number.isFinite(body.volume) || body.volume < 0 || body.volume > 200) return {status:400,error:"Volume must be between 0 and 200"};
              await lava.setGlobalVolume(body.volume); player.volume = body.volume;
            } else if (action === "/queue/clear") player.queue = [];
            else if (action === "/queue/shuffle") {
              for (let i = player.queue.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [player.queue[i], player.queue[j]] = [player.queue[j], player.queue[i]];
              }
            } else if (action === "/loop") {
              const mode = String(body.mode || "off").toLowerCase();
              if (!["off", "track", "queue"].includes(mode)) return {status:400,error:"Loop mode must be off, track or queue"};
              player.loopMode = mode;
            }
            else if (action === "/queue/remove") {
              const index = player.queue.findIndex(track => track.id === body.trackId);
              if (index < 0) return {status:404,error:"Track is no longer in the queue"};
              player.queue.splice(index, 1);
            } else if (action === "/pause" || action === "/resume") {
              if (!player.currentTrack) return {status:409,error:"Nothing is playing"};
              await lava.setPaused(action === "/pause"); player.paused = action === "/pause";
            } else {
              await lava.stopTrack();
              player.currentTrack = null; player.paused = false; player.position = 0;
              if (action === "/stop") player.queue = [];
              else await playNext(guildId);
            }
            return {status:200};
          });
          return json(res,result.status,result.error ? {error:result.error} : {ok:true,state:getGuildState(guildId)});
        }

        /*
         * NOT FOUND
         */

        return json(
          res,
          404,
          {
            ok: false,

            error:
              "Not found"
          }
        );
      } catch (error) {
        setLastError(
          error
        );

        return json(
          res,
          500,
          {
            ok: false,

            error:
              error?.message ||
              "Internal server error"
          }
        );
      }
    }
  );

/*
 * ============================================================
 * START HTTP
 * ============================================================
 */

server.listen(
  PORT,
  () => {
    console.log(
      `[BalticM Music] HTTP service listening on ${PORT}`
    );
  }
);

/*
 * ============================================================
 * START DISCORD
 * ============================================================
 */

async function startDiscord() {
  console.log(
    `[BalticM Music] Token configured: ${Boolean(DISCORD_TOKEN)}`
  );

  console.log(
    `[BalticM Music] Token length: ${DISCORD_TOKEN.length}`
  );

  if (!DISCORD_TOKEN) {
    setLastError(
      new Error(
        "DISCORD_TOKEN is missing"
      )
    );

    return;
  }

  diagnostic.loginStarted =
    true;

  console.log(
    "[BalticM Music] Starting Discord login..."
  );

  try {
    await client.login(
      DISCORD_TOKEN
    );

    diagnostic.loginResolved =
      true;

    console.log(
      "[BalticM Music] client.login() resolved"
    );
  } catch (error) {
    diagnostic.loginResolved =
      false;

    setLastError(
      error
    );
  }
}

startDiscord();

/*
 * ============================================================
 * LOGIN WATCHDOG
 * ============================================================
 */

setTimeout(
  () => {
    if (
      !client.isReady()
    ) {
      console.warn(
        "[BalticM Music] Discord is still NOT READY after 15 seconds",
        getDiscordStatus()
      );
    }
  },
  15000
);
