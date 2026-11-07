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

## What runs automatically

- **Every weekday at 15:53 Sri Lanka time** (after the market closes), closing prices are fetched from the CSE website and the site is rebuilt.
- **Whenever you upload a file**, it's checked and the site is rebuilt.
- **You get an email from GitHub** when a run "fails". That happens when:
  - **a file was rejected** (for example, broken JSON or a ticker that doesn't match the filename). The site keeps showing the previous valid version of that company;
  - **a file was accepted with warnings** (a section is missing or has the wrong shape). That section shows "Not available";
  - **the CSE price feed couldn't be reached.** The site keeps the last known prices and shows how old they are.

  Open the run on the **Actions** tab and click **build** to see the details. The site is still published in every one of these cases.

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
| `.github/workflows/site.yml` | The automatic schedule. |
| `prompt/analysis-prompt.md` | The prompt to paste into claude.ai. |

## Changing the site later

Ask Claude something like: "In my CSE site, change X. Here is `assets/js/company.js`." Colours are at the top of `assets/css/style.css`. Each page section is a clearly labelled block in `assets/js/company.js`.
