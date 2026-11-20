/*
 * /summary listener for the CSE share analyses site (Cloudflare Worker).
 *
 * A second Telegram bot ("helper bot") is an admin of the channel and sends every
 * new channel post here (a Telegram webhook). When the post is a summary command
 * ("/summary", "/summary12", "/summary-12", "/summary 12"), this worker:
 *   1. starts the "Collect broker messages" workflow on GitHub (broker.yml),
 *   2. starts the "Broker summary on demand" Claude task (its API trigger),
 *   3. replies in the channel that the summary has started.
 * For "/update CODE", "/add CODE" and "/redo CODE" it starts the "Research request"
 * workflow on GitHub (research-request.yml), which checks the command, downloads the
 * reports and starts the "Research on request" Claude task; that workflow replies in
 * the channel itself (within about a minute). This worker replies only if GitHub
 * can't be reached.
 * A plain reply (e.g. just "update all", or no text at all) to one of the "New report
 * on the CSE" announcements (report_watch.py) is read the same way: every ticker code
 * in parentheses in the announcement is pulled out and turned into one /update (or
 * /add, /redo, /redo … full if the reply says so) for all of them. A reply that says
 * anything else (a real note) is left alone — use an explicit /update CODE1 CODE2 ...
 * for that.
 * Every other post is ignored. The main bot keeps collecting posts as before.
 *
 * Stars: the site's ☆ buttons read and save the starred companies here
 * (GET /stars, POST /stars {"ticker": "DIAL.N0000", "starred": true}), kept in the
 * STARS KV namespace. There's no key: only pages on the site's own address are
 * answered (SITE_ORIGIN), so anyone who opens the site can star or unstar.
 *
 * Settings (Cloudflare → the worker → Settings → Variables and Secrets):
 *   BOT_TOKEN       secret  the helper bot's token from @BotFather
 *   CHANNEL         text    optional: the channel id (-100…) or @username, to accept
 *                           commands from that channel only (the helper bot should
 *                           only be in your channel anyway)
 *   WEBHOOK_SECRET  secret  any long random text you make up
 *   GITHUB_TOKEN    secret  GitHub fine-grained token: cse-analyses only, Actions read and write
 *   ROUTINE_URL     secret  the Claude task's Fire URL
 *   ROUTINE_TOKEN   secret  the Claude task's API token (sk-ant-oat01-…)
 *   REPO            text    optional, default DulanjayaChathura/cse-analyses
 *   STARS           KV      binding to a KV namespace (e.g. "cse-stars") for the starred companies
 *   SITE_ORIGIN     text    optional, default https://dulanjayachathura.github.io
 *
 * After saving the settings, open https://<this worker's address>/setup?key=<WEBHOOK_SECRET>
 * once in a browser. It connects the helper bot to this worker.
 */
const COMMAND = /^\/summary(?:[-\s]?(\d{1,2}))?(?:@\w+)?(?:\s+(redo))?$/i;
const RESEARCH = /^\/(update|add|redo)(?:@\w+)?\s+\S/i;
const TICKER_IN_PARENS = /\(([A-Z][A-Z0-9&]{0,9}\.[A-Z]\d{4})\)/g;
const REPLY_ACK = /^(all|please|pls|ok(ay)?|yes|go(\s+ahead)?|do\s*it|k|full)?$/i;
const REPLY_PREFIX = "⏳"; // the collector skips posts starting with this
const ALERT = /^\/(alert|unalert|alerts)(?:@\w+)?(?:\s|$)/i;
const COMMANDS = /^\/commands?(?:@\w+)?\s*$/i;

// The reply to /command: every command the channel understands. Keep it in step with
// listener/README.md when a command is added or changed.
const COMMAND_LIST = [
  "ℹ️ <b>Commands you can post here</b>",
  "",
  "<b>Broker summary</b> (uses Claude)",
  "/summary: summarise the broker posts since the last summary",
  "/summary12: the same, filed under the 12th (any day number)",
  "/summary redo: rewrite that day's summary from the same posts",
  "",
  "<b>Company research</b> (uses Claude; several codes at once is still one run)",
  "/update DIAL: update from a new report (reports downloaded from the CSE)",
  "/add COMB: first analysis of a new company (/add COMB 2: last 2 annual reports)",
  "/redo DIAL: redo the valuation from the saved figures, no reports",
  "/redo DIAL full: rebuild everything from the reports",
  "Add a note after the codes, e.g. /redo DIAL use 13% discount rate",
  "Reply \"ok\" (or \"redo full\") to a <i>New report on the CSE</i> message to update every company in it",
  "",
  "<b>Price alerts</b> (no Claude)",
  "/alert DIAL below 45: alert when the price falls to Rs 45 or lower",
  "/alert COMB above 220 take profit: alert when it rises to Rs 220 (text after the price is a note)",
  "/alert DIAL 45: below or above, worked out from today's price",
  "/unalert DIAL: remove Dialog's alerts (/unalert DIAL below: just that one)",
  "/alerts: list your alerts with today's prices",
  "Buy and strong-buy prices of watch-list companies alert automatically.",
  "",
  "/command: this list",
].join("\n");
const STAR_TICKER = /^[A-Z][A-Z0-9&]{0,9}\.[A-Z]\d{4}$/;
const MAX_STARS = 200;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/setup") {
      if (url.searchParams.get("key") !== env.WEBHOOK_SECRET) return new Response("Wrong key.", { status: 403 });
      const res = await telegram(env, "setWebhook", {
        url: `${url.origin}/telegram`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["channel_post"],
        drop_pending_updates: true,
      });
      const info = await telegram(env, "getWebhookInfo", {});
      return json({ setWebhook: res, webhook: info });
    }

    if (url.pathname === "/stars") return stars(request, env);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("CSE /summary listener is running.");
    }

    if (request.method !== "POST" || url.pathname !== "/telegram") return new Response("Not found", { status: 404 });
    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });

    const update = await request.json().catch(() => ({}));
    const post = update.channel_post;
    if (!post || !sameChat(post.chat || {}, env.CHANNEL)) return new Response("ignored");
    const text = (post.text || "").trim();

    if (COMMANDS.test(text)) {
      ctx.waitUntil(telegram(env, "sendMessage", {
        chat_id: post.chat.id, text: COMMAND_LIST, parse_mode: "HTML",
        reply_to_message_id: post.message_id, disable_notification: true,
      }));
      return new Response("ok");
    }
    if (ALERT.test(text)) {
      ctx.waitUntil(dispatch(env, post, "alert-command.yml", text, "alert"));
      return new Response("ok");
    }

    const replyText = replyCommand(post);
    if (replyText) {
      ctx.waitUntil(research(env, post, replyText));
      return new Response("ok");
    }
    if (RESEARCH.test(text)) {
      ctx.waitUntil(research(env, post, text));
      return new Response("ok");
    }
    const m = text.match(COMMAND);
    if (!m) return new Response("ignored");

    // Answer Telegram at once; do the work in the background.
    ctx.waitUntil(start(env, post, text, m[1] ? Number(m[1]) : null, Boolean(m[2])));
    return new Response("ok");
  },
};

async function start(env, post, text, day, redo) {
  const repo = env.REPO || "DulanjayaChathura/cse-analyses";
  const results = [];

  // 1. Collect the latest posts (including this command).
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/broker.yml/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "cse-summary-listener",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main" }),
    });
    results.push(r.ok ? "collection started" : `collection failed (GitHub ${r.status})`);
  } catch (e) {
    results.push("collection failed (GitHub unreachable)");
  }

  // 2. Start the Claude task.
  let session = null;
  try {
    const r = await fetch(env.ROUTINE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.ROUTINE_TOKEN}`,
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: `Command ${text} (message ${post.message_id}).` }),
    });
    if (r.ok) {
      const body = await r.json().catch(() => ({}));
      session = body.claude_code_session_url || null;
      results.push("Claude started");
    } else {
      results.push(`Claude failed to start (${r.status})`);
    }
  } catch (e) {
    results.push("Claude failed to start (unreachable)");
  }

  // 3. Tell the channel.
  const target = day ? `for the ${ordinal(day)}` : "for today";
  const ok = results.every((x) => !x.includes("failed"));
  const msg = ok
    ? `${REPLY_PREFIX} Summary ${redo ? "rewrite" : ""} started ${target}`.replace("  ", " ") + `. It will appear on the site and here in about 10–30 minutes.`
    : `${REPLY_PREFIX} Summary ${target}: ${results.join("; ")}.`;
  await telegram(env, "sendMessage", {
    chat_id: post.chat.id,
    text: msg,
    reply_to_message_id: post.message_id,
    disable_notification: true,
    ...(session ? { reply_markup: { inline_keyboard: [[{ text: "Watch the run", url: session }]] } } : {}),
  });
}

async function research(env, post, text) {
  const repo = env.REPO || "DulanjayaChathura/cse-analyses";
  let problem = null;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/research-request.yml/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "cse-summary-listener",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main", inputs: { text: text.slice(0, 500), message_id: String(post.message_id) } }),
    });
    if (!r.ok) problem = `GitHub ${r.status}`;
  } catch (e) {
    problem = "GitHub unreachable";
  }
  if (problem) {
    await telegram(env, "sendMessage", {
      chat_id: post.chat.id,
      text: `⚠️ Couldn't start the request (${problem}). Nothing was started; try again later.`,
      reply_to_message_id: post.message_id,
      disable_notification: true,
    });
  }
}

// Starts a GitHub workflow that takes the command text; tells the channel if it can't.
async function dispatch(env, post, workflow, text, what) {
  const repo = env.REPO || "DulanjayaChathura/cse-analyses";
  let problem = null;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "cse-summary-listener",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main", inputs: { text: text.slice(0, 500), message_id: String(post.message_id) } }),
    });
    if (!r.ok) problem = `GitHub ${r.status}`;
  } catch (e) {
    problem = "GitHub unreachable";
  }
  if (problem) {
    await telegram(env, "sendMessage", {
      chat_id: post.chat.id,
      text: `⚠️ Couldn't start the ${what} command (${problem}). Nothing changed; try again later.`,
      reply_to_message_id: post.message_id,
      disable_notification: true,
    });
  }
}

// A plain reply ("update all", "", "redo full", ...) to a message listing ticker codes
// in parentheses — e.g. a "New report on the CSE" announcement — becomes one /update
// (or /add, /redo) for every code in it. Returns null if this isn't that: no codes in
// the original message, or the reply says something more than a short acknowledgement
// (a real note needs an explicit /update CODE1 CODE2 ... instead, so it isn't guessed at).
function replyCommand(post) {
  const orig = post.reply_to_message;
  if (!orig || !orig.text) return null;
  const codes = [...new Set([...orig.text.matchAll(TICKER_IN_PARENS)].map((m) => m[1]))];
  if (!codes.length) return null;

  let rest = (post.text || "").trim().replace(/^(please|pls)\s+/i, "");
  let verb = "update";
  const vm = rest.match(/^\/?(update|add|redo)\b\s*(.*)$/i);
  if (vm) {
    verb = vm[1].toLowerCase();
    rest = vm[2].trim();
  }
  if (!REPLY_ACK.test(rest)) return null;

  const full = verb === "redo" && /\bfull\b/i.test(post.text || "") ? " full" : "";
  return `/${verb} ${codes.join(" ")}${full}`;
}

function sameChat(chat, wanted) {
  wanted = String(wanted || "").trim();
  if (!wanted) return chat.type === "channel";
  return String(chat.id) === wanted || ("@" + (chat.username || "")).toLowerCase() === wanted.toLowerCase();
}

function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  return n + s;
}

async function telegram(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({ ok: false, status: r.status }));
}

function json(obj) {
  return new Response(JSON.stringify(obj, null, 2), { headers: { "Content-Type": "application/json" } });
}

/* ---------- Stars (the site's ☆ buttons) ---------- */
async function stars(request, env) {
  const site = (env.SITE_ORIGIN || "https://dulanjayachathura.github.io").replace(/\/$/, "");
  const origin = request.headers.get("Origin") || "";
  const cors = {
    "Access-Control-Allow-Origin": site,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (origin !== site) return reply({ error: "Only the site can use this." }, 403);
  if (!env.STARS) return reply({ error: "STARS isn't set up on the worker." }, 503);

  const load = async () => {
    const list = await env.STARS.get("stars", "json");
    return Array.isArray(list) ? list.filter((t) => STAR_TICKER.test(t)) : [];
  };
  if (request.method === "GET") return reply({ stars: await load() });
  if (request.method !== "POST") return reply({ error: "GET or POST only." }, 405);

  const body = await request.json().catch(() => ({}));
  const ticker = String(body.ticker || "").toUpperCase();
  if (!STAR_TICKER.test(ticker) || typeof body.starred !== "boolean") return reply({ error: "Send {ticker, starred}." }, 400);
  let list = await load();
  if (body.starred && !list.includes(ticker)) {
    if (list.length >= MAX_STARS) return reply({ error: `At most ${MAX_STARS} stars.` }, 400);
    list.push(ticker);
  } else if (!body.starred) {
    list = list.filter((t) => t !== ticker);
  }
  list.sort();
  await env.STARS.put("stars", JSON.stringify(list));
  return reply({ stars: list });
}
