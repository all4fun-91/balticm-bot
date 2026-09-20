"use strict";

// BalticM.eu Discord HTTP interactions service.
// Handles Reaction Roles and routes /play to BalticM Music.

const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.DISCORD_TOKEN;
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const DIAGNOSTICS_KEY = process.env.DIAGNOSTICS_KEY;

const MUSIC_SERVICE_SECRET =
  process.env.BALTICM_MUSIC_SERVICE_SECRET || "";

const MUSIC_HOST = "balticm.eu";
const MUSIC_PLAY_PATH = "/music/command/play";

const GUILD_ID = "884027552174317569";

const VERSION = "buttons-v11-pid-diagnostic";

const DIAGNOSTICS_FILE =
  path.join(
    __dirname,
    "..",
    "diagnostics.log"
  );

const MAX_DIAGNOSTICS_BYTES =
  512 * 1024;

const MAX_DIAGNOSTICS_VIEW_BYTES =
  128 * 1024;

const REST_TIMEOUT_MS = 10000;
const REST_MAX_ATTEMPTS = 4;
const REST_BUDGET_MS = 90000;

const MAX_BODY_BYTES =
  1024 * 1024;

const nowIso = () =>
  new Date().toISOString();

const sleep = ms =>
  new Promise(
    resolve => setTimeout(resolve, ms)
  );

/*
 * ROLES
 */

const ROLE_NAMES = {
  latvian: "Latvietis/e",
  announcements: "📢 Announcements",
  streamer: "🎥 Streamer",
  giveaways: "🎉 Giveaways",
  events: "🏆 Events",
  lfg: "👥 Looking for Group",
  other: "🎮 Other Games"
};

const GAME_BUTTON_ROLES = {
  game_rust: "🦀 Rust",
  game_cs2: "🔫 Counter-Strike 2",
  game_tarkov: "☣️ Escape from Tarkov",
  game_pubg: "🪖 PUBG",
  game_valorant: "🎯 VALORANT",
  game_gta: "🚗 GTA V / FiveM",
  game_cod: "💥 Call of Duty / Warzone",
  game_battlefield: "🪖 Battlefield",
  game_apex: "🦾 Apex Legends",
  game_r6: "🛡️ Rainbow Six Siege",
  game_ark: "🦖 ARK",
  game_dayz: "🧟 DayZ",
  game_scum: "☠️ SCUM",
  game_dbd: "🔪 Dead by Daylight",

  game_dota2: "⚔️ Dota 2",
  game_lol: "⚔️ League of Legends",
  game_rocketleague: "🚀 Rocket League",
  game_overwatch2: "🤖 Overwatch 2",
  game_wow: "🐉 World of Warcraft",
  game_diablo: "🔥 Diablo",
  game_poe: "💎 Path of Exile",
  game_warthunder: "✈️ War Thunder",
  game_wot: "🛞 World of Tanks",
  game_fishing: "🎣 Fishing Games",
  game_mu: "✨ MU Online"
};

const NOTIFICATION_ROLES = {
  role_announcements:
    ROLE_NAMES.announcements,

  role_streamer:
    ROLE_NAMES.streamer,

  role_giveaways:
    ROLE_NAMES.giveaways,

  role_events:
    ROLE_NAMES.events,

  role_lfg:
    ROLE_NAMES.lfg,

  role_other_games:
    ROLE_NAMES.other
};

const KNOWN_ROLE_IDS = {
  "📢 Announcements":
    "1550168705109987398",

  "🎥 Streamer":
    "1550996532042661928",

  "🎉 Giveaways":
    "1550168710432694303",

  "🏆 Events":
    "1550168718015860736",

  "👥 Looking for Group":
    "1550168722713612448"
};

/*
 * DIAGNOSTICS
 */

function redact(value) {
  let text =
    String(value)
      .replace(/\?[^\s]*/g, "");

  for (
    const secret of [
      DIAGNOSTICS_KEY,
      TOKEN,
      MUSIC_SERVICE_SECRET
    ]
  ) {
    if (!secret) continue;

    for (
      const form of [
        secret,
        encodeURIComponent(secret)
      ]
    ) {
      text =
        text
          .split(form)
          .join("[REDACTED]");
    }
  }

  return text;
}

let logQueue =
  Promise.resolve();

let pendingLogs = 0;

async function readTail(limit) {
  let file;

  try {
    file =
      await fs.promises.open(
        DIAGNOSTICS_FILE,
        "r"
      );

    const { size } =
      await file.stat();

    const start =
      Math.max(
        0,
        size - limit
      );

    const buffer =
      Buffer.alloc(
        Math.min(
          size,
          limit
        )
      );

    const { bytesRead } =
      await file.read(
        buffer,
        0,
        buffer.length,
        start
      );

    let text =
      buffer
        .subarray(
          0,
          bytesRead
        )
        .toString("utf8");

    if (start > 0) {
      text =
        text.slice(
          text.indexOf("\n") + 1
        );
    }

    return redact(text);
  } catch (err) {
    return err.code === "ENOENT"
      ? ""
      : "Diagnostics read failed.\n";
  } finally {
    if (file) {
      await file
        .close()
        .catch(() => {});
    }
  }
}

function writeDiagnostic(
  level,
  message
) {
  const line =
    `[${nowIso()}] ${level} ` +
    `${redact(message).replace(/[\r\n]/g, " ")}\n`;

  if (level !== "INFO") {
    console.error(
      line.trimEnd()
    );
  }

  if (
    pendingLogs >= 2000
  ) {
    return;
  }

  pendingLogs++;

  logQueue =
    logQueue
      .then(
        async () => {
          const stats =
            await fs.promises
              .stat(
                DIAGNOSTICS_FILE
              )
              .catch(
                () => null
              );

          if (
            stats &&
            stats.size >
              MAX_DIAGNOSTICS_BYTES
          ) {
            const tail =
              await readTail(
                MAX_DIAGNOSTICS_BYTES /
                  2
              );

            await fs.promises
              .writeFile(
                DIAGNOSTICS_FILE,
                tail,
                {
                  mode: 0o600
                }
              );
          }

          await fs.promises
            .appendFile(
              DIAGNOSTICS_FILE,
              line,
              {
                mode: 0o600
              }
            );
        }
      )
      .catch(
        () => {
          console.error(
            "Diagnostics write failed."
          );
        }
      )
      .finally(
        () => {
          pendingLogs--;
        }
      );
}

const log =
  message =>
    writeDiagnostic(
      "INFO",
      message
    );

const logError =
  message =>
    writeDiagnostic(
      "ERROR",
      message
    );

const PLAY_DIAGNOSTIC_LIMIT = 100;
const playDiagnostic = [];

function addPlayDiagnostic(
  event,
  details = {}
) {
  const safeDetails = {};

  for (
    const [
      key,
      value
    ] of Object.entries(
      details || {}
    )
  ) {
    if (
      [
        "token",
        "interactionToken",
        "secret",
        "query"
      ].includes(key)
    ) {
      continue;
    }

    safeDetails[key] =
      value ?? null;
  }

  playDiagnostic.push({
    time: nowIso(),
    pid: process.pid,
    event,
    ...safeDetails
  });

  if (
    playDiagnostic.length >
    PLAY_DIAGNOSTIC_LIMIT
  ) {
    playDiagnostic.splice(
      0,
      playDiagnostic.length -
        PLAY_DIAGNOSTIC_LIMIT
    );
  }
}

function failure(err) {
  const status =
    Number.isInteger(
      err?.status
    )
      ? err.status
      : 0;

  const code =
    /^[A-Z0-9_]{1,40}$/.test(
      err?.code || ""
    )
      ? err.code
      : "ERROR";

  return (
    `status=${status} ` +
    `code=${code}`
  );
}

function codedError(
  code,
  extra = {}
) {
  return Object.assign(
    new Error(code),
    {
      code,
      ...extra
    }
  );
}

/*
 * VERIFY DISCORD REQUEST
 */

let verificationKey;

try {
  if (
    /^[a-f\d]{64}$/i.test(
      PUBLIC_KEY || ""
    )
  ) {
    verificationKey =
      crypto.createPublicKey({
        key:
          Buffer.concat([
            Buffer.from(
              "302a300506032b6570032100",
              "hex"
            ),

            Buffer.from(
              PUBLIC_KEY,
              "hex"
            )
          ]),

        format: "der",
        type: "spki"
      });
  }
} catch {
  // Invalid config reported at startup.
}

function verifyDiscordRequest(
  req,
  rawBody
) {
  const signature =
    req.headers[
      "x-signature-ed25519"
    ];

  const timestamp =
    req.headers[
      "x-signature-timestamp"
    ];

  if (
    !verificationKey ||
    typeof signature !==
      "string" ||
    !/^[a-f\d]{128}$/i.test(
      signature
    ) ||
    typeof timestamp !==
      "string" ||
    !/^\d{10,12}$/.test(
      timestamp
    )
  ) {
    return false;
  }

  if (
    Math.abs(
      Date.now() -
      Number(timestamp) *
        1000
    ) >
    5 * 60 * 1000
  ) {
    return false;
  }

  try {
    return crypto.verify(
      null,

      Buffer.concat([
        Buffer.from(
          timestamp
        ),

        rawBody
      ]),

      verificationKey,

      Buffer.from(
        signature,
        "hex"
      )
    );
  } catch {
    return false;
  }
}

/*
 * DISCORD REST
 */

const restAgent =
  new https.Agent({
    keepAlive: true,
    maxSockets: 8
  });

let rateLimitedUntil = 0;

function discordRequest(
  method,
  apiPath,
  timeoutMs
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      let settled = false;
      let timer;

      const finish =
        (
          err,
          value
        ) => {
          if (settled) {
            return;
          }

          settled = true;

          clearTimeout(
            timer
          );

          if (err) {
            reject(err);
          } else {
            resolve(value);
          }
        };

      const request =
        https.request(
          {
            hostname:
              "discord.com",

            path:
              `/api/v10${apiPath}`,

            method,

            agent:
              restAgent,

            headers: {
              Authorization:
                `Bot ${TOKEN}`,

              "User-Agent":
                "BalticM.eu Discord Bot"
            }
          },

          response => {
            let raw = "";

            response.setEncoding(
              "utf8"
            );

            response.on(
              "data",
              chunk => {
                raw += chunk;

                if (
                  raw.length >
                  2 *
                    1024 *
                    1024
                ) {
                  request.destroy(
                    codedError(
                      "RESPONSE_TOO_LARGE"
                    )
                  );
                }
              }
            );

            response.on(
              "error",
              err =>
                finish(err)
            );

            response.on(
              "aborted",
              () =>
                finish(
                  codedError(
                    "ECONNRESET"
                  )
                )
            );

            response.on(
              "end",
              () => {
                const status =
                  response.statusCode;

                let result = null;

                try {
                  if (raw) {
                    result =
                      JSON.parse(
                        raw
                      );
                  }
                } catch {
                  if (
                    status >= 200 &&
                    status < 300
                  ) {
                    return finish(
                      codedError(
                        "INVALID_RESPONSE"
                      )
                    );
                  }
                }

                if (
                  status >= 200 &&
                  status < 300
                ) {
                  return finish(
                    null,
                    result
                  );
                }

                const seconds =
                  Math.max(
                    0,

                    Number(
                      result
                        ?.retry_after
                    ) || 0,

                    Number(
                      response
                        .headers[
                          "retry-after"
                        ]
                    ) || 0,

                    Number(
                      response
                        .headers[
                          "x-ratelimit-reset-after"
                        ]
                    ) || 0
                  );

                finish(
                  codedError(
                    "DISCORD_HTTP",
                    {
                      status,
                      retryMs:
                        seconds *
                        1000
                    }
                  )
                );
              }
            );
          }
        );

      timer =
        setTimeout(
          () => {
            const err =
              codedError(
                "ETIMEDOUT"
              );

            finish(err);

            request.destroy(
              err
            );
          },
          timeoutMs
        );

      request.on(
        "error",
        err =>
          finish(err)
      );

      request.end();
    }
  );
}

async function discordApi(
  method,
  apiPath,
  requestId
) {
  if (!TOKEN) {
    throw codedError(
      "TOKEN_MISSING"
    );
  }

  const started =
    Date.now();

  const deadline =
    started +
    REST_BUDGET_MS;

  for (
    let attempt = 1;
    attempt <=
      REST_MAX_ATTEMPTS;
    attempt++
  ) {
    while (
      rateLimitedUntil >
      Date.now()
    ) {
      const wait =
        rateLimitedUntil -
        Date.now();

      if (
        Date.now() +
        wait >=
        deadline
      ) {
        throw codedError(
          "RATE_LIMIT_BUDGET"
        );
      }

      await sleep(wait);
    }

    const remaining =
      deadline -
      Date.now();

    if (
      remaining <= 0
    ) {
      throw codedError(
        "RETRY_BUDGET"
      );
    }

    const attemptStarted =
      Date.now();

    try {
      const result =
        await discordRequest(
          method,
          apiPath,
          Math.min(
            REST_TIMEOUT_MS,
            remaining
          )
        );

      if (
        attempt > 1 ||
        Date.now() -
          attemptStarted >=
          1000
      ) {
        log(
          `[${requestId}] REST OK ` +
          `method=${method} ` +
          `attempt=${attempt} ` +
          `ms=${Date.now() - attemptStarted}`
        );
      }

      return result;
    } catch (err) {
      const transient =
        err.status === 429 ||
        (
          err.status >= 500 &&
          err.status <= 599
        ) ||
        [
          "ETIMEDOUT",
          "ECONNRESET",
          "ECONNREFUSED",
          "EAI_AGAIN",
          "EPIPE",
          "ENETUNREACH",
          "EHOSTUNREACH"
        ].includes(
          err.code
        );

      const wait =
        err.status === 429
          ? Math.max(
              1000,
              err.retryMs || 0
            ) + 100
          : Math.min(
              8000,
              500 *
                (
                  2 **
                  (
                    attempt -
                    1
                  )
                )
            ) +
            Math.floor(
              Math.random() *
              250
            );

      if (
        err.status === 429
      ) {
        rateLimitedUntil =
          Math.max(
            rateLimitedUntil,
            Date.now() +
            wait
          );
      }

      if (
        !transient ||
        attempt ===
          REST_MAX_ATTEMPTS ||
        Date.now() +
          wait >=
          deadline
      ) {
        throw err;
      }

      writeDiagnostic(
        "WARN",
        `[${requestId}] REST RETRY ` +
        `method=${method} ` +
        `attempt=${attempt} ` +
        `${failure(err)} ` +
        `ms=${Date.now() - attemptStarted} ` +
        `wait_ms=${wait}`
      );

      await sleep(wait);
    }
  }
}

/*
 * ROLE LOOKUP
 */

let roleCache =
  new Map();

let roleCacheTime = 0;
let roleLoad;

async function loadRoles(
  force,
  requestId
) {
  if (
    !force &&
    roleCache.size &&
    Date.now() -
      roleCacheTime <
      5 * 60 * 1000
  ) {
    return roleCache;
  }

  if (!roleLoad) {
    roleLoad =
      (
        async () => {
          const roles =
            await discordApi(
              "GET",
              `/guilds/${GUILD_ID}/roles`,
              requestId
            );

          if (
            !Array.isArray(
              roles
            )
          ) {
            throw codedError(
              "INVALID_ROLES"
            );
          }

          roleCache =
            new Map(
              roles.map(
                role => [
                  role.name,
                  role.id
                ]
              )
            );

          roleCacheTime =
            Date.now();

          return roleCache;
        }
      )().finally(
        () => {
          roleLoad = null;
        }
      );
  }

  return roleLoad;
}

async function getRoleId(
  roleName,
  requestId
) {
  if (
    Object.prototype
      .hasOwnProperty
      .call(
        KNOWN_ROLE_IDS,
        roleName
      )
  ) {
    return (
      KNOWN_ROLE_IDS[
        roleName
      ]
    );
  }

  let roles =
    await loadRoles(
      false,
      requestId
    );

  if (
    !roles.has(
      roleName
    )
  ) {
    roles =
      await loadRoles(
        true,
        requestId
      );
  }

  const id =
    roles.get(
      roleName
    );

  if (
    !/^\d+$/.test(
      id || ""
    )
  ) {
    throw codedError(
      "ROLE_NOT_FOUND"
    );
  }

  return id;
}

/*
 * REACTION ROLE BUTTONS
 */

const buttonRoles =
  new Map([
    [
      "role_latvian",
      ROLE_NAMES.latvian
    ],

    ...Object.entries(
      NOTIFICATION_ROLES
    ),

    ...Object.entries(
      GAME_BUTTON_ROLES
    )
  ]);

const seenInteractions =
  new Map();

const memberQueues =
  new Map();

const activeJobs =
  new Set();

let stopping = false;

function enqueueComponent(
  interaction,
  requestId
) {
  const roleName =
    buttonRoles.get(
      interaction.data
        ?.custom_id
    );

  const userId =
    interaction.member
      ?.user
      ?.id;

  if (
    !roleName ||
    interaction.guild_id !==
      GUILD_ID ||
    !/^\d+$/.test(
      userId || ""
    ) ||
    !/^\d+$/.test(
      interaction.id || ""
    ) ||
    !Array.isArray(
      interaction.member
        ?.roles
    )
  ) {
    logError(
      `[${requestId}] COMPONENT INVALID`
    );

    return;
  }

  const now =
    Date.now();

  for (
    const [
      id,
      entry
    ] of seenInteractions
  ) {
    if (
      entry.done &&
      now -
        entry.time >
        15 * 60 * 1000
    ) {
      seenInteractions.delete(
        id
      );
    }
  }

  if (
    seenInteractions.has(
      interaction.id
    )
  ) {
    log(
      `[${requestId}] DUPLICATE IGNORED`
    );

    return;
  }

  if (
    activeJobs.size >=
      1000 ||
    seenInteractions.size >=
      20000
  ) {
    logError(
      `[${requestId}] QUEUE CAPACITY`
    );

    return;
  }

  const entry = {
    time: now,
    done: false
  };

  seenInteractions.set(
    interaction.id,
    entry
  );

  const queueKey =
    `${userId}:${roleName}`;

  const previous =
    memberQueues.get(
      queueKey
    ) ||
    Promise.resolve();

  const job =
    previous
      .then(
        async () => {
          const started =
            Date.now();

          const roleId =
            await getRoleId(
              roleName,
              requestId
            );

          const method =
            interaction.member
              .roles
              .includes(
                roleId
              )
              ? "DELETE"
              : "PUT";

          await discordApi(
            method,

            `/guilds/${GUILD_ID}` +
            `/members/${userId}` +
            `/roles/${roleId}`,

            requestId
          );

          log(
            `[${requestId}] ROLE ` +
            `${method === "PUT" ? "ADDED" : "REMOVED"} ` +
            `button=${interaction.data.custom_id} ` +
            `ms=${Date.now() - started} ` +
            `queue_ms=${started - now}`
          );
        }
      )
      .catch(
        err => {
          logError(
            `[${requestId}] COMPONENT FAILED ` +
            `${failure(err)} ` +
            `total_ms=${Date.now() - now}`
          );
        }
      )
      .finally(
        () => {
          entry.done = true;
          entry.time =
            Date.now();

          activeJobs.delete(
            job
          );

          if (
            memberQueues.get(
              queueKey
            ) === job
          ) {
            memberQueues.delete(
              queueKey
            );
          }
        }
      );

  memberQueues.set(
    queueKey,
    job
  );

  activeJobs.add(
    job
  );
}

/*
 * MUSIC HTTP
 */

function musicRequest(
  payload,
  timeoutMs = 30000
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      if (
        !MUSIC_SERVICE_SECRET
      ) {
        return reject(
          codedError(
            "MUSIC_SECRET_MISSING"
          )
        );
      }

      const body =
        JSON.stringify(
          payload
        );

      const musicStarted =
        Date.now();

      addPlayDiagnostic(
        "MUSIC_REQUEST_START",
        {
          guildId:
            payload?.guildId || null,
          userId:
            payload?.userId || null,
          commandChannelId:
            payload?.commandChannelId || null
        }
      );

      let settled = false;
      let timer;

      const finish =
        (
          err,
          value
        ) => {
          if (settled) {
            return;
          }

          settled = true;

          clearTimeout(
            timer
          );

          if (err) {
            addPlayDiagnostic(
              "MUSIC_REQUEST_ERROR",
              {
                code:
                  err?.code || null,
                status:
                  Number.isInteger(
                    err?.status
                  )
                    ? err.status
                    : null,
                elapsedMs:
                  Date.now() -
                  musicStarted
              }
            );

            reject(err);
          } else {
            resolve(value);
          }
        };

      const request =
        https.request(
          {
            hostname:
              MUSIC_HOST,

            path:
              MUSIC_PLAY_PATH,

            method:
              "POST",

            agent:
              restAgent,

            headers: {
              "Content-Type":
                "application/json",

              "Content-Length":
                Buffer.byteLength(
                  body
                ),

              "X-BalticM-Service-Secret":
                MUSIC_SERVICE_SECRET,

              "User-Agent":
                "BalticM.eu Discord Bot"
            }
          },

          response => {
            let raw = "";

            response.setEncoding(
              "utf8"
            );

            response.on(
              "data",
              chunk => {
                raw += chunk;

                if (
                  raw.length >
                  1024 * 1024
                ) {
                  request.destroy(
                    codedError(
                      "MUSIC_RESPONSE_TOO_LARGE"
                    )
                  );
                }
              }
            );

            response.on(
              "error",
              err =>
                finish(err)
            );

            response.on(
              "aborted",
              () =>
                finish(
                  codedError(
                    "ECONNRESET"
                  )
                )
            );

            response.on(
              "end",
              () => {
                let data = {};

                try {
                  if (raw) {
                    data =
                      JSON.parse(
                        raw
                      );
                  }
                } catch {
                  return finish(
                    codedError(
                      "MUSIC_INVALID_RESPONSE"
                    )
                  );
                }

                const status =
                  response.statusCode ||
                  500;

                addPlayDiagnostic(
                  "MUSIC_HTTP_STATUS",
                  {
                    status,
                    elapsedMs:
                      Date.now() -
                      musicStarted
                  }
                );

                if (
                  status >= 200 &&
                  status < 300 &&
                  data?.ok
                ) {
                  addPlayDiagnostic(
                    "MUSIC_RESPONSE_OK",
                    {
                      status,
                      elapsedMs:
                        Date.now() -
                        musicStarted
                    }
                  );

                  return finish(
                    null,
                    data
                  );
                }

                const err =
                  codedError(
                    "MUSIC_HTTP",
                    {
                      status
                    }
                  );

                err.publicMessage =
                  typeof data?.error ===
                    "string"
                    ? data.error
                    : "Music service request failed.";

                finish(err);
              }
            );
          }
        );

      timer =
        setTimeout(
          () => {
            const err =
              codedError(
                "MUSIC_TIMEOUT"
              );

            finish(err);

            request.destroy(
              err
            );
          },
          timeoutMs
        );

      request.on(
        "error",
        err =>
          finish(err)
      );

      request.write(
        body
      );

      request.end();
    }
  );
}

/*
 * DISCORD WEBHOOK RESPONSE
 *
 * After a type 5 deferred interaction response,
 * PATCH @original replaces "thinking..." with
 * the final message.
 */

function editOriginalInteraction(
  applicationId,
  interactionToken,
  content,
  timeoutMs = 10000
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      const body =
        JSON.stringify({
          content
        });

      let settled = false;
      let timer;

      const finish =
        (
          err,
          value
        ) => {
          if (settled) {
            return;
          }

          settled = true;

          clearTimeout(
            timer
          );

          if (err) {
            reject(err);
          } else {
            resolve(value);
          }
        };

      const request =
        https.request(
          {
            hostname:
              "discord.com",

            path:
              `/api/v10/webhooks/` +
              `${encodeURIComponent(applicationId)}/` +
              `${encodeURIComponent(interactionToken)}/messages/@original`,

            method:
              "PATCH",

            agent:
              restAgent,

            headers: {
              "Content-Type":
                "application/json",

              "Content-Length":
                Buffer.byteLength(
                  body
                ),

              "User-Agent":
                "BalticM.eu Discord Bot"
            }
          },

          response => {
            let raw = "";

            response.setEncoding(
              "utf8"
            );

            response.on(
              "data",
              chunk => {
                raw += chunk;
              }
            );

            response.on(
              "error",
              err =>
                finish(err)
            );

            response.on(
              "aborted",
              () =>
                finish(
                  codedError(
                    "ECONNRESET"
                  )
                )
            );

            response.on(
              "end",
              () => {
                const status =
                  response.statusCode ||
                  500;

                if (
                  status >= 200 &&
                  status < 300
                ) {
                  return finish(
                    null,
                    true
                  );
                }

                finish(
                  codedError(
                    "DISCORD_WEBHOOK_HTTP",
                    {
                      status
                    }
                  )
                );
              }
            );
          }
        );

      timer =
        setTimeout(
          () => {
            const err =
              codedError(
                "DISCORD_WEBHOOK_TIMEOUT"
              );

            finish(err);

            request.destroy(
              err
            );
          },
          timeoutMs
        );

      request.on(
        "error",
        err =>
          finish(err)
      );

      request.write(
        body
      );

      request.end();
    }
  );
}

function getCommandOption(
  interaction,
  name
) {
  const options =
    interaction.data
      ?.options;

  if (
    !Array.isArray(
      options
    )
  ) {
    return "";
  }

  const option =
    options.find(
      item =>
        item?.name ===
        name
    );

  return typeof option?.value ===
    "string"
    ? option.value
    : "";
}

function enqueuePlay(
  interaction,
  requestId
) {
  const guildId =
    String(
      interaction.guild_id ||
      ""
    );

  const userId =
    String(
      interaction.member
        ?.user
        ?.id ||
      interaction.user
        ?.id ||
      ""
    );

  const channelId =
    String(
      interaction.channel_id ||
      ""
    );

  const applicationId =
    String(
      interaction.application_id ||
      ""
    );

  const interactionToken =
    String(
      interaction.token ||
      ""
    );

  const query =
    getCommandOption(
      interaction,
      "query"
    ).trim();

  addPlayDiagnostic(
    "ENQUEUE_PLAY",
    {
      requestId,
      guildId:
        guildId || null,
      userId:
        userId || null,
      commandChannelId:
        channelId || null,
      hasQuery:
        Boolean(query)
    }
  );

  const job =
    (
      async () => {
        try {
          if (
            !guildId ||
            !userId ||
            !channelId ||
            !applicationId ||
            !interactionToken
          ) {
            throw Object.assign(
              codedError(
                "PLAY_INVALID_INTERACTION"
              ),
              {
                publicMessage:
                  "Invalid /play interaction."
              }
            );
          }

          addPlayDiagnostic(
            "MUSIC_CALL_BEGIN",
            {
              requestId
            }
          );

          const result =
            await musicRequest({
              guildId,
              userId,

              commandChannelId:
                channelId,

              query
            });

          const channelName =
            result.channelName ||
            "voice channel";

          const content =
            `✅ Connected to **${channelName}**.` +
            (
              query
                ? `\n🎵 Request: **${query}**`
                : ""
            );

          addPlayDiagnostic(
            "WEBHOOK_EDIT_START",
            {
              requestId,
              outcome: "success"
            }
          );

          await editOriginalInteraction(
            applicationId,
            interactionToken,
            content
          );

          addPlayDiagnostic(
            "WEBHOOK_EDIT_OK",
            {
              requestId,
              outcome: "success"
            }
          );

          addPlayDiagnostic(
            "PLAY_OK",
            {
              requestId
            }
          );

          log(
            `[${requestId}] PLAY OK`
          );
        } catch (err) {
          addPlayDiagnostic(
            "PLAY_FAILED",
            {
              requestId,
              code:
                err?.code || null,
              status:
                Number.isInteger(
                  err?.status
                )
                  ? err.status
                  : null
            }
          );

          logError(
            `[${requestId}] PLAY FAILED ` +
            `${failure(err)}`
          );

          const message =
            typeof err?.publicMessage ===
              "string"
              ? err.publicMessage
              : (
                  err?.code ===
                  "MUSIC_SECRET_MISSING"
                    ? "Music service is not configured."
                    : "Music command failed."
                );

          addPlayDiagnostic(
            "WEBHOOK_EDIT_START",
            {
              requestId,
              outcome: "error"
            }
          );

          await editOriginalInteraction(
            applicationId,
            interactionToken,
            `❌ ${message}`
          ).then(
            () => {
              addPlayDiagnostic(
                "WEBHOOK_EDIT_OK",
                {
                  requestId,
                  outcome: "error"
                }
              );
            }
          ).catch(
            editErr => {
              addPlayDiagnostic(
                "WEBHOOK_EDIT_ERROR",
                {
                  requestId,
                  outcome: "error",
                  code:
                    editErr?.code || null,
                  status:
                    Number.isInteger(
                      editErr?.status
                    )
                      ? editErr.status
                      : null
                }
              );

              logError(
                `[${requestId}] PLAY ERROR RESPONSE FAILED ` +
                `${failure(editErr)}`
              );
            }
          );
        }
      }
    )();

  activeJobs.add(
    job
  );

  job.finally(
    () => {
      activeJobs.delete(
        job
      );
    }
  );
}

/*
 * HTTP RESPONSE HELPERS
 */

function sendJson(
  res,
  status,
  payload
) {
  const json =
    JSON.stringify(
      payload
    );

  res.writeHead(
    status,
    {
      "Content-Type":
        "application/json; charset=utf-8",

      "Content-Length":
        Buffer.byteLength(
          json
        ),

      "Cache-Control":
        "no-store"
    }
  );

  res.end(json);
}

function sendText(
  res,
  status,
  body
) {
  res.writeHead(
    status,
    {
      "Content-Type":
        "text/plain; charset=utf-8",

      "Content-Length":
        Buffer.byteLength(
          body
        ),

      "Cache-Control":
        "no-store, no-cache, must-revalidate",

      Pragma:
        "no-cache",

      "X-Content-Type-Options":
        "nosniff"
    }
  );

  res.end(body);
}

function diagnosticsKeyMatches(
  suppliedKey
) {
  if (
    !DIAGNOSTICS_KEY ||
    typeof suppliedKey !==
      "string" ||
    !suppliedKey
  ) {
    return false;
  }

  const expected =
    Buffer.from(
      DIAGNOSTICS_KEY
    );

  const supplied =
    Buffer.from(
      suppliedKey
    );

  return (
    expected.length ===
      supplied.length &&
    crypto.timingSafeEqual(
      expected,
      supplied
    )
  );
}

/*
 * HTTP SERVER
 */

let requestCounter = 0;

const server =
  http.createServer(
    (
      req,
      res
    ) => {
      const requestId =
        ++requestCounter;

      const started =
        Date.now();

      let url;

      try {
        url =
          new URL(
            req.url,
            "http://localhost"
          );
      } catch {
        return sendJson(
          res,
          400,
          {
            error:
              "Invalid URL"
          }
        );
      }

      res.on(
        "error",
        () =>
          logError(
            `[${requestId}] RESPONSE ERROR`
          )
      );

      res.once(
        "finish",
        () => {
          if (
            req.method !==
              "GET" ||
            res.statusCode >=
              400
          ) {
            log(
              `[${requestId}] HTTP ` +
              `${req.method} ` +
              `${url.pathname} ` +
              `status=${res.statusCode} ` +
              `ms=${Date.now() - started}`
            );
          }
        }
      );

      /*
       * DIAGNOSTICS
       */

      if (
        req.method ===
          "GET" &&
        [
          "/diagnostics",
          "/discord-bot/diagnostics"
        ].includes(
          url.pathname
        )
      ) {
        if (
          !DIAGNOSTICS_KEY
        ) {
          return sendText(
            res,
            503,
            "Diagnostics disabled."
          );
        }

        if (
          !diagnosticsKeyMatches(
            url.searchParams.get(
              "key"
            )
          )
        ) {
          return sendText(
            res,
            403,
            "Forbidden"
          );
        }

        readTail(
          MAX_DIAGNOSTICS_VIEW_BYTES
        )
          .then(
            tail => {
              sendText(
                res,
                200,
                [
                  "BalticM.eu Discord Bot Diagnostics",

                  `Version: ${VERSION}`,

                  `Generated: ${nowIso()}`,

                  `Active jobs: ${activeJobs.size}`,

                  "",

                  tail ||
                    "No diagnostics have been written yet."
                ].join("\n")
              );
            }
          )
          .catch(
            () => {
              if (
                !res.headersSent
              ) {
                sendText(
                  res,
                  500,
                  "Diagnostics read failed."
                );
              }
            }
          );

        return;
      }

      /*
       * HEALTH
       */

      if (
        req.method ===
          "GET"
      ) {
        return sendJson(
          res,
          stopping
            ? 503
            : 200,
          {
            ok:
              !stopping,

            service:
              "BalticM.eu Discord Bot",

            status:
              stopping
                ? "stopping"
                : "online",

            version:
              VERSION,

            pid:
              process.pid,

            uptimeSeconds:
              Math.floor(process.uptime()),

            activeJobs:
              activeJobs.size,

            musicSecretConfigured:
              Boolean(
                MUSIC_SERVICE_SECRET
              ),

            time:
              nowIso(),

            playDiagnostic:
              playDiagnostic.slice(
                -100
              )
          }
        );
      }

      if (
        req.method !==
          "POST"
      ) {
        return sendJson(
          res,
          405,
          {
            error:
              "Method Not Allowed"
          }
        );
      }

      if (stopping) {
        return sendJson(
          res,
          503,
          {
            error:
              "Server restarting"
          }
        );
      }

      let size = 0;
      let chunks = [];

      req.on(
        "data",
        chunk => {
          size +=
            chunk.length;

          if (
            size >
            MAX_BODY_BYTES
          ) {
            chunks = [];

            if (
              !res.headersSent
            ) {
              sendJson(
                res,
                413,
                {
                  error:
                    "Body too large"
                }
              );
            }
          } else {
            chunks.push(
              chunk
            );
          }
        }
      );

      req.on(
        "error",
        () =>
          logError(
            `[${requestId}] REQUEST ERROR`
          )
      );

      req.on(
        "end",
        () => {
          if (
            res.headersSent
          ) {
            return;
          }

          const rawBody =
            Buffer.concat(
              chunks
            );

          if (
            !verifyDiscordRequest(
              req,
              rawBody
            )
          ) {
            logError(
              `[${requestId}] INVALID SIGNATURE`
            );

            return sendJson(
              res,
              401,
              {
                error:
                  "Invalid request signature"
              }
            );
          }

          let interaction;

          try {
            interaction =
              JSON.parse(
                rawBody.toString(
                  "utf8"
                )
              );
          } catch {
            return sendJson(
              res,
              400,
              {
                error:
                  "Invalid JSON"
              }
            );
          }

          if (
            !interaction ||
            typeof interaction !==
              "object"
          ) {
            return sendJson(
              res,
              400,
              {
                error:
                  "Invalid interaction"
              }
            );
          }

          /*
           * DISCORD PING
           */

          if (
            interaction.type ===
              1
          ) {
            return sendJson(
              res,
              200,
              {
                type: 1
              }
            );
          }

          /*
           * REACTION ROLE BUTTONS
           */

          if (
            interaction.type ===
              3
          ) {
            res.once(
              "finish",
              () => {
                log(
                  `[${requestId}] ACK type=6 ` +
                  `ms=${Date.now() - started}`
                );

                enqueueComponent(
                  interaction,
                  requestId
                );
              }
            );

            return sendJson(
              res,
              200,
              {
                type: 6
              }
            );
          }

          /*
           * SLASH COMMAND /play
           *
           * Type 5 = deferred channel message.
           * flags 64 = ephemeral.
           *
           * Discord gets the ACK immediately.
           * Only after the response has finished do
           * we contact the Music service.
           */

          if (
            interaction.type ===
              2 &&
            interaction.data
              ?.name ===
              "play"
          ) {
            addPlayDiagnostic(
              "PLAY_RECEIVED",
              {
                requestId,
                pid: process.pid,
                guildId:
                  interaction.guild_id ||
                  null,
                userId:
                  interaction.member
                    ?.user?.id ||
                  interaction.user?.id ||
                  null,
                commandChannelId:
                  interaction.channel_id ||
                  null,
                hasQuery:
                  Boolean(
                    getCommandOption(
                      interaction,
                      "query"
                    ).trim()
                  )
              }
            );

            res.once(
              "finish",
              () => {
                addPlayDiagnostic(
                  "ACK_SENT",
                  {
                    requestId,
                    pid: process.pid,
                    type: 5,
                    elapsedMs:
                      Date.now() -
                      started
                  }
                );

                log(
                  `[${requestId}] PLAY ACK type=5 ` +
                  `ms=${Date.now() - started}`
                );

                enqueuePlay(
                  interaction,
                  requestId
                );
              }
            );

            return sendJson(
              res,
              200,
              {
                type: 5,

                data: {
                  flags: 64
                }
              }
            );
          }

          /*
           * OTHER INTERACTIONS
           */

          return sendJson(
            res,
            200,
            {
              type: 4,

              data: {
                content:
                  "BalticM.eu interaction server is online.",

                flags: 64
              }
            }
          );
        }
      );
    }
  );

server.requestTimeout =
  15000;

server.headersTimeout =
  10000;

server.on(
  "error",
  err =>
    logError(
      `HTTP SERVER ERROR ${failure(err)}`
    )
);

/*
 * SHUTDOWN
 */

async function shutdown(
  signal
) {
  if (stopping) {
    return;
  }

  stopping = true;

  log(
    `SHUTDOWN ${signal} ` +
    `active=${activeJobs.size}`
  );

  server.close();

  const deadline =
    setTimeout(
      () => {
        logError(
          `SHUTDOWN DEADLINE ` +
          `active=${activeJobs.size}`
        );

        process.exit(1);
      },
      30000
    );

  while (
    activeJobs.size
  ) {
    await Promise.allSettled(
      [
        ...activeJobs
      ]
    );
  }

  await logQueue;

  clearTimeout(
    deadline
  );

  restAgent.destroy();

  process.exit(0);
}

process.on(
  "SIGTERM",
  () => {
    void shutdown(
      "SIGTERM"
    );
  }
);

process.on(
  "SIGINT",
  () => {
    void shutdown(
      "SIGINT"
    );
  }
);

process.on(
  "uncaughtException",
  err => {
    logError(
      `UNCAUGHT EXCEPTION ${failure(err)}`
    );

    void shutdown(
      "FATAL"
    );
  }
);

process.on(
  "unhandledRejection",
  err => {
    logError(
      `UNHANDLED REJECTION ${failure(err)}`
    );

    void shutdown(
      "FATAL"
    );
  }
);

server.listen(
  PORT,
  () => {
    log(
      `START version=${VERSION}`
    );

    if (
      !TOKEN ||
      !verificationKey
    ) {
      logError(
        "CONFIGURATION INVALID: check Discord token/public key"
      );
    }

    if (
      !MUSIC_SERVICE_SECRET
    ) {
      logError(
        "CONFIGURATION INVALID: BALTICM_MUSIC_SERVICE_SECRET missing"
      );
    }
  }
);