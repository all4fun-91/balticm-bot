import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const component=fs.readFileSync(new URL("../src/BalticMPremiumShop.jsx",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../src/balticm-premium-shop.css",import.meta.url),"utf8");
const main=fs.readFileSync(new URL("../src/main.jsx",import.meta.url),"utf8");
const worker=fs.readFileSync(new URL("../worker.js",import.meta.url),"utf8");

test("Premium route mounts the integrated shop inside the existing Control Center",()=>{
 assert.match(main,/import BalticMPremiumShop from"\.\/BalticMPremiumShop\.jsx";/);
 assert.match(main,/page==="Premium"&&<BalticMPremiumShop user=\{user\} selectedGuild=\{selectedGuild\}\/>/);
 assert.doesNotMatch(component,/createRoot|ReactDOM|<html|<body/i);
});

test("Premium shop keeps the existing authenticated Tebex API contract",()=>{
 for(const path of ["/api/premium?guildId=","/api/premium/tebex/checkout?guildId=","/api/premium/tebex/coupon?guildId="]){
  assert.ok(component.includes(path),`${path} is not connected`);
 }
 assert.match(component,/method:"POST"/);
 assert.match(component,/Tebex\.checkout\.render/);
 assert.match(component,/Payment details are processed by Tebex/);
 for(const path of ["/api/premium/tebex/checkout","/api/premium/tebex/coupon","/api/premium"]){
  assert.ok(worker.includes(path),`${path} backend route is missing`);
 }
});

test("Premium shop preserves per-server selection and responsive layouts",()=>{
 assert.match(component,/selectedGuild/);
 assert.match(component,/Guild ID:/);
 assert.match(css,/@media\(max-width:1000px\)/);
 assert.match(css,/@media\(max-width:760px\)/);
 assert.match(css,/grid-template-columns:1fr/);
 assert.match(css,/width:100vw/);
});

test("Admin and rate-limit-safe Direct Messages integrations remain mounted",()=>{
 assert.match(main,/if\(isAdminRoute\)return <AdminPanel\/>/);
 assert.match(main,/import \{ runDmBatchQueue \} from "\.\/direct-messages-queue\.js";/);
 assert.match(main,/await runDmBatchQueue\(\{/);
});
