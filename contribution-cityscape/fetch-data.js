import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import config from "./config.json" with { type: "json" };

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

const query = `
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      pullRequestContributionsByRepository(maxRepositories: 100) {
        contributions(first: 100) {
          nodes { occurredAt }
        }
      }
      pullRequestReviewContributionsByRepository(maxRepositories: 100) {
        contributions(first: 100) {
          nodes {
            occurredAt
            pullRequestReview {
              state
              author { login }
              pullRequest { author { login } }
              comments { totalCount }
            }
          }
        }
      }
      commitContributionsByRepository(maxRepositories: 100) {
        contributions(first: 100) {
          nodes { occurredAt commitCount }
        }
      }
    }
  }
}
`;

function parseArgs(argv) {
  const args = {};
  for (const part of argv) {
    if (!part.startsWith("--")) continue;
    const eq = part.indexOf("=");
    if (eq === -1) {
      args[part.slice(2)] = "";
      continue;
    }
    args[part.slice(2, eq)] = part.slice(eq + 1);
  }
  return args;
}

function usage() {
  return "Usage: node fetch-data.js --users=login1,login2 [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--out=data/contributions.json]";
}

function parseDate(value, label) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${label} date: ${value}`);
  }
  return parsed;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function toStartOfDayIso(date) {
  return `${formatDate(date)}T00:00:00.000Z`;
}

function toEndOfDayIso(date) {
  return `${formatDate(date)}T23:59:59.999Z`;
}

function splitIntoYearChunks(fromDate, toDate) {
  const chunks = [];
  const cursor = new Date(fromDate);

  while (cursor <= toDate) {
    const end = new Date(cursor);
    end.setUTCDate(end.getUTCDate() + 364);
    if (end > toDate) end.setTime(toDate.getTime());

    chunks.push({
      from: new Date(cursor),
      to: new Date(end)
    });

    cursor.setTime(end.getTime() + 86400000);
  }

  return chunks;
}

function ensureDay(days, key) {
  if (!days[key]) {
    days[key] = { P: 0, R: 0, RC: 0, C: 0 };
  }
  return days[key];
}

async function fetchChunk(login, fromIso, toIso, token) {
  const res = await fetch(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `bearer ${token}`
    },
    body: JSON.stringify({
      query,
      variables: { login, from: fromIso, to: toIso }
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub GraphQL request failed (${res.status}): ${body}`);
  }

  const payload = await res.json();
  if (payload.errors) {
    throw new Error(`GitHub GraphQL errors: ${JSON.stringify(payload.errors)}`);
  }

  if (!payload.data?.user) {
    throw new Error(`No such GitHub user: ${login}`);
  }

  return payload.data.user.contributionsCollection;
}

function aggregateChunk(days, collection, countedReviewStates, excludeSelfReviews) {
  for (const repoBucket of collection.pullRequestContributionsByRepository ?? []) {
    for (const node of repoBucket?.contributions?.nodes ?? []) {
      if (!node?.occurredAt) continue;
      const dayKey = node.occurredAt.slice(0, 10);
      ensureDay(days, dayKey).P += 1;
    }
  }

  for (const repoBucket of collection.pullRequestReviewContributionsByRepository ?? []) {
    for (const node of repoBucket?.contributions?.nodes ?? []) {
      if (!node?.occurredAt) continue;
      const review = node.pullRequestReview;
      const state = review?.state;
      if (!countedReviewStates.has(state)) continue;

      const reviewAuthor = review?.author?.login ?? null;
      const prAuthor = review?.pullRequest?.author?.login ?? null;
      if (excludeSelfReviews && reviewAuthor && prAuthor && reviewAuthor === prAuthor) {
        continue;
      }

      const dayKey = node.occurredAt.slice(0, 10);
      const day = ensureDay(days, dayKey);
      day.R += 1;
      day.RC += Number(review?.comments?.totalCount ?? 0);
    }
  }

  for (const repoBucket of collection.commitContributionsByRepository ?? []) {
    for (const node of repoBucket?.contributions?.nodes ?? []) {
      if (!node?.occurredAt) continue;
      const dayKey = node.occurredAt.slice(0, 10);
      ensureDay(days, dayKey).C += Number(node.commitCount ?? 0);
    }
  }
}

function sortDays(days) {
  return Object.fromEntries(
    Object.entries(days).sort(([a], [b]) => a.localeCompare(b))
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const usersArg = args.users?.trim();

  if (!usersArg) {
    console.error(usage());
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("Missing GITHUB_TOKEN. Copy .env.example to .env and set GITHUB_TOKEN before running.");
    process.exit(1);
  }

  const today = new Date();
  const defaultTo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const defaultFrom = new Date(defaultTo);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 365);

  const fromDate = parseDate(args.from, "from") ?? defaultFrom;
  const toDate = parseDate(args.to, "to") ?? defaultTo;
  if (fromDate > toDate) {
    throw new Error("--from cannot be later than --to");
  }

  const outPath = args.out?.trim() || "data/contributions.json";
  const users = usersArg.split(",").map((u) => u.trim()).filter(Boolean);
  if (users.length === 0) {
    console.error(usage());
    process.exit(1);
  }

  const reviewStatesCounted = new Set(config.reviewStatesCounted ?? ["APPROVED", "CHANGES_REQUESTED"]);
  const excludeSelfReviews = Boolean(config.excludeSelfReviews);
  const chunks = splitIntoYearChunks(fromDate, toDate);

  const output = {};

  for (const login of users) {
    console.log(`Fetching ${login}...`);
    const days = {};

    for (const chunk of chunks) {
      const collection = await fetchChunk(
        login,
        toStartOfDayIso(chunk.from),
        toEndOfDayIso(chunk.to),
        token
      );

      // GitHub's GraphQL API limits this dataset to maxRepositories: 100 per window.
      // Users active across 100+ repositories in a period may have low-volume repos omitted.
      // Each repository bucket here also requests first:100 contribution nodes, which can
      // undercount extremely high-volume single-repository periods.
      aggregateChunk(days, collection, reviewStatesCounted, excludeSelfReviews);
    }

    const sortedDays = sortDays(days);
    output[login] = {
      range: { from: formatDate(fromDate), to: formatDate(toDate) },
      days: sortedDays
    };

    console.log(`-> ${Object.keys(sortedDays).length} active days found for ${login}`);
  }

  const resolvedOut = path.resolve(process.cwd(), outPath);
  await fs.mkdir(path.dirname(resolvedOut), { recursive: true });
  await fs.writeFile(resolvedOut, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${resolvedOut}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
