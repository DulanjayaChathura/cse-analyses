# /summary listener: setup

Post `/summary` (or `/summary12`) in the Telegram channel and a broker summary starts
within seconds. This folder holds the small program that listens for it
(`worker.js`, a free Cloudflare Worker). It needs a second Telegram bot, because the
main bot collects posts by checking the channel and Telegram doesn't let one bot do
both. See CLAUDE.md ("Broker summary") for what the summary task does.

You need four keys. Keep each in a private note; never post them in Telegram or commit them.

## 1. Claude task token (done already)
The "Broker summary on demand (CSE site)" task's **Fire URL** and **token**
(claude.ai/code/routines → the task → API trigger).

## 2. Second Telegram bot
1. In Telegram, open **@BotFather**, send `/newbot`, and follow the questions
   (name e.g. "CSE helper", username ending in `bot`). Copy the **token** it gives you.
2. Open your channel → channel info → **Administrators** → **Add admin** → search the
   new bot's username → add it. It only needs **Post messages**; switch the rest off.

## 3. GitHub token
1. github.com → your photo → **Settings** → **Developer settings** →
   **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Name: `cse summary listener`. Expiration: 1 year (set a reminder to renew it).
3. Repository access: **Only select repositories** → `cse-analyses`.
4. Permissions → Repository permissions → **Actions: Read and write**. Nothing else.
5. **Generate token** and copy it.

## 4. Cloudflare Worker
1. Sign up at **dash.cloudflare.com** (free plan; no card needed).
2. **Workers & Pages** (under Compute) → **Create** → **Start with Hello World!** →
   name it `cse-summary` → **Deploy**.
3. **Edit code** → delete everything in `worker.js` → paste the contents of this
   folder's `worker.js` → **Deploy**.
4. Back on the worker's page → **Settings** → **Variables and Secrets** → **Add**, one at a time,
   choosing type **Secret**:
   | Name | Value |
   |---|---|
   | `BOT_TOKEN` | the second bot's token (step 2) |
   | `GITHUB_TOKEN` | the GitHub token (step 3) |
   | `ROUTINE_URL` | the Claude task's Fire URL (step 1) |
   | `ROUTINE_TOKEN` | the Claude task's token (step 1) |
   | `WEBHOOK_SECRET` | any long random text you make up, letters and numbers only (e.g. 30 characters) |

   Click **Deploy** after adding them.
5. Copy the worker's address from its page, e.g. `https://cse-summary.yourname.workers.dev`.
6. In a browser, open (with your own address and WEBHOOK_SECRET):
   `https://cse-summary.yourname.workers.dev/setup?key=YOUR_WEBHOOK_SECRET`
   The page should show `"ok": true` twice. This connects the second bot to the worker.

## 5. Test
Post `/summary` in the channel. Within a few seconds the second bot replies
"⏳ Summary started for today…" with a **Watch the run** button. The summary
appears on the site and in the channel in about 10–30 minutes.

If the reply says something failed:
- `collection failed (GitHub 401/403/404)`: the GitHub token is wrong, expired, or lacks **Actions: Read and write** on `cse-analyses`.
- `Claude failed to start (401)`: the Claude token or Fire URL is wrong; regenerate the token on the task and update `ROUTINE_TOKEN`.
- No reply at all: the second bot isn't an admin of the channel, or step 4.6 wasn't done.

## Research commands (/update, /add, /redo)
The same worker also passes these to GitHub (the "Research request" workflow), which
checks the command, downloads the reports from the CSE and starts the
"Research on request" Claude task. Replies come from your main bot within about a minute.

| Command | Does |
|---|---|
| `/update DIAL` | Update from reports published since the current analysis |
| `/add COMB` (`/add COMB 3` for the last 3 annual reports) | New company, first analysis |
| `/redo DIAL` | Redo the valuation from the saved research (no reports) |
| `/redo DIAL full` | Redo everything from the reports |

Several codes can be given in one command, space- or comma-separated (`/update DIAL COMB SAMP`);
anything after the codes is passed to Claude as a note, e.g. `/redo DIAL use 13% discount rate`.

**Replying to a "New report on the CSE" post** (the one `report_watch.py` sends, listing
each company's code in parentheses) with just a short reply — nothing at all, "update all",
"ok", or "redo full" — runs the matching command for every code in that post, with no need
to type them out. A reply that says anything else (a real note) is left alone; use an
explicit `/update CODE1 CODE2 ...` for that.

**Replying to an "Older research template" post.** `/update` and a plain `/redo` hold back a
company whose research lacks the Management and plans or Shareholders section (or the annual
report's capex, depreciation or interest paid) and ask first. Reply **full** to rebuild it from
the reports (`/redo CODE full`), or **ok** to go ahead as asked. Anything else is ignored.

One-time setup:
1. Create a Claude task "Research on request (CSE site)" with an **API** trigger
   (instructions in CLAUDE.md's "Research requests from Telegram"); copy its Fire URL and token.
2. GitHub → the `cse-analyses` repository → **Settings** → **Secrets and variables** →
   **Actions** → **New repository secret**, twice:
   `RESEARCH_ROUTINE_URL` (the Fire URL) and `RESEARCH_ROUTINE_TOKEN` (the token).
3. Cloudflare → the `cse-summary` worker → **Edit code** → replace the code with the
   latest `listener/worker.js` → **Deploy**. No new Cloudflare secrets are needed.

## Stars (the ☆ buttons on the site)
The worker also keeps the starred companies, so they're the same on every device. There's no key: only pages on the site's own address are answered, so anyone who opens the site can star or unstar. Stars only change the company list, never prices, alerts or analyses.

One-time setup in Cloudflare:
1. **Storage & Databases → KV → Create a namespace**, name it `cse-stars`.
2. Open the worker → **Settings → Bindings → Add → KV namespace**. Variable name `STARS`, namespace `cse-stars`. Save.
3. Only if your site isn't at `https://dulanjayachathura.github.io`: add a text variable `SITE_ORIGIN` with its address (no path, no trailing slash).
4. **Edit code**, paste the new `worker.js`, **Deploy**.
5. Check it: open `https://<worker address>/stars` in a browser. It should say `{"error":"Only the site can use this."}` (a direct visit isn't the site), which shows the route is live.

The site finds the worker through `App.STARS_URL` in `assets/js/common.js` (the worker's address). Leave it empty to hide the stars.

## Price alerts and the command list
The worker also handles these channel commands (no Claude involved):

| Command | What happens |
|---|---|
| `/alert DIAL below 45 [note]` | Starts the "Alert command" workflow (`alert-command.yml`), which runs `scripts/alert_command.py`: it checks the code with the CSE, sets the target in `alerts.json` (replacing the same share and direction), commits it and replies with today's price and the gap. `above` works the same; with no direction it's worked out from today's price; `under`/`over` also work. |
| `/unalert DIAL [below\|above]` | Removes the share's targets (or one direction) from `alerts.json`. |
| `/alerts` | Replies with your targets, today's prices and how far each is. |
| `/command` (or `/commands`) | The worker replies straight away with every command the channel understands (`COMMAND_LIST` in `worker.js`; keep it up to date when a command is added). |

The price checks themselves are unchanged: `alerts.yml` every 30 minutes during trading and `site.yml` after the close read `alerts.json`. After changing `worker.js`, paste it into the Cloudflare worker and deploy again.

## Portfolio (encrypted)
The worker also handles the portfolio commands (no Claude involved). Holdings are kept in `portfolio.enc.json`, encrypted (AES-256-GCM, key from your passphrase by PBKDF2-SHA256); the site's **Portfolio** page unlocks it in your browser with the same passphrase.

| Command | What happens |
|---|---|
| `/buy COCR 200 95.20 [date] [fees 213.25]` | Records a purchase. Fees default to the CSE's 1.12%. Dates: `2026-11-27`, `11/27`, `27/11`, `27`, `yesterday`; none means today. |
| `/sell DIAL 100 46 [date] [fees 52]` | Records a sale and the gain or loss against your average price. |
| `/div COMB 6.50 [xd date] [pay date]` | Only for a dividend missing from the CSE's announcements: dividends are read from them by themselves (held at the close before the XD date = yours; after 15% tax). |
| `/holdings` | Replies with what you hold, today's value and the return. |
| `/trades [CODE]` | Lists trades and dividends, numbered. |
| `/undo [number]` | Removes the last entry, or a numbered one. |

The worker seals each command (AES-256-GCM with `PORTFOLIO_LINK_KEY`) before passing it to the "Portfolio command" workflow (`portfolio-command.yml`, `scripts/portfolio_command.py`), because a workflow's inputs show in its public logs. The reply goes only to the channel. Keep the channel private: the command messages themselves stay there.

One-time setup:
1. **Choose a passphrase** (long, e.g. four random words). Nobody can recover it: if it's lost, the portfolio has to be entered again.
2. **Make a link key**: a random 32-byte key in base64. In a terminal: `openssl rand -base64 32` (or in any browser console: `btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))`).
3. GitHub → the `cse-analyses` repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, twice: `PORTFOLIO_KEY` (the passphrase) and `PORTFOLIO_LINK_KEY` (the link key).
4. Cloudflare → the `cse-summary` worker → **Settings** → **Variables and secrets** → add a **Secret** `PORTFOLIO_LINK_KEY` with the same link key.
5. **Edit code**, paste the new `worker.js`, **Deploy**.
6. Post `/buy …` for each holding (or `/holdings` to check). Open the site's Portfolio page and unlock it with the passphrase.
