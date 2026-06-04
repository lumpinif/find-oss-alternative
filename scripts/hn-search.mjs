#!/usr/bin/env node

import fs from "node:fs";

function usage() {
  console.error(`
Usage:
  node scripts/hn-search.mjs "<query>" [options]

Options:
  --limit <n>      Results to return. Default: 10
  --tags <tags>    Algolia tags. Default: story
  --out <file>     Write JSON to file
`);
}

function readArgs(argv) {
  const flags = { limit: 10, tags: "story" };
  const queryParts = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      queryParts.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    flags[key] = value;
    i += 1;
  }

  const query = queryParts.join(" ").trim();
  if (!query) {
    usage();
    process.exit(2);
  }
  return { query, flags };
}

async function main() {
  const { query, flags } = readArgs(process.argv.slice(2));
  const limit = Math.min(Math.max(Number(flags.limit) || 10, 1), 100);
  const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
  url.searchParams.set("query", query);
  url.searchParams.set("tags", flags.tags);
  url.searchParams.set("hitsPerPage", String(limit));

  const response = await fetch(url);
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`HN search failed with ${response.status}: ${bodyText}`);
  }

  const body = JSON.parse(bodyText);
  const result = {
    source: "hn-algolia",
    query,
    tags: flags.tags,
    generatedAt: new Date().toISOString(),
    items: (body.hits || []).map((hit) => ({
      title: hit.title || hit.story_title,
      url: hit.url || hit.story_url,
      author: hit.author,
      points: hit.points ?? null,
      comments: hit.num_comments ?? null,
      objectID: hit.objectID,
      createdAt: hit.created_at,
    })),
  };

  const json = JSON.stringify(result, null, 2);
  if (flags.out) {
    fs.writeFileSync(flags.out, `${json}\n`);
  } else {
    console.log(json);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

