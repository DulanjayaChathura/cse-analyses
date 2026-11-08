# CSE share analyses

A small website that shows your Colombo Stock Exchange share analyses as charts and tables.
You make each analysis in claude.ai, drop the JSON file into GitHub, and the site updates itself.
It's free: GitHub hosts it and runs the daily price update.

**Note:** the repository is public, so anyone who finds it or the site can read the analyses.

## One-time setup (about 15 minutes)

1. **Create a GitHub account** at github.com, if you don't have one.
2. **Create a repository.** Click **New repository**, name it (e.g. `cse-analyses`), choose **Public**, and click **Create repository**.
3. **Upload the files.** On the new repository page, click **uploading an existing file**. Drag in *everything inside* this folder, including the hidden `.github` folder. Then click **Commit changes**.
   - The hidden folder: on Windows, turn on *View → Show → Hidden items*. On a Mac, press **Cmd + Shift + .** in Finder.
   - If the `.github` folder won't upload by dragging, create the file by hand instead: click **Add file → Create new file**, type `.github/workflows/site.yml` as the name, paste in the contents of that file, and commit.
4. **Turn on GitHub Pages.** Go to **Settings → Pages**. Under *Build and deployment*, set **Source** to **GitHub Actions**.
5. **Run it once.** Go to the **Actions** tab, click **Build and publish site**, then **Run workflow**. After about a minute the run turns green.
6. **Open your site.** The address appears in **Settings → Pages**. It looks like `https://<your-username>.github.io/cse-analyses/`. Share that link with the people you choose.

## Adding or updating a company

1. In claude.ai, upload the annual report and latest quarterly report PDFs.
2. Paste the prompt from `prompt/analysis-prompt.md`, after changing the company name and code on its first line.
3. Download the JSON file Claude creates. It's named like `DIAL.N0000.json`.
4. In GitHub, open the `data` folder, click **Add file → Upload files**, drag the JSON in, and click **Commit changes**.
   To update a company, upload the new file with the same name. It replaces the old one, and GitHub keeps the old version in its history.
5. The site updates about a minute later. The first time you add a company, its official name, logo and price are fetched from the CSE.

## Updating a company with a new report (research records)

Report PDFs stay on your laptop in `OneDrive\Documents\cse-research\<company>\`. The repository keeps everything learned from them:

```
research/DIAL.N0000/
  record.json   ← saved figures per period (with sources), valuation inputs and reasons, open questions, change log
  history/      ← every earlier analysis, archived before it's replaced
```

**To update:**
1. Save the new PDF in the company's laptop folder.
2. Tell Claude in a chat with the Claude desktop app open, e.g. "New report for Dialog".
3. Claude reads the saved record and **only the new report**, updates the analysis and the record, archives the old analysis, and pushes the changes straight to `main`.
4. The push rebuilds the site automatically, including the **What changed** section and the fair-value history.

The procedure and the standard analysis brief are in `CLAUDE.md`; the record format is in `docs/research-format.md`. For a **new company**, create its folder in `cse-research`, add its reports, and ask for a first analysis.

## What runs automatically

- **Every weekday at 15:53 Sri Lanka time** (after the market closes), closing prices are fetched from the CSE website and the site is rebuilt.
- **Whenever you upload a file**, it's checked and the site is rebuilt.
- **You get an email from GitHub** when a run "fails". That happens when:
  - **a file was rejected** (for example, broken JSON or a ticker that doesn't match the filename). The site keeps showing the previous valid version of that company;
  - **a file was accepted with warnings** (a section is missing or has the wrong shape). That section shows "Not available";
  - **the CSE price feed couldn't be reached.** The site keeps the last known prices and shows how old they are.

  Open the run on the **Actions** tab and click **build** to see the details. The site is still published in every one of these cases.

## Telegram price alerts

The site can post to a Telegram channel when a share reaches a price you choose. It checks about every 30 minutes during trading (roughly 09:37–14:07 Sri Lanka time, Monday to Friday; GitHub sometimes starts these late), and once more after the close.

### One-time setup (about 10 minutes)

1. **Create the channel.** In Telegram, tap the pencil icon, choose **New Channel**, give it a name, and pick **Private** (invite-only) or **Public**.
2. **Create the bot.** Open a chat with **@BotFather**, send `/newbot`, choose a name and a username ending in `bot`. BotFather replies with a **token** (looks like `123456:ABC-...`). Keep it secret.
3. **Make the bot an admin of the channel.** Open the channel, then **Administrators → Add Admin**, search for your bot's username, and allow **Post Messages**.
4. **Save the token in GitHub.** In your repository, go to **Settings → Secrets and variables → Actions → New repository secret**. Name it `TELEGRAM_BOT_TOKEN` and paste the token.
5. **Find the channel ID.**
   - For a **public** channel, it's simply `@yourchannelname`.
   - For a **private** channel, post any message in the channel. Then go to **Actions → Test Telegram → Run workflow**, open the run, and copy the number shown (it starts with `-100`).
     Run logs in a public repository can be seen by anyone. The channel ID alone doesn't let anyone read or post in your channel, but you can delete the run afterwards if you prefer.
6. **Save the channel ID** as another secret named `TELEGRAM_CHAT_ID`.
7. **Test it.** Run **Actions → Test Telegram → Run workflow** again. A test message should appear in the channel.

### New research notifications

Whenever new or updated research is published, the build posts one message to the same Telegram channel. It lists each company, its fair value (old → new for updates), its buy price, and how far today's price is from fair value, with a link to the page. Research from the last 7 days that hasn't been announced is included; nothing is announced twice. Like the price alerts, this never creates a commit.

### Setting your targets

Edit `alerts.json` in the repository (open it on GitHub and click the pencil icon):

```json
{
  "targets": [
    { "symbol": "DIAL.N0000", "direction": "below", "price": 35, "note": "first buying batch" },
    { "symbol": "DIAL.N0000", "direction": "above", "price": 60, "note": "take profit" },
    { "symbol": "JKH.X0000",  "direction": "below", "price": 15 }
  ]
}
```

- `direction` is `"below"` (alert when the price is at or below) or `"above"` (at or above).
- `symbol` can be any share code, voting (`.N0000`) or non-voting (`.X0000`).
- `note` is optional and appears in the message.
- The file starts with one example target; change or delete it.

**Each target is sent once.** When several targets for the same company are reached at the same check, they arrive in one message. To get alerted again, **change the target** (e.g. Rs 35 → Rs 34.50) or remove it and add it back. To re-arm **all** targets, delete the caches named `alert-state-…` under **Actions → Caches**.

Sending an alert never creates a commit. Which alerts were sent is remembered in GitHub's Actions cache, and each company page shows the status under **Your alerts**. If GitHub ever loses that cache, which is rare, an alert you already received may be sent once more.

If a message can't be sent (Telegram down, wrong token or channel), it's retried at the next check, and GitHub emails you about the failed run.

## Checking a file before uploading (optional)

If you have Python installed: `python scripts/validate.py path/to/FILE.json`

## Good to know

- **The CSE data feed is unofficial.** It's the same feed the cse.lk website uses, and it can change without notice. If it stops working, the site falls back to the price inside each analysis file and labels it as such.
- **GitHub pauses scheduled runs** in repositories with no activity for 60 days. The daily price commits normally count as activity. If prices stop updating, open the **Actions** tab: if there's a message about the workflow being disabled, click **Enable workflow**.
- **To refresh a company's name or logo**, delete its entry in `generated/companies.json` (and its file in `generated/logos/`), then run the workflow.
- **Results-due warnings** follow CSE Listing Rule 7.4: quarterly results within 45 days of quarter-end, and within two months for the final quarter. They use the `fiscalYearEnd` in each file (`"12-31"` or `"03-31"`).
- **Format reference:** `docs/json-format.md`. **Working example:** `data/DIAL.N0000.json`.

## Folder map

| Path | What it is |
|---|---|
| `data/` | Your analysis files, one per company. This is the only folder you normally touch. |
| `generated/` | Prices, names and logos fetched from the CSE. Updated automatically; don't edit by hand. |
| `index.html`, `company.html`, `assets/` | The website (plain HTML, CSS and JavaScript, with comments). |
| `scripts/` | The data check, the site build and the CSE fetchers (Python, no extra packages). |
| `.github/workflows/site.yml` | The automatic schedule: daily prices, the after-close alert check, building the site. |
| `.github/workflows/alerts.yml` | The 30-minute alert checks during trading. |
| `.github/workflows/telegram-test.yml` | The "Test Telegram" button. |
| `alerts.json` | Your price targets. |
| `research/` | Research records and archived analyses, one folder per company (the PDFs stay on your laptop). |
| `CLAUDE.md`, `.claude/commands/update.md` | The update procedure Claude follows. |
| `prompt/analysis-prompt.md` | The prompt to paste into claude.ai. |

## Changing the site later

Ask Claude something like: "In my CSE site, change X. Here is `assets/js/company.js`." Colours are at the top of `assets/css/style.css`. Each page section is a clearly labelled block in `assets/js/company.js`.
