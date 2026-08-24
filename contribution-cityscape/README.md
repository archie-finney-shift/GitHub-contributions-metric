# Contribution Cityscape

Contribution Cityscape is a plain Node.js + vanilla Three.js project that fetches **real GitHub contribution data** and renders it as an interactive 3D bar-chart skyline.

It is designed as a fair alternative to raw contribution graphs: it emphasizes **shipped, reviewed, integrated work** over sheer commit volume.

## What it measures

This model intentionally includes:
- Pull Requests (P)
- PR Reviews (R)
- Commits (C, with cap + decay)

And intentionally excludes:
- Issues

## Scoring formula

For each day:

```txt
T = (Wp × P) + (Wr × R) + (Wc × decay(C))
```

Default weights and behavior:
- `Wp = 10`
- `Wr = 8`
- `Wc = 3`
- `daily commit cap = 25`
- default decay curve = `sqrt`

Decay curves:
- `sqrt` (recommended): `sqrt(min(c, cap))`
- `log` (stricter): `log2(min(c, cap) + 1)`
- `linear` (no squash incentive): `min(c, cap)`

Rationale:
- PRs are weighted highest to reward shipping coherent work.
- Reviews are nearly as high to reward unblocking teammates and reduce silo behavior.
- Commits are decayed so 1–2 clean commits still score well, while high-volume WIP commits do not dominate.
- Only `APPROVED` and `CHANGES_REQUESTED` PR reviews count.
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
- **Bar color**: dominant weighted category for that day
  - Blue: PR-dominant (shipper)
  - Purple: Review-dominant (reviewer)
  - Green: Commit-dominant (grinder)

Controls:
- Weight sliders for PR / Review / Commit
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

## Notes on fairness

This metric is a heuristic for surfacing collaboration patterns and starting better conversations. It is **not** an automated performance ranking system. Outliers should trigger context and discussion, not verdicts.
