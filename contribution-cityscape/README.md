# Contribution Cityscape

Contribution Cityscape is a plain Node.js + vanilla Three.js project that fetches **GitHub contribution data** and renders it as an interactive 3D bar-chart skyline.

It is an exploratory, configurable way to view pull requests, reviews, review comments, and commits over time.

## What it measures

This model intentionally includes:
- Pull Requests (P)
- PR Reviews (R)
- Review comments (RC)
- Commits (C, with cap + decay)

And intentionally excludes:
- Issues

## Scoring formula

For each day:

```txt
T = (Wp × P) + (Wr × R) + (Wrc × RC) + (Wc × decay(C))
```

Default weights and behavior:
- `Wp = 10`
- `Wr = 8`
- `Wc = 3`
- `Wrc = 0.5`
- `daily commit cap = 25`
- default decay curve = `sqrt`

Decay curves:
- `sqrt` (recommended): `sqrt(min(c, cap))`
- `log` (stricter): `log2(min(c, cap) + 1)`
- `linear` (no squash incentive): `min(c, cap)`

Configuration:
- The default review states are `APPROVED` and `CHANGES_REQUESTED`; adjust `reviewStatesCounted` in `config.json` to match the review practices being explored.
- Each review comment can contribute an adjustable bonus, allowing detailed review feedback to be represented separately from the submitted review count.
- Self-reviews are excluded (`review author !== PR author`).
- All weighting/decay is applied client-side, so sliders reshape the skyline instantly without re-fetching.

## Setup

```bash
cd contribution-cityscape
npm install
```

Copy environment template and add your token:

```bash
cp .env.example .env
```

Set `GITHUB_TOKEN` in `.env`.

Then fetch contribution data:

```bash
node fetch-data.js --users=login1,login2 --from=2026-01-01 --to=2026-08-24
```

Optional arguments:
- `--from=YYYY-MM-DD` (default: 365 days before today)
- `--to=YYYY-MM-DD` (default: today)
- `--out=path` (default: `data/contributions.json`)

## GitHub API limitation (important)

GitHub GraphQL contribution buckets are limited to `maxRepositories: 100` per user per date window. If someone contributed across more than 100 repositories in a window, low-volume repositories can be omitted. This is a known API limitation.

## Run locally

Serve the **repository root** (not only `public/`), because `public/app.js` fetches `../config.json` and `../data/*.json`:

```bash
npx http-server . -p 8080
```

Open:

```txt
http://localhost:8080/public/
```

(From project root, `npm run serve` does this for you.)

## Using the visualizer

- **X axis**: ISO week index
- **Z axis**: day of week (Mon → Sun)
- **Bar height**: daily total score `T`
- **Overall score**: sum of the displayed user's daily scores for the loaded range
- **Bar color**: dominant weighted category for that day
  - Blue: PR-dominant
  - Purple: Review-dominant
  - Green: Commit-dominant

Controls:
- Weight sliders for PR / Review / Review-comment bonus / Commit
- Commit decay selector (`sqrt`, `log`, `linear`)
- Daily commit cap slider
- User dropdown for switching loaded users
- JSON upload to load fetched datasets
- Manual entry panel to approximate `{P,R,C}` from profile percentages when only aggregate profile data is available

Manual entry note: percentages do not have to sum to 100; the remainder is treated as excluded Issues share.

## Customizing further

- **Default model config**: `config.json`
- **Scoring logic**: `public/app.js` (`decay()` and `computeScore()`)
- **Fetch/aggregation logic**: `fetch-data.js` (range chunking, GraphQL fetch, per-day aggregation)

## Scope

This project is for interest and experimentation with configurable contribution metrics. Scores are dependent on the selected inputs and settings.
