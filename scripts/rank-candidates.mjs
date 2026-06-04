#!/usr/bin/env node

import fs from "node:fs";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "you",
  "your",
  "from",
  "into",
  "are",
  "app",
  "apps",
  "list",
  "awesome",
]);

function usage() {
  console.error(`
Usage:
  node scripts/rank-candidates.mjs --query "<intent keywords>" --input <json> [options]

Options:
  --fetch-readme     Fetch README text from GitHub for repo candidates
  --out <file>       Write JSON to file
`);
}

function readArgs(argv) {
  const flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fetch-readme") {
      flags.fetchReadme = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    flags[key] = value;
    i += 1;
  }

  if (!flags.query || !flags.input) {
    usage();
    process.exit(2);
  }

  return flags;
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function extractCandidates(input) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input.items)) return input.items;
  if (Array.isArray(input.candidates)) return input.candidates;
  throw new Error("Input JSON must be an array or contain an items/candidates array.");
}

function getFullName(candidate) {
  return candidate.fullName || candidate.full_name || candidate.name;
}

async function fetchReadme(fullName) {
  if (!fullName || !fullName.includes("/")) return "";
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "find-oss-alternative-skill",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const metaResponse = await fetch(`https://api.github.com/repos/${fullName}/readme`, {
    headers,
  });
  if (!metaResponse.ok) return "";
  const meta = await metaResponse.json();
  if (!meta.download_url) return "";
  const readmeResponse = await fetch(meta.download_url);
  if (!readmeResponse.ok) return "";
  return readmeResponse.text();
}

function documentText(candidate, readmeText = "") {
  return [
    candidate.fullName,
    candidate.full_name,
    candidate.githubRepo,
    candidate.directoryUrl,
    candidate.name,
    candidate.description,
    candidate.language,
    candidate.license,
    candidate.license?.spdx_id,
    candidate.evidence,
    ...(candidate.topics || []),
    ...(candidate.tags || []),
    ...(candidate.categories || []),
    ...(candidate.alternativeTo || []),
    readmeText.slice(0, 20000),
  ]
    .filter(Boolean)
    .join(" ");
}

function bm25(queryTokens, docs) {
  const k1 = 1.5;
  const b = 0.75;
  const docTokens = docs.map((doc) => tokenize(doc.text));
  const avgdl = docTokens.reduce((sum, tokens) => sum + tokens.length, 0) / docTokens.length;
  const df = new Map();

  for (const tokens of docTokens) {
    for (const token of new Set(tokens)) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }

  const totalDocs = docs.length;
  return docs.map((doc, index) => {
    const tokens = docTokens[index];
    const tf = new Map();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    let score = 0;
    for (const queryToken of queryTokens) {
      const frequency = tf.get(queryToken) || 0;
      if (!frequency) continue;
      const docFrequency = df.get(queryToken) || 0;
      const idf = Math.log(1 + (totalDocs - docFrequency + 0.5) / (docFrequency + 0.5));
      const denominator = frequency + k1 * (1 - b + b * (tokens.length / avgdl));
      score += idf * ((frequency * (k1 + 1)) / denominator);
    }

    return { ...doc, bm25Score: score };
  });
}

async function main() {
  const flags = readArgs(process.argv.slice(2));
  const input = JSON.parse(fs.readFileSync(flags.input, "utf8"));
  const candidates = extractCandidates(input);
  const queryTokens = tokenize(flags.query);

  const docs = [];
  for (const candidate of candidates) {
    const fullName = getFullName(candidate);
    const readmeText = flags.fetchReadme ? await fetchReadme(fullName) : "";
    docs.push({
      candidate,
      fullName,
      text: documentText(candidate, readmeText),
      readmeFetched: Boolean(readmeText),
    });
  }

  const rankedRaw = bm25(queryTokens, docs).sort((a, b) => b.bm25Score - a.bm25Score);
  const maxScore = Math.max(...rankedRaw.map((item) => item.bm25Score), 0.0001);
  const ranked = rankedRaw.map((item, index) => ({
    rank: index + 1,
    fullName: item.fullName,
    url: item.candidate.url || item.candidate.html_url,
    directoryUrl: item.candidate.directoryUrl || null,
    sourceType: item.candidate.sourceType || null,
    description: item.candidate.description || null,
    stars: item.candidate.stars ?? item.candidate.stargazers_count ?? null,
    forks: item.candidate.forks ?? item.candidate.forks_count ?? null,
    license:
      item.candidate.license && typeof item.candidate.license === "object"
        ? item.candidate.license.spdx_id
        : item.candidate.license ?? null,
    topics: item.candidate.topics || [],
    tags: item.candidate.tags || [],
    categories: item.candidate.categories || [],
    alternativeTo: item.candidate.alternativeTo || [],
    verificationRequired: item.candidate.verificationRequired || false,
    pushedAt: item.candidate.pushedAt || item.candidate.pushed_at || null,
    bm25Score: Number(item.bm25Score.toFixed(3)),
    fitPercent: Math.round((item.bm25Score / maxScore) * 100),
    readmeFetched: item.readmeFetched,
  }));

  const result = {
    source: "local-bm25-rerank",
    query: flags.query,
    generatedAt: new Date().toISOString(),
    ranked,
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
