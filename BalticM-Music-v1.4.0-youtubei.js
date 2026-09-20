import http from "node:http";
import { Readable } from "node:stream";
import { Innertube } from "youtubei.js";

import {
  ChannelType,
  Client,
  GatewayIntentBits,
  SlashCommandBuilder
} from "discord.js";

import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel
} from "@discordjs/voice";

import play from "@iamtraction/play-dl";

let youtubeClientPromise = null;
function getYouTubeClient() {
  if (!youtubeClientPromise) {
    youtubeClientPromise = Innertube.create({ retrieve_player: true });
  }
  return youtubeClientPromise;
}

function getYouTubeVideoId(value) {
  try {
    const u = new URL(value);
    if (u.hostname === "youtu.be") return u.pathname.split("/").filter(Boolean)[0] || null;
    if (u.hostname.endsWith("youtube.com") || u.hostname.endsWith("music.youtube.com")) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

/*
 * ============================================================
 * BALTICM MUSIC SERVICE
 * v1.4.0-youtubei
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
  const player =
    players.get(guildId);

  if (!player) {
    return {
      connected: false,

      channelId: null,
      channelName: null,

      listeners: 0,

      queue: [],
      queueLength: 0,

      playing: false,
      paused: false,

      volume: 100,

      currentTrack: null
    };
  }

  const guild =
    client.guilds.cache.get(
      guildId
    );

  const channel =
    guild?.channels.cache.get(
      player.channelId
    );

  const listeners =
    channel?.members?.filter(
      member =>
        !member.user.bot
    ).size || 0;

  const status =
    player.audioPlayer?.state?.status;

  return {
    connected: Boolean(
      getVoiceConnection(
        guildId
      )
    ),

    channelId:
      player.channelId,

    channelName:
      channel?.name ||
      player.channelName ||
      null,

    listeners,

    queue:
      (player.queue || [])
        .map(publicTrack),

    queueLength:
      player.queue?.length || 0,

    playing:
      status ===
      AudioPlayerStatus.Playing,

    paused:
      status ===
        AudioPlayerStatus.Paused ||
      status ===
        AudioPlayerStatus.AutoPaused,

    volume:
      player.volume ?? 100,

    currentTrack:
      publicTrack(
        player.currentTrack
      )
  };
}

/*
 * ============================================================
 * PLAYER CREATION
 * ============================================================
 */

function createGuildAudioPlayer(
  guildId
) {
  const audioPlayer =
    createAudioPlayer({
      behaviors: {
        noSubscriber:
          NoSubscriberBehavior.Pause
      }
    });

  audioPlayer.on(
    AudioPlayerStatus.Playing,
    () => {
      console.log(
        `[BalticM Music] ${guildId}: playback started`
      );
    }
  );

  audioPlayer.on(
    AudioPlayerStatus.Paused,
    () => {
      console.log(
        `[BalticM Music] ${guildId}: playback paused`
      );
    }
  );

  audioPlayer.on(
    AudioPlayerStatus.Idle,
    () => {
      const player =
        players.get(guildId);

      if (!player) {
        return;
      }

      /*
       * Ignore Idle event generated while
       * intentionally replacing a resource.
       */

      if (player.replacingTrack) {
        return;
      }

      player.currentTrack = null;

      playNext(
        guildId
      ).catch(
        setLastError
      );
    }
  );

  audioPlayer.on(
    "error",
    error => {
      setLastError(error);

      const player =
        players.get(guildId);

      if (!player) {
        return;
      }

      player.currentTrack = null;

      setTimeout(
        () => {
          playNext(
            guildId
          ).catch(
            setLastError
          );
        },
        500
      );
    }
  );

  return audioPlayer;
}

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

async function connectPlayer(
  guildId,
  channelId
) {
  if (!client.isReady()) {
    throw new Error(
      "Discord client is not ready"
    );
  }

  const guild =
    client.guilds.cache.get(
      guildId
    );

  if (!guild) {
    throw new Error(
      "Guild not found"
    );
  }

  const channel =
    guild.channels.cache.get(
      channelId
    );

  if (!channel) {
    throw new Error(
      "Voice channel not found"
    );
  }

  if (
    channel.type !== ChannelType.GuildVoice &&
    channel.type !== ChannelType.GuildStageVoice
  ) {
    throw new Error(
      "Selected channel is not a voice channel"
    );
  }

  voiceLog(
    "CONNECT START",
    {
      guildId: guild.id,
      guildName: guild.name,
      channelId: channel.id,
      channelName: channel.name,
      botUser: client.user?.tag || null,
      wsStatus: client.ws?.status ?? null
    }
  );

  const me =
    guild.members.me ||
    await guild.members.fetchMe();

  voiceLog(
    "BOT MEMBER",
    {
      id: me.id,
      currentVoiceChannel:
        me.voice?.channelId || null,
      serverMute:
        me.voice?.serverMute ?? null,
      serverDeaf:
        me.voice?.serverDeaf ?? null
    }
  );

  let player =
    players.get(guildId);

  let connection =
    getVoiceConnection(
      guildId
    );

  if (
    connection &&
    player &&
    player.channelId === channelId &&
    connection.state?.status ===
      VoiceConnectionStatus.Ready
  ) {
    voiceLog(
      "REUSING READY CONNECTION"
    );

    connection.subscribe(
      player.audioPlayer
    );

    return getGuildState(
      guildId
    );
  }

  if (connection) {
    voiceLog(
      "DESTROY OLD CONNECTION",
      connection.state?.status || "unknown"
    );

    try {
      connection.destroy();
    } catch (error) {
      voiceError(
        "DESTROY ERROR",
        error
      );
    }

    connection = null;

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          1000
        )
    );
  }

  if (!player) {
    player = {
      guildId,

      channelId:
        channel.id,

      channelName:
        channel.name,

      queue: [],

      volume: 100,

      currentTrack: null,

      audioPlayer:
        createGuildAudioPlayer(
          guildId
        ),

      replacingTrack: false,

      connectedAt:
        Date.now()
    };

    players.set(
      guildId,
      player
    );
  } else {
    player.channelId =
      channel.id;

    player.channelName =
      channel.name;
  }

  voiceLog(
    "CALL joinVoiceChannel"
  );

  connection =
    joinVoiceChannel({
      channelId:
        channel.id,

      guildId:
        guild.id,

      adapterCreator:
        guild.voiceAdapterCreator,

      selfDeaf: true,
      selfMute: false
    });

  voiceLog(
    "INITIAL STATE",
    connection.state?.status || "unknown"
  );

  connection.on(
    "stateChange",
    (oldState, newState) => {
      voiceLog(
        `STATE ${oldState.status} -> ${newState.status}`
      );
    }
  );

  connection.on(
    "error",
    error => {
      voiceError(
        "CONNECTION ERROR",
        error
      );
    }
  );

  connection.subscribe(
    player.audioPlayer
  );

  voiceLog(
    "AUDIO PLAYER SUBSCRIBED"
  );

  try {
    voiceLog(
      "WAIT READY 20000ms"
    );

    await entersState(
      connection,
      VoiceConnectionStatus.Ready,
      20000
    );

    voiceLog(
      "READY",
      {
        status:
          connection.state?.status || null,

        botVoiceChannel:
          guild.members.me?.voice?.channelId ||
          null
      }
    );
  } catch (error) {
    const status =
      connection.state?.status ||
      "unknown";

    const botVoiceChannel =
      guild.members.me?.voice?.channelId ||
      null;

    voiceError(
      "READY FAILED",
      {
        status,
        botVoiceChannel,
        expectedChannel:
          channel.id,
        errorName:
          error?.name || null,
        errorMessage:
          error?.message || String(error)
      }
    );

    try {
      connection.destroy();
    } catch {
      // ignore cleanup error
    }

    throw new Error(
      `Discord voice connection failed: ${status}; botChannel=${botVoiceChannel || "none"}`
    );
  }

  voiceLog(
    "CONNECTED",
    {
      channelId: channel.id,
      channelName: channel.name
    }
  );

  return getGuildState(
    guildId
  );
}

/*
 * ============================================================
 * DISCONNECT PLAYER
 * ============================================================
 */

function disconnectPlayer(
  guildId
) {
  const player =
    players.get(guildId);

  if (player?.audioPlayer) {
    try {
      player.audioPlayer.stop(
        true
      );
    } catch {
      // ignore
    }
  }

  const connection =
    getVoiceConnection(
      guildId
    );

  if (connection) {
    try {
      connection.destroy();
    } catch {
      // ignore
    }
  }

  players.delete(
    guildId
  );

  return getGuildState(
    guildId
  );
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

async function resolveTrack(
  input,
  requestedBy = null
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
    track =
      await searchYouTube(
        query
      );

    track.originalUrl =
      null;
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

async function createTrackResource(
  track,
  volume
) {
  if (!track?.playbackUrl) {
    throw new Error(
      "Track has no playable URL."
    );
  }

  console.log(
    `[BalticM Music] Opening stream: ${track.title} [${track.source}]`
  );

  let audioStream;
  let inputType = StreamType.Arbitrary;

  const youtubeId =
    track.source === "YouTube"
      ? getYouTubeVideoId(track.playbackUrl)
      : null;

  if (youtubeId) {
    console.log(
      `[BalticM Music] YouTube.js stream: ${youtubeId}`
    );

    const youtube =
      await getYouTubeClient();

    const webStream =
      await youtube.download(
        youtubeId,
        {
          type: "audio",
          quality: "best",
          format: "webm",
          codec: "opus"
        }
      );

    audioStream =
      Readable.fromWeb(webStream);

    inputType =
      StreamType.WebmOpus;
  } else {
    const stream =
      await play.stream(
        track.playbackUrl
      );

    audioStream =
      stream.stream;

    inputType =
      stream.type;
  }

  const resource =
    createAudioResource(
      audioStream,
      {
        inputType,

        inlineVolume:
          true,

        metadata:
          track
      }
    );

  if (resource.volume) {
    resource.volume.setVolume(
      Math.max(
        0,
        Math.min(
          2,
          Number(volume || 100) / 100
        )
      )
    );
  }

  return resource;
}

/*
 * ============================================================
 * PLAY NEXT
 * ============================================================
 */

async function playNext(
  guildId
) {
  const player =
    players.get(guildId);

  if (!player) {
    return null;
  }

  if (
    player.currentTrack
  ) {
    return player.currentTrack;
  }

  const next =
    player.queue.shift();

  if (!next) {
    console.log(
      `[BalticM Music] ${guildId}: queue empty`
    );

    return null;
  }

  try {
    const resource =
      await createTrackResource(
        next,
        player.volume
      );

    player.currentTrack =
      next;

    player.replacingTrack =
      true;

    player.audioPlayer.play(
      resource
    );

    /*
     * Prevent an old Idle transition from
     * consuming the next queue item.
     */

    setTimeout(
      () => {
        const current =
          players.get(
            guildId
          );

        if (current) {
          current.replacingTrack =
            false;
        }
      },
      250
    );

    console.log(
      `[BalticM Music] Now playing: ${next.title}`
    );

    return next;
  } catch (error) {
    setLastError(
      error
    );

    player.currentTrack =
      null;

    /*
     * Broken result?
     * Skip it and continue the queue.
     */

    return playNext(
      guildId
    );
  }
}

/*
 * ============================================================
 * ADD TRACK
 * ============================================================
 */

async function addTrack(
  guildId,
  query,
  requestedBy = null
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
      requestedBy
    );

  const wasPlaying =
    Boolean(
      player.currentTrack
    );

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
 * /PLAY COMMAND
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
    .toJSON();

/*
 * ============================================================
 * REGISTER COMMANDS
 * ============================================================
 */

async function registerGuildCommands(
  guild
) {
  try {
    await guild.commands.set([
      PLAY_COMMAND
    ]);

    console.log(
      `[BalticM Music] /play registered for ${guild.name} (${guild.id})`
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
 * GATEWAY /PLAY
 *
 * Kept for compatibility.
 * Main production interactions may arrive
 * through balticm-discord HTTP service.
 * ============================================================
 */

client.on(
  "interactionCreate",
  async interaction => {
    if (
      !interaction.isChatInputCommand() ||
      interaction.commandName !==
        "play"
    ) {
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

      const member =
        await interaction.guild
          .members
          .fetch(
            interaction.user.id
          );

      const voiceChannel =
        member.voice?.channel;

      if (!voiceChannel) {
        return interaction.editReply({
          content:
            "❌ Join a voice channel first."
        });
      }

      const query =
        interaction.options
          .getString(
            "query"
          )
          ?.trim() ||
        "";

      if (!query) {
        return interaction.editReply({
          content:
            "❌ Enter a song name or music URL."
        });
      }

      await connectPlayer(
        interaction.guildId,
        voiceChannel.id
      );

      const result =
        await addTrack(
          interaction.guildId,
          query,
          interaction.user.id
        );

      const track =
        result.track;

      return interaction.editReply({
        content:
          result.queued
            ? `➕ Added to queue: **${track.title}**${track.artist ? ` — ${track.artist}` : ""}`
            : `▶️ Now playing: **${track.title}**${track.artist ? ` — ${track.artist}` : ""}`
      });
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
                "1.3.1-pid-diagnostic",

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

              diagnostic:
                getDiscordStatus(),

              voiceDiagnostic:
                voiceDiagnostic.slice(-100)
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
            disconnectPlayer(
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
              userId
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

        /*
         * SKIP
         */

        if (
          req.method ===
            "POST" &&
          (
            url.pathname ===
              "/skip" ||

            url.pathname ===
              "/music/skip"
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

          const player =
            players.get(
              guildId
            );

          if (!player) {
            return json(
              res,
              404,
              {
                ok: false,
                error:
                  "Player not connected"
              }
            );
          }

          player.currentTrack =
            null;

          player.audioPlayer.stop(
            true
          );

          return json(
            res,
            200,
            {
              ok: true,
              state:
                getGuildState(
                  guildId
                )
            }
          );
        }

        /*
         * PAUSE
         */

        if (
          req.method ===
            "POST" &&
          (
            url.pathname ===
              "/pause" ||

            url.pathname ===
              "/music/pause"
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

          const player =
            players.get(
              guildId
            );

          if (!player) {
            return json(
              res,
              404,
              {
                ok: false,
                error:
                  "Player not connected"
              }
            );
          }

          player.audioPlayer.pause();

          return json(
            res,
            200,
            {
              ok: true,
              state:
                getGuildState(
                  guildId
                )
            }
          );
        }

        /*
         * RESUME
         */

        if (
          req.method ===
            "POST" &&
          (
            url.pathname ===
              "/resume" ||

            url.pathname ===
              "/music/resume"
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

          const player =
            players.get(
              guildId
            );

          if (!player) {
            return json(
              res,
              404,
              {
                ok: false,
                error:
                  "Player not connected"
              }
            );
          }

          player.audioPlayer.unpause();

          return json(
            res,
            200,
            {
              ok: true,
              state:
                getGuildState(
                  guildId
                )
            }
          );
        }

        /*
         * VOLUME
         */

        if (
          req.method ===
            "POST" &&
          (
            url.pathname ===
              "/volume" ||

            url.pathname ===
              "/music/volume"
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

          const volume =
            Math.max(
              0,
              Math.min(
                200,
                Number(
                  body.volume
                )
              )
            );

          if (
            !Number.isFinite(
              volume
            )
          ) {
            return json(
              res,
              400,
              {
                ok: false,
                error:
                  "Invalid volume"
              }
            );
          }

          const player =
            players.get(
              guildId
            );

          if (!player) {
            return json(
              res,
              404,
              {
                ok: false,
                error:
                  "Player not connected"
              }
            );
          }

          player.volume =
            volume;

          const resource =
            player.audioPlayer
              ?.state
              ?.resource;

          if (
            resource?.volume
          ) {
            resource.volume.setVolume(
              volume / 100
            );
          }

          return json(
            res,
            200,
            {
              ok: true,
              state:
                getGuildState(
                  guildId
                )
            }
          );
        }

        /*
         * CLEAR QUEUE
         */

        if (
          req.method ===
            "POST" &&
          (
            url.pathname ===
              "/queue/clear" ||

            url.pathname ===
              "/music/queue/clear"
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

          const player =
            players.get(
              guildId
            );

          if (!player) {
            return json(
              res,
              404,
              {
                ok: false,
                error:
                  "Player not connected"
              }
            );
          }

          player.queue = [];

          return json(
            res,
            200,
            {
              ok: true,
              state:
                getGuildState(
                  guildId
                )
            }
          );
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