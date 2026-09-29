import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strippedStreamingOAuthSearch } from "../streaming-oauth.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const legalSrc = readFileSync(join(root, "src/LegalPages.jsx"), "utf8");
const mainSrc = readFileSync(join(root, "src/main.jsx"), "utf8");
const stateSrc = readFileSync(join(root, "src/control-center-state.js"), "utf8");

test("privacy policy covers Discord, streaming OAuth, Google Limited Use, and real support contact", () => {
  assert.match(legalSrc, /Privacy Policy/);
  assert.match(legalSrc, /Discord authentication/);
  assert.match(legalSrc, /user ID/);
  assert.match(legalSrc, /connected streaming accounts/i);
  assert.match(legalSrc, /Twitch/);
  assert.match(legalSrc, /YouTube/);
  assert.match(legalSrc, /TikTok/);
  assert.match(legalSrc, /Kick/);
  assert.match(legalSrc, /LIVE announcements/);
  assert.match(legalSrc, /not exposed publicly/);
  assert.match(legalSrc, /Google API Services User Data Policy/);
  assert.match(legalSrc, /Limited Use/);
  assert.match(legalSrc, /youtube\.readonly/);
  assert.doesNotMatch(legalSrc, /@gmail\.com/);
  assert.doesNotMatch(legalSrc, /support@/);
  assert.match(legalSrc, /href=\{SUPPORT_DISCORD_URL\}/);
  assert.match(stateSrc, /SUPPORT_DISCORD_URL = "https:\/\/discord\.gg\/4MZUuyAdeM"/);
});

test("terms of service cover product use without invented company registry details", () => {
  assert.match(legalSrc, /Terms of Service/);
  assert.match(legalSrc, /Acceptance of terms/);
  assert.match(legalSrc, /Premium/);
  assert.match(legalSrc, /Tebex/);
  assert.match(legalSrc, /Limitation of liability/);
  assert.doesNotMatch(legalSrc, /registration number/i);
  assert.doesNotMatch(legalSrc, /VAT ID/i);
});

test("footer legal links open shared modal without leaving the current route", () => {
  assert.match(mainSrc, /PLAY TOGETHER • MANAGE SMARTER/);
  assert.match(mainSrc, /openLegalModal\("Privacy"\)/);
  assert.match(mainSrc, /openLegalModal\("Terms"\)/);
  assert.match(mainSrc, /legalModal&&!isPublicPage\(page\)&&<LegalModal/);
  assert.match(legalSrc, /export function LegalModal/);
  assert.match(legalSrc, /export function LegalContent/);
  assert.match(legalSrc, /aria-modal="true"/);
  assert.doesNotMatch(mainSrc, /onClick=\{e=>\{e\.preventDefault\(\);openPage\("Privacy"\)\}\}/);
});

test("standalone /privacy and /terms still render LegalPages from shared content", () => {
  assert.match(mainSrc, /isPublicPage\(page\)\?<LegalPages page=\{page\}/);
  assert.match(legalSrc, /export default function LegalPages/);
  assert.match(legalSrc, /LegalContent page=\{page\}/);
});

test("navigation strips consumed streaming OAuth query params without removing other query values", () => {
  assert.equal(strippedStreamingOAuthSearch("?streaming_error=The+connection+could+not+be+completed.&tab=1"), "tab=1");
  assert.equal(strippedStreamingOAuthSearch("?streaming=connected&platform=youtube&x=1"), "x=1");
  assert.equal(strippedStreamingOAuthSearch("?streaming_success=ok"), "");
  assert.match(mainSrc, /strippedStreamingOAuthSearch/);
  assert.match(mainSrc, /cleanNavSearch/);
});
