import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = readFileSync(join(root, "worker.js"), "utf8");
const mainSrc = readFileSync(join(root, "src/main.jsx"), "utf8");
const stateSrc = readFileSync(join(root, "src/control-center-state.js"), "utf8");

const MODULE_KEYS = [
  "direct_messages",
  "tickets",
  "members_roles",
  "moderation",
  "reaction_roles",
  "giveaways",
  "announcements",
  "voice_create",
  "music_bot",
  "streamers"
];

test("worker maps feature-module API paths for enforcement", () => {
  assert.match(workerSrc, /routeAccessKey\(p\)/);
  assert.match(workerSrc, /from "\.\/access-control\.js"/);
  for (const key of MODULE_KEYS) {
    assert.match(workerSrc, new RegExp(`"${key}"`));
  }
  assert.match(
    workerSrc,
    /MODULE_KEYS\.includes\(routeKey\)&&!await moduleEnabled\(env,guildIdForAccess,routeKey\)\)return json\(\{error:"Feature module is disabled"/
  );
});

test("control-access returns guild module flags with permissions", () => {
  assert.match(
    workerSrc,
    /if\(p==="\/api\/control-access"\)\{[\s\S]*?moduleSettingsState\(env,guildId\)[\s\S]*?return json\(\{permissions,modules\}\)/
  );
});

test("saveModuleSettings keeps all keys and does not wipe other config stores", () => {
  assert.match(
    workerSrc,
    /async function saveModuleSettings\(req,env,guildId\)\{[\s\S]*?for\(const k of MODULE_KEYS\)modules\[k\]=b\.modules\?\.\[k\]!==false;[\s\S]*?writeBotConfig\(env,moduleSettingsKey\(guildId\),config\)/
  );
  assert.match(workerSrc, /moduleSettingsKey=guildId=>"module-settings:"\+guildId/);
  assert.match(workerSrc, /async function moduleEnabled\(env,guildId,key\)\{if\(!MODULE_KEYS\.includes\(key\)\)return true;const c=await moduleSettingsState\(env,guildId\);return c\.modules\?\.\[key\]!==false\}/);
});

test("frontend hides disabled feature modules and refreshes after save", () => {
  assert.match(stateSrc, /FEATURE_MODULE_BY_PAGE =/);
  assert.match(mainSrc, /FEATURE_MODULE_BY_PAGE/);
  assert.match(mainSrc, /featureModules&&featureModules\[mk\]===false\)return false/);
  assert.match(mainSrc, /setFeatureModules\(x\?\.modules\|\|\{\}\)/);
  assert.match(mainSrc, /onFeatureModulesChange\(j\.config\?\.modules\|\|\{\}\)/);
  assert.match(mainSrc, /function ModuleDisabled\(/);
  assert.match(mainSrc, /featureModules\[FEATURE_MODULE_BY_PAGE\[page\]\]===false\?<ModuleDisabled/);
  for (const label of [
    "Direct Messages",
    "Tickets",
    "Members & Roles",
    "Moderation",
    "Reaction Roles",
    "Giveaways",
    "Announcements",
    "Voice Create",
    "Music Bot",
    "Streamers"
  ]) {
    assert.match(stateSrc, new RegExp(`["']?${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?:\\s*["']`));
  }
});
