import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const panel=fs.readFileSync(new URL("../src/AdminPanel.jsx",import.meta.url),"utf8");
const modules=fs.readFileSync(new URL("../src/admin-modules.jsx",import.meta.url),"utf8");
const main=fs.readFileSync(new URL("../src/main.jsx",import.meta.url),"utf8");

test("Admin Panel mounts every production module without placeholder copy",()=>{
 for(const name of ["SubscriptionsModule","CodesModule","TebexModule","AssistantModule","LogsModule","SettingsModule"]){
  assert.match(panel,new RegExp(`<${name}\\s*/>`));
 }
 assert.doesNotMatch(panel,/\bSOON\b|reserved for the next stage/i);
});

test("Admin frontend routes match the existing Worker API surface",()=>{
 for(const path of [
  "/api/admin/subscriptions",
  "/api/admin/vip-codes",
  "/api/admin/tebex",
  "/api/admin/assistant",
  "/api/admin/logs",
  "/api/admin/settings"
 ])assert.ok(modules.includes(path),`${path} is not connected`);
});

test("Direct Messages UI dispatches through the tested sequential queue",()=>{
 assert.match(main,/import \{ runDmBatchQueue \}/);
 assert.match(main,/await runDmBatchQueue\(\{/);
 assert.doesNotMatch(main,/for\(let i=0;i<batches\.length;i\+\+\)/);
});
