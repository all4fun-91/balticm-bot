import React, { useEffect } from "react";
import { SUPPORT_DISCORD_URL } from "./control-center-state.js";

const PRIVACY_SECTIONS = [
  {
    id: "collect",
    title: "Information we collect",
    body: [
      "BalticM Bot and Control Center collect only what is needed to sign you in, run Discord server tools, process support requests, manage Premium where you buy it, and operate optional streaming integrations you connect.",
      "Depending on how you use the service, that can include Discord authentication data, Discord user ID, username or display name and avatar, Discord server (guild) information required for Control Center, configuration and service settings you save, support tickets and messages, subscription or customer records for Premium, connected streaming accounts, OAuth account identifiers and authorization credentials or tokens required for those connections, live-stream status used for Discord LIVE announcements, and security, abuse-prevention and operational logs."
    ]
  },
  {
    id: "use",
    title: "How information is used",
    body: [
      "We use this information to authenticate you, authorize access to servers you can manage, provide Control Center modules (for example tickets, moderation, music, streamers and settings), announce live streams you have configured, fulfill Premium purchases, respond to support, keep the service secure, and meet legal obligations.",
      "OAuth credentials and tokens are used only to provide the integration you requested. They are stored on the server, are not shown in the Control Center interface, and are not exposed publicly."
    ]
  },
  {
    id: "discord",
    title: "Discord data",
    body: [
      "When you sign in with Discord we receive the Discord account information needed to create your Control Center session (typically user ID, username, display name and avatar) and the list of Discord servers you can manage so you can choose an active server.",
      "For a selected server we load guild metadata, channels, roles and members as required by the module you are using (for example tickets, reaction roles, moderation or music). Server configuration you save in Control Center is stored so the bot can apply it on Discord.",
      "We do not ask Discord for your password. Session cookies keep you signed in to Control Center."
    ]
  },
  {
    id: "streaming",
    title: "Connected streaming accounts",
    body: [
      "From your Profile you can connect Twitch, YouTube (Google), TikTok and Kick. Connection is optional. For each provider we store identifiers needed to recognize your channel (for example channel or user ID, login or handle, display name, profile image URL and public profile or watch URL), verification status, and encrypted access and refresh tokens plus granted OAuth scopes so we can keep the connection working.",
      "We use those connections to confirm that the account is yours, to read live-stream status, and to post Discord LIVE announcements you configure in Streamers. We do not publish OAuth tokens. Disconnecting a provider in Profile removes that stored connection for your Discord user. You can also revoke BalticM from the provider’s own security or connected-apps settings."
    ]
  },
  {
    id: "google",
    title: "Google / YouTube API data",
    body: [
      "YouTube connection uses Google OAuth with the YouTube Data API read-only scope (youtube.readonly). After you authorize BalticM we request your YouTube channel identity (channel ID and public snippet such as title and thumbnails) and use the same authorization to read live status for Discord LIVE announcements.",
      "We do not use Google APIs to read Gmail, Drive, Photos, or other Google products. We do not sell Google user data or use it for advertising. Tokens are stored only on our servers to maintain the YouTube integration you enabled.",
      "BalticM's use and transfer of information received from Google APIs follows the Google API Services User Data Policy, including the Limited Use requirements."
    ]
  },
  {
    id: "storage",
    title: "Data storage and security",
    body: [
      "Control Center and related APIs run on our hosting (including Cloudflare). Configuration, support conversations, Premium status and streaming connections are stored in our application databases. Streaming OAuth tokens are encrypted at rest on the server.",
      "Access to guild-scoped tools is checked on the server. A stored guild ID in your browser never bypasses authorization. We use HTTPS, session cookies, and operational logging to protect the service and investigate abuse. No method of transmission or storage is perfectly secure."
    ]
  },
  {
    id: "sharing",
    title: "Data sharing",
    body: [
      "We share data with the platforms you use to operate the product: Discord (bot and OAuth), Twitch, Google/YouTube, TikTok, Kick, and Tebex when you buy Premium. Those providers process data under their own policies.",
      "We may share information with infrastructure and security providers who process it on our behalf, or when required by law, or to protect users and the service from abuse. We do not sell your personal information."
    ]
  },
  {
    id: "retention",
    title: "Data retention",
    body: [
      "We keep session, configuration, support, Premium and streaming-connection records for as long as needed to provide the service, resolve disputes, prevent abuse and meet legal requirements. You can disconnect streaming accounts at any time. Signing out ends the current Control Center session. Removing the bot from a Discord server or losing access to a guild means we will no longer treat that guild as authorized for you."
    ]
  },
  {
    id: "revoke",
    title: "Account disconnect / revocation",
    body: [
      "Disconnect a streaming provider from Profile in Control Center. Revoke Discord access from Discord’s Authorized Apps. Revoke Google/YouTube access from your Google Account’s third-party app settings. After revocation we stop using that authorization; leftover encrypted tokens are removed when you disconnect in Profile or when we process the revocation."
    ]
  },
  {
    id: "rights",
    title: "User rights",
    body: [
      "Depending on where you live you may have rights to access, correct, delete or restrict processing of personal data we hold, or to object to certain processing. Use Control Center Support chat (when signed in) or our Discord support server to make a request. We may need to verify that the request comes from the Discord account involved."
    ]
  },
  {
    id: "third",
    title: "Third-party services",
    body: [
      "Discord, Twitch, Google, YouTube, TikTok, Kick and Tebex are independent services. Their sites, APIs and checkout flows are governed by their terms and privacy policies. BalticM is not responsible for those third-party services."
    ]
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: [
      "We may update this Privacy Policy as the product or the law changes. The updated text will be published at https://bot.balticm.eu/privacy. Continued use of Control Center after a change means you accept the revised policy."
    ]
  },
  {
    id: "contact",
    title: "Contact",
    body: [
      "For privacy questions use BalticM Support inside Control Center (Support chat after Discord login) or join the BalticM Discord support server. We do not publish a separate support email for this product."
    ]
  }
];

const TERMS_SECTIONS = [
  {
    id: "accept",
    title: "Acceptance of terms",
    body: [
      "These Terms of Service govern use of BalticM Bot and the BalticM Control Center at https://bot.balticm.eu. By signing in, installing the bot, connecting a streaming account, or using the dashboard you agree to these terms. If you do not agree, do not use the service."
    ]
  },
  {
    id: "service",
    title: "Service description",
    body: [
      "BalticM provides a Discord bot and a web Control Center to help communities manage servers (including modules such as tickets, moderation, announcements, giveaways, reaction roles, voice rooms, music, streamers and related settings). Features depend on bot installation, your Discord permissions, server configuration and Premium where applicable."
    ]
  },
  {
    id: "discord-int",
    title: "Discord server integrations",
    body: [
      "You are responsible for having authority to add the bot and to manage the Discord servers you select in Control Center. Server owners and staff remain responsible for Discord community rules, member data they process, and how they use bot features (including announcements, DMs, moderation and tickets)."
    ]
  },
  {
    id: "streaming-int",
    title: "Streaming platform integrations",
    body: [
      "Optional Twitch, YouTube, TikTok and Kick connections are provided so you can verify channels and announce live streams on Discord. You must only connect accounts you are allowed to use. We may suspend an integration that fails provider rules, appears fraudulent, or is used to spam or impersonate."
    ]
  },
  {
    id: "responsibilities",
    title: "User responsibilities",
    body: [
      "Keep your Discord account secure. Do not share session cookies or try to access another user’s Control Center. Configure the bot lawfully and in line with Discord’s Terms of Service and Community Guidelines. Do not use BalticM to harass people, evade platform bans, or send unsolicited bulk messages beyond what Discord and the product allow."
    ]
  },
  {
    id: "aup",
    title: "Acceptable use",
    body: [
      "You may not reverse engineer, overload or probe the service in a way that harms availability, bypass authorization, upload malware, or use the bot to violate applicable law. We may rate-limit or block abusive traffic."
    ]
  },
  {
    id: "premium",
    title: "Subscriptions / Premium",
    body: [
      "VIP / Premium is sold per Discord server for a stated period (currently via Tebex checkout). Payment is processed by Tebex, not as a bank transfer to a published BalticM company registry. Benefits apply to the selected server after payment is confirmed. We may change prices or included features with notice in Control Center. Refunds, if any, follow the payment provider’s and our published checkout practices—not unlimited guarantees."
    ]
  },
  {
    id: "third-terms",
    title: "Third-party platforms",
    body: [
      "Discord, streaming platforms and Tebex are not operated by BalticM. Outages, API changes, policy enforcement or account bans on those platforms can affect BalticM features. You must comply with each platform’s terms."
    ]
  },
  {
    id: "availability",
    title: "Availability and service changes",
    body: [
      "We aim for reliable uptime but do not guarantee uninterrupted service. We may add, change or retire modules, APIs or integrations. Bot Status in Control Center is informational, not a contractual SLA."
    ]
  },
  {
    id: "suspension",
    title: "Account / integration suspension for abuse",
    body: [
      "We may suspend Control Center access, bot features or streaming connections if we reasonably believe they are used for abuse, fraud, security attacks, or serious violations of these terms or third-party rules."
    ]
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: [
      "The service is provided as available. To the fullest extent permitted by law, BalticM and Baltic Mayhem are not liable for indirect, incidental or consequential damages, lost profits, or data loss arising from use of the bot, Control Center, third-party platforms or Premium. Our total liability for a claim relating to the service is limited to the amount you paid us for Premium for the affected server in the three months before the claim, or zero if you paid nothing. Some jurisdictions do not allow certain limitations; in those places our liability is limited to the minimum required by law. Nothing in these terms excludes liability that cannot be excluded by law."
    ]
  },
  {
    id: "termination",
    title: "Termination / disconnection",
    body: [
      "You may stop using the service, kick the bot from a server, disconnect streaming accounts, or log out at any time. We may stop providing the service or an integration with reasonable notice where practical, or immediately for abuse or legal risk."
    ]
  },
  {
    id: "changes-terms",
    title: "Changes to terms",
    body: [
      "We may update these terms. The current version is published at https://bot.balticm.eu/terms. Continued use after an update constitutes acceptance of the new terms."
    ]
  },
  {
    id: "contact-terms",
    title: "Contact / support",
    body: [
      "Support is provided through Control Center Support chat after Discord login, and through the BalticM Discord support server. These channels are the product’s support mechanism; we do not list a separate support email here."
    ]
  }
];

export function legalDocumentMeta(page) {
  if (page === "Terms") {
    return {
      page: "Terms",
      title: "Terms of Service",
      lead: "Rules for using BalticM Bot and Control Center. These terms are written for a community Discord product; they are not a substitute for professional legal advice.",
      updated: "30 September 2026",
      sections: TERMS_SECTIONS
    };
  }
  return {
    page: "Privacy",
    title: "Privacy Policy",
    lead: "How BalticM Bot and Control Center handle information when you sign in with Discord, manage servers, contact support, buy Premium, or connect streaming accounts.",
    updated: "30 September 2026",
    sections: PRIVACY_SECTIONS
  };
}

export function LegalContent({ page, compact = false, onOpenPrivacy, onOpenTerms }) {
  const doc = legalDocumentMeta(page);
  const privacyClick = onOpenPrivacy
    ? (e) => { e.preventDefault(); onOpenPrivacy(); }
    : undefined;
  const termsClick = onOpenTerms
    ? (e) => { e.preventDefault(); onOpenTerms(); }
    : undefined;
  return (
    <div className={compact ? "legalContent legalContentCompact" : "legalContent"}>
      {!compact && (
        <header className="legalHead">
          <span className="eyebrow">LEGAL</span>
          <h2>{doc.title}</h2>
          <p>{doc.lead}</p>
          <small>Last updated {doc.updated}</small>
        </header>
      )}
      {compact && (
        <p className="legalLead">
          {doc.lead}
          <small>Last updated {doc.updated}</small>
        </p>
      )}
      {doc.sections.map(section => (
        <section key={section.id} className="legalSection" id={section.id}>
          <h3>{section.title}</h3>
          {section.body.map((p, i) => <p key={i}>{p}</p>)}
        </section>
      ))}
      <p className="legalSupport">
        Support:{" "}
        <a href={SUPPORT_DISCORD_URL} target="_blank" rel="noreferrer">Discord support server</a>
        {" · "}
        <a href="/privacy" onClick={privacyClick}>Privacy Policy</a>
        {" · "}
        <a href="/terms" onClick={termsClick}>Terms of Service</a>
      </p>
    </div>
  );
}

export function LegalModal({ page, onClose, onOpenPrivacy, onOpenTerms }) {
  const doc = legalDocumentMeta(page);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div
      className="legalModalBackdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="legalModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="legalModalHead">
          <div>
            <span className="eyebrow">LEGAL</span>
            <h3 id="legal-modal-title">{doc.title}</h3>
          </div>
          <button type="button" className="settingsClose" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="legalModalBody">
          <LegalContent
            page={page}
            compact
            onOpenPrivacy={onOpenPrivacy}
            onOpenTerms={onOpenTerms}
          />
        </div>
      </div>
    </div>
  );
}

export default function LegalPages({ page }) {
  return (
    <article className="workspace panel legalPage">
      <LegalContent page={page} />
    </article>
  );
}
