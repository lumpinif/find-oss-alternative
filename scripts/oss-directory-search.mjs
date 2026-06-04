#!/usr/bin/env node

import fs from "node:fs";

const DEFAULT_SOURCES = [
  "ossalt",
  "openalternative",
  "opensourcealternatives",
  "ossfind",
  "ossreplace",
];

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
  "tool",
  "tools",
  "open",
  "source",
  "alternative",
  "alternatives",
  "software",
  "saas",
]);

const SOURCE_LABELS = {
  ossalt: "OSSAlt",
  openalternative: "OpenAlternative",
  opensourcealternatives: "Open Source Alternatives",
  ossfind: "OSSFind",
  ossreplace: "ossreplace",
};

const SOURCE_PRIORITIES = {
  "ossfind-page": 1,
  "ossreplace-page": 2,
  "ossalt-search": 3,
  "opensourcealternatives-llms-full": 4,
  "openalternative-llms": 5,
};

function usage() {
  console.error(`
Usage:
  node scripts/oss-directory-search.mjs "<product or category>" [options]

Options:
  --limit <n>        Results to return. Default: 20
  --sources <list>   Comma-separated sources. Default: ${DEFAULT_SOURCES.join(",")}
  --timeout <ms>     Per-request timeout. Default: 15000
  --out <file>       Write JSON to file

Sources:
  ossalt, openalternative, opensourcealternatives, ossfind, ossreplace
`);
}

function readArgs(argv) {
  const flags = {
    limit: 20,
    sources: DEFAULT_SOURCES.join(","),
    timeout: 15000,
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

  const sources = flags.sources
    .split(",")
    .map((source) => source.trim().toLowerCase())
    .filter(Boolean);

  const unknown = sources.filter((source) => !DEFAULT_SOURCES.includes(source));
  if (unknown.length) {
    throw new Error(`Unknown source(s): ${unknown.join(", ")}`);
  }

  return {
    query,
    flags: {
      ...flags,
      limit: Math.min(Math.max(Number(flags.limit) || 20, 1), 100),
      timeout: Math.min(Math.max(Number(flags.timeout) || 15000, 1000), 60000),
      sources,
    },
  };
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function stripHtml(html) {
  return decodeEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreText(text, tokens) {
  const lower = String(text || "").toLowerCase();
  return tokens.reduce((score, token) => score + (lower.includes(token) ? 1 : 0), 0);
}

function excerpt(text, tokens, fallbackLength = 420) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const lower = clean.toLowerCase();
  const index = tokens
    .map((token) => lower.indexOf(token))
    .filter((position) => position >= 0)
    .sort((a, b) => a - b)[0];
  const start = index === undefined ? 0 : Math.max(0, index - 120);
  return clean.slice(start, start + fallbackLength).trim();
}

function normalizeUrl(rawUrl, baseUrl) {
  if (!rawUrl) return null;
  try {
    return new URL(decodeEntities(rawUrl), baseUrl).toString();
  } catch {
    return null;
  }
}

function parseLinks(html, baseUrl) {
  const links = [];
  const linkPattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkPattern.exec(html))) {
    const url = normalizeUrl(match[2], baseUrl);
    const label = stripHtml(match[3]);
    if (url && label) links.push({ url, label });
  }
  return links;
}

function parseGithubRepos(value) {
  const repos = new Map();
  const pattern = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g;
  let match;
  while ((match = pattern.exec(value))) {
    const owner = match[1];
    const repo = match[2].replace(/[).,;#?].*$/, "");
    if (!owner || !repo || repo.endsWith(".svg")) continue;
    const fullName = `${owner}/${repo}`;
    repos.set(fullName.toLowerCase(), {
      fullName,
      url: `https://github.com/${fullName}`,
    });
  }
  return [...repos.values()];
}

async function fetchText(url, timeout) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: {
      Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.8",
      "User-Agent": "find-oss-alternative-skill",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return { url, status: response.status, text };
}

function baseItem(fields) {
  return {
    sourceType: "oss-directory",
    verificationRequired: true,
    ...fields,
  };
}

function parseAlternativeTo(text) {
  const match = String(text || "").match(/alternative(?:s)? to ([^—\-.:;\n]+)/i);
  if (!match) return [];
  return match[1]
    .split(/,|\band\b/i)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

async function searchOssAlt(query, tokens, timeout) {
  const sourceUrl = `https://ossalt.com/search?q=${encodeURIComponent(query)}`;
  const { text: html, status } = await fetchText(sourceUrl, timeout);
  const links = parseLinks(html, sourceUrl);
  const candidates = [];

  let sourceRank = 0;
  for (const link of links) {
    const path = new URL(link.url).pathname;
    if (!path.startsWith("/tool/")) continue;
    if (/^(home|search|categories|about|compare)$/i.test(link.label)) continue;

    const evidenceText = `${link.label} ${stripHtml(html)}`;
    candidates.push(
      baseItem({
        sourceRank: (sourceRank += 1),
        name: link.label,
        url: link.url,
        source: "ossalt-search",
        sourceName: SOURCE_LABELS.ossalt,
        directoryUrl: sourceUrl,
        description: null,
        evidence: excerpt(evidenceText, tokens),
        alternativeTo: parseAlternativeTo(evidenceText),
        matchScore: scoreText(evidenceText, tokens) + 1,
      }),
    );
  }

  return {
    source: "ossalt",
    sourceName: SOURCE_LABELS.ossalt,
    url: sourceUrl,
    status,
    items: candidates,
  };
}

async function searchOpenAlternative(query, tokens, timeout) {
  const sourceUrl = "https://openalternative.co/llms.txt";
  const { text, status } = await fetchText(sourceUrl, timeout);
  const items = [];

  let sourceRank = 0;
  for (const line of text.split("\n")) {
    const match = line.match(/^- \[([^\]]+)]\(([^)]+)\):\s*(.+)$/);
    if (!match) continue;
    const [, name, rawUrl, description] = match;
    const document = `${name} ${description}`;
    const matchScore = scoreText(document, tokens);
    if (!matchScore) continue;

    items.push(
      baseItem({
        sourceRank: (sourceRank += 1),
        name: name.trim(),
        url: normalizeUrl(rawUrl, "https://openalternative.co/"),
        source: "openalternative-llms",
        sourceName: SOURCE_LABELS.openalternative,
        directoryUrl: sourceUrl,
        description: description.trim(),
        evidence: line.trim(),
        alternativeTo: parseAlternativeTo(description),
        matchScore,
      }),
    );
  }

  return {
    source: "openalternative",
    sourceName: SOURCE_LABELS.openalternative,
    url: sourceUrl,
    status,
    items,
  };
}

function fieldValue(block, fieldName) {
  const match = block.match(new RegExp(`^\\s{2}${fieldName}:\\s*(.*)$`, "m"));
  return match ? match[1].trim() : null;
}

function parseListValue(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function searchOpenSourceAlternatives(query, tokens, timeout) {
  const sourceUrl = "https://www.opensourcealternatives.to/llms-full.txt";
  const { text, status } = await fetchText(sourceUrl, timeout);
  const blocks = text.split(/\n- name:\s+/).slice(1).map((block) => `- name: ${block}`);
  const items = [];

  let sourceRank = 0;
  for (const block of blocks) {
    const nameMatch = block.match(/^- name:\s*(.*)$/m);
    const name = nameMatch?.[1]?.trim();
    if (!name) continue;

    const description = fieldValue(block, "description");
    const itemUrl = fieldValue(block, "item_url");
    const websiteUrl = fieldValue(block, "website_url");
    const githubRepoRaw = fieldValue(block, "github_repo");
    const githubStars = Number(fieldValue(block, "github_stars"));
    const language = fieldValue(block, "github_language");
    const categories = parseListValue(fieldValue(block, "categories"));
    const tags = parseListValue(fieldValue(block, "tags"));
    const document = [
      name,
      description,
      itemUrl,
      websiteUrl,
      githubRepoRaw,
      categories.join(" "),
      tags.join(" "),
    ].join(" ");
    const matchScore = scoreText(document, tokens);
    if (!matchScore) continue;

    const githubRepo = githubRepoRaw
      ? githubRepoRaw.startsWith("http")
        ? githubRepoRaw
        : `https://github.com/${githubRepoRaw}`
      : null;

    items.push(
      baseItem({
        sourceRank: (sourceRank += 1),
        name,
        url: githubRepo || websiteUrl || itemUrl,
        source: "opensourcealternatives-llms-full",
        sourceName: SOURCE_LABELS.opensourcealternatives,
        directoryUrl: itemUrl || sourceUrl,
        description,
        githubRepo,
        stars: Number.isFinite(githubStars) ? githubStars : null,
        language: language || null,
        categories,
        tags,
        evidence: excerpt(block, tokens),
        alternativeTo: parseAlternativeTo(document),
        matchScore,
      }),
    );
  }

  return {
    source: "opensourcealternatives",
    sourceName: SOURCE_LABELS.opensourcealternatives,
    url: sourceUrl,
    status,
    items,
  };
}

async function searchOssFind(query, tokens, timeout) {
  const slug = slugify(query);
  const sourceUrl = `https://ossfind.com/alternatives/${slug}/`;
  const { text: html, status } = await fetchText(sourceUrl, timeout);
  const clean = stripHtml(html);
  const repos = parseGithubRepos(html);
  const items = repos.map((repo, index) =>
    baseItem({
      sourceRank: index + 1,
      name: repo.fullName,
      fullName: repo.fullName,
      url: repo.url,
      source: "ossfind-page",
      sourceName: SOURCE_LABELS.ossfind,
      directoryUrl: sourceUrl,
      description: null,
      githubRepo: repo.url,
      evidence: excerpt(clean, tokens),
      alternativeTo: [query],
      matchScore: scoreText(`${repo.fullName} ${clean}`, tokens) + 1,
    }),
  );

  if (!items.length && scoreText(clean, tokens)) {
    items.push(
      baseItem({
        sourceRank: 1,
        name: `${SOURCE_LABELS.ossfind}: ${query}`,
        url: sourceUrl,
        source: "ossfind-page",
        sourceName: SOURCE_LABELS.ossfind,
        directoryUrl: sourceUrl,
        description: null,
        evidence: excerpt(clean, tokens),
        alternativeTo: [query],
        matchScore: scoreText(clean, tokens),
      }),
    );
  }

  return {
    source: "ossfind",
    sourceName: SOURCE_LABELS.ossfind,
    url: sourceUrl,
    status,
    items,
  };
}

function parseOssReplaceProjectLinks(html, sourceUrl) {
  const projects = new Map();
  for (const link of parseLinks(html, sourceUrl)) {
    const { pathname } = new URL(link.url);
    const match = pathname.match(/^\/([A-Za-z0-9_.-]+)__([A-Za-z0-9_.-]+)\/?$/);
    if (!match) continue;
    const fullName = `${match[1]}/${match[2]}`;
    projects.set(fullName.toLowerCase(), {
      fullName,
      directoryUrl: link.url,
      label: link.label,
      githubUrl: `https://github.com/${fullName}`,
    });
  }
  return [...projects.values()];
}

async function searchOssReplace(query, tokens, timeout) {
  const slug = slugify(query);
  const sourceUrl = `https://ossreplace.com/alternatives/${slug}/`;
  const { text: html, status } = await fetchText(sourceUrl, timeout);
  const clean = stripHtml(html);
  const repos = parseGithubRepos(html);
  const projectLinks = parseOssReplaceProjectLinks(html, sourceUrl);
  const items = [];

  let sourceRank = 0;
  for (const repo of repos) {
    items.push(
      baseItem({
        sourceRank: (sourceRank += 1),
        name: repo.fullName,
        fullName: repo.fullName,
        url: repo.url,
        source: "ossreplace-page",
        sourceName: SOURCE_LABELS.ossreplace,
        directoryUrl: sourceUrl,
        githubRepo: repo.url,
        description: null,
        evidence: excerpt(clean, tokens),
        alternativeTo: [query],
        matchScore: scoreText(`${repo.fullName} ${clean}`, tokens) + 1,
      }),
    );
  }

  for (const project of projectLinks) {
    items.push(
      baseItem({
        sourceRank: (sourceRank += 1),
        name: project.label || project.fullName,
        fullName: project.fullName,
        url: project.githubUrl,
        source: "ossreplace-page",
        sourceName: SOURCE_LABELS.ossreplace,
        directoryUrl: project.directoryUrl,
        githubRepo: project.githubUrl,
        description: null,
        evidence: excerpt(`${project.label} ${clean}`, tokens),
        alternativeTo: [query],
        matchScore: scoreText(`${project.fullName} ${project.label} ${clean}`, tokens) + 1,
      }),
    );
  }

  if (!items.length && scoreText(clean, tokens)) {
    items.push(
      baseItem({
        sourceRank: 1,
        name: `${SOURCE_LABELS.ossreplace}: ${query}`,
        url: sourceUrl,
        source: "ossreplace-page",
        sourceName: SOURCE_LABELS.ossreplace,
        directoryUrl: sourceUrl,
        description: null,
        evidence: excerpt(clean, tokens),
        alternativeTo: [query],
        matchScore: scoreText(clean, tokens),
      }),
    );
  }

  return {
    source: "ossreplace",
    sourceName: SOURCE_LABELS.ossreplace,
    url: sourceUrl,
    status,
    items,
  };
}

async function runSource(source, query, tokens, timeout) {
  if (source === "ossalt") return searchOssAlt(query, tokens, timeout);
  if (source === "openalternative") return searchOpenAlternative(query, tokens, timeout);
  if (source === "opensourcealternatives") {
    return searchOpenSourceAlternatives(query, tokens, timeout);
  }
  if (source === "ossfind") return searchOssFind(query, tokens, timeout);
  if (source === "ossreplace") return searchOssReplace(query, tokens, timeout);
  throw new Error(`Unsupported source: ${source}`);
}

function dedupeAndRank(items, limit) {
  const byKey = new Map();
  for (const item of items) {
    const key = String(item.githubRepo || item.url || item.name).toLowerCase();
    const existing = byKey.get(key);
    if (!existing || item.matchScore > existing.matchScore) {
      byKey.set(key, item);
    }
  }

  return [...byKey.values()]
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      const priorityA = SOURCE_PRIORITIES[a.source] || 99;
      const priorityB = SOURCE_PRIORITIES[b.source] || 99;
      if (priorityA !== priorityB) return priorityA - priorityB;
      if ((a.sourceRank || 9999) !== (b.sourceRank || 9999)) {
        return (a.sourceRank || 9999) - (b.sourceRank || 9999);
      }
      return String(a.name).localeCompare(String(b.name));
    })
    .slice(0, limit)
    .map((item, index) => ({
      rank: index + 1,
      ...item,
    }));
}

async function main() {
  const { query, flags } = readArgs(process.argv.slice(2));
  const tokens = tokenize(query);
  const sourceResults = await Promise.all(
    flags.sources.map(async (source) => {
      try {
        return await runSource(source, query, tokens, flags.timeout);
      } catch (error) {
        return {
          source,
          sourceName: SOURCE_LABELS[source] || source,
          url: null,
          status: null,
          error: error.message,
          items: [],
        };
      }
    }),
  );

  const warnings = sourceResults
    .filter((result) => result.error)
    .map((result) => `${result.sourceName}: ${result.error}`);
  const items = dedupeAndRank(
    sourceResults.flatMap((result) => result.items),
    flags.limit,
  );

  const result = {
    source: "oss-directory-search",
    query,
    generatedAt: new Date().toISOString(),
    note:
      "Directory results are candidate seeds only. Verify GitHub repository, license, maintenance, and code evidence before using or borrowing.",
    sources: sourceResults.map((result) => ({
      source: result.source,
      name: result.sourceName,
      url: result.url,
      status: result.status,
      itemCount: result.items.length,
      error: result.error || null,
    })),
    warnings,
    items,
  };

  if (!sourceResults.some((result) => !result.error)) {
    throw new Error(`All directory sources failed: ${warnings.join("; ")}`);
  }

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
