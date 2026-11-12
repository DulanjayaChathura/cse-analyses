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
