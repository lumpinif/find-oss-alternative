#!/usr/bin/env node

import fs from "node:fs";

function usage() {
  console.error(`
Usage:
  node scripts/github-repo-search.mjs "<query>" [options]

Options:
  --limit <n>          Results to return. Default: 20
  --sort <field>       stars, forks, updated. Default: stars
  --order <dir>        desc or asc. Default: desc
  --fields <fields>    GitHub in: qualifier. Default: name,description,readme,topics
  --language <name>    Add language:<name>
  --topic <name>       Add topic:<name>
  --min-stars <n>      Add stars:>=n
  --pushed-after <d>   Add pushed:>=YYYY-MM-DD
  --out <file>         Write JSON to file
`);
}

function readArgs(argv) {
  const flags = {
    limit: 20,
    sort: "stars",
    order: "desc",
    fields: "name,description,readme,topics",
  };
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

function buildQuery(query, flags) {
  const parts = [query];
  if (!/\bin:/i.test(query) && flags.fields) {
    parts.push(`in:${flags.fields}`);
  }
  if (flags.language) parts.push(`language:${flags.language}`);
  if (flags.topic) parts.push(`topic:${flags.topic}`);
  if (flags["min-stars"]) parts.push(`stars:>=${flags["min-stars"]}`);
  if (flags["pushed-after"]) parts.push(`pushed:>=${flags["pushed-after"]}`);
  return parts.join(" ");
}

async function main() {
  const { query, flags } = readArgs(process.argv.slice(2));
  const qualifiedQuery = buildQuery(query, flags);
  const limit = Math.min(Math.max(Number(flags.limit) || 20, 1), 100);

  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", qualifiedQuery);
  url.searchParams.set("sort", flags.sort);
  url.searchParams.set("order", flags.order);
  url.searchParams.set("per_page", String(limit));

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "find-oss-alternative-skill",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub search failed with ${response.status}: ${bodyText}`);
  }

  const body = JSON.parse(bodyText);
  const result = {
    source: "github-repository-search",
    query,
    qualifiedQuery,
    totalCount: body.total_count,
    incompleteResults: body.incomplete_results,
    generatedAt: new Date().toISOString(),
    items: (body.items || []).map((item) => ({
      fullName: item.full_name,
      name: item.name,
      owner: item.owner?.login,
      url: item.html_url,
      description: item.description,
      stars: item.stargazers_count,
      forks: item.forks_count,
      watchers: item.watchers_count,
      language: item.language,
      topics: item.topics || [],
      license: item.license?.spdx_id ?? null,
      archived: item.archived,
      fork: item.fork,
      pushedAt: item.pushed_at,
      updatedAt: item.updated_at,
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

