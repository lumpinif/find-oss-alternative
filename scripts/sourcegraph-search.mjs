#!/usr/bin/env node

import fs from "node:fs";

function usage() {
  console.error(`
Usage:
  node scripts/sourcegraph-search.mjs "<sourcegraph query>" [options]

Options:
  --timeout <ms>    Abort after this many milliseconds. Default: 15000
  --out <file>      Write JSON to file
`);
}

function readArgs(argv) {
  const flags = { timeout: 15000 };
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

function parseSse(text) {
  const events = [];
  let current = { event: null, data: [] };

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("event: ")) {
      current.event = line.slice(7).trim();
      continue;
    }
    if (line.startsWith("data: ")) {
      current.data.push(line.slice(6));
      continue;
    }
    if (line.trim() === "" && current.event) {
      const raw = current.data.join("\n");
      try {
        events.push({ event: current.event, data: raw ? JSON.parse(raw) : null });
      } catch {
        events.push({ event: current.event, data: raw });
      }
      current = { event: null, data: [] };
    }
  }

  return events;
}

async function main() {
  const { query, flags } = readArgs(process.argv.slice(2));
  const url = new URL("https://sourcegraph.com/.api/search/stream");
  url.searchParams.set("q", query);
  url.searchParams.set("v", "V3");

  const response = await fetch(url, {
    headers: { Accept: "text/event-stream" },
    signal: AbortSignal.timeout(Number(flags.timeout) || 15000),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Sourcegraph search failed with ${response.status}: ${bodyText}`);
  }

  const events = parseSse(bodyText);
  const matches = [];
  const progress = [];
  const filters = [];

  for (const event of events) {
    if (event.event === "matches" && Array.isArray(event.data)) {
      for (const match of event.data) {
        matches.push({
          type: match.type,
          repository: match.repository,
          path: match.path,
          url: match.url,
          repoStars: match.repoStars,
          language: match.language,
          lineMatches: (match.lineMatches || []).map((line) => ({
            lineNumber: line.lineNumber,
            line: line.line,
          })),
        });
      }
    }
    if (event.event === "progress") progress.push(event.data);
    if (event.event === "filters") filters.push(event.data);
  }

  const result = {
    source: "sourcegraph-stream",
    query,
    generatedAt: new Date().toISOString(),
    matches,
    progress,
    filters,
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
