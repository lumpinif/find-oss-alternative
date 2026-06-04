#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function usage() {
  console.error(`
Usage:
  node scripts/render-html-report.mjs --input <report.json> --out <report.html>
`);
}

function readArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
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
  if (!flags.input || !flags.out) {
    usage();
    process.exit(2);
  }
  return flags;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function list(items = []) {
  return `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

function renderQueryFamilies(families = {}) {
  return Object.entries(families)
    .map(
      ([name, values]) => `
        <section class="query-family">
          <h3>${esc(name)}</h3>
          <div class="chips">${(values || []).map((value) => `<span>${esc(value)}</span>`).join("")}</div>
        </section>
      `,
    )
    .join("");
}

function renderProductReference(reference) {
  if (!reference) return "";
  return `
    <section class="product-reference">
      <span class="label">Product reference</span>
      <h2><a href="${esc(reference.url)}">${esc(reference.name)}</a></h2>
      <p>${esc(reference.role || "Original product or market reference.")}</p>
    </section>
  `;
}

function renderCandidate(candidate, index) {
  const fit = Math.max(0, Math.min(Number(candidate.fit) || 0, 100));
  return `
    <article class="candidate">
      <div class="rank">${index + 1}</div>
      <div class="main">
        <div class="row">
          <h3><a href="${esc(candidate.url)}">${esc(candidate.name)}</a></h3>
          <span class="decision">${esc(candidate.decision)}</span>
        </div>
        <p>${esc(candidate.evidence)}</p>
        <div class="meta">
          <span>${esc(candidate.license || "license unknown")}</span>
          <span>${candidate.stars == null ? "stars unknown" : `${esc(candidate.stars)} stars`}</span>
          <span>${esc((candidate.platform || []).join(", ") || "platform unknown")}</span>
        </div>
        <div class="bar"><div style="width:${fit}%"></div></div>
        ${candidate.takeaways?.length ? list(candidate.takeaways) : ""}
      </div>
      <div class="fit">${fit}%</div>
    </article>
  `;
}

function renderDecision(decision = {}) {
  const rows = [
    ["Use", decision.use || []],
    ["Borrow", decision.borrow || []],
    ["Avoid", decision.avoid || []],
    ["Build New", decision.buildNew || []],
  ];
  return rows
    .map(
      ([name, values]) => `
        <section class="decision-row">
          <h3>${name}</h3>
          ${list(values)}
        </section>
      `,
    )
    .join("");
}

function renderHtml(report) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(report.intent)} - Find OSS Alternative</title>
    <style>
      :root {
        --bg: #101214;
        --surface: #181c1f;
        --surface-2: #23282c;
        --text: #f4f1e8;
        --muted: #a8b0ae;
        --green: #52d6a3;
        --amber: #f2b84b;
        --coral: #ff6b5f;
        --line: rgba(244, 241, 232, 0.12);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background:
          linear-gradient(rgba(244, 241, 232, 0.028) 1px, transparent 1px),
          linear-gradient(90deg, rgba(244, 241, 232, 0.028) 1px, transparent 1px),
          var(--bg);
        background-size: 42px 42px;
        color: var(--text);
        font-family: Arial, sans-serif;
      }
      main { max-width: 1180px; margin: 0 auto; padding: 48px 24px 80px; }
      header { margin-bottom: 38px; }
      .eyebrow { color: var(--green); font: 700 13px ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: .08em; }
      .label {
        display: block;
        color: var(--amber);
        font: 700 12px ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: .08em;
        margin-bottom: 8px;
        text-transform: uppercase;
      }
      h1 { margin: 14px 0 16px; font-size: clamp(40px, 7vw, 86px); line-height: .95; letter-spacing: 0; }
      p { color: var(--muted); font-size: 18px; line-height: 1.5; }
      a { color: inherit; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
      .query-family, .decision-row, .credit, .candidate, .product-reference {
        border: 1px solid var(--line);
        background: rgba(24, 28, 31, .94);
      }
      .query-family, .decision-row, .credit, .product-reference { padding: 20px; }
      .product-reference {
        margin-bottom: 28px;
        background: rgba(242, 184, 75, .08);
      }
      h2 { margin: 42px 0 16px; font-size: 30px; }
      h3 { margin: 0 0 12px; font-size: 18px; }
      .chips { display: flex; flex-wrap: wrap; gap: 8px; }
      .chips span {
        border: 1px solid rgba(82, 214, 163, .34);
        background: rgba(82, 214, 163, .08);
        padding: 7px 9px;
        color: var(--text);
        font-size: 13px;
      }
      .candidate {
        display: grid;
        grid-template-columns: 44px 1fr 72px;
        gap: 18px;
        align-items: start;
        padding: 18px;
        margin-bottom: 12px;
      }
      .rank, .fit {
        font: 700 18px ui-monospace, SFMono-Regular, Menlo, monospace;
        color: var(--green);
      }
      .row { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .decision {
        color: var(--bg);
        background: var(--green);
        padding: 5px 8px;
        font-size: 12px;
        font-weight: 700;
      }
      .meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; color: var(--muted); font-size: 13px; }
      .meta span { border: 1px solid var(--line); padding: 5px 7px; }
      .bar { height: 8px; background: var(--surface-2); overflow: hidden; }
      .bar div { height: 100%; background: var(--green); }
      ul { margin: 12px 0 0; padding-left: 20px; color: var(--muted); line-height: 1.5; }
      .credits { display: grid; gap: 12px; }
      .footer { margin-top: 42px; color: var(--muted); font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div class="eyebrow">Find OSS Alternative</div>
        <h1>${esc(report.intent)}</h1>
        <p>${esc(report.summary || "Open-source precedents before the agent builds.")}</p>
      </header>

      ${renderProductReference(report.productReference)}

      <h2>Query Families</h2>
      <div class="grid">${renderQueryFamilies(report.queryFamilies)}</div>

      <h2>Ranked Precedents</h2>
      ${(report.candidates || []).map(renderCandidate).join("")}

      <h2>Use / Borrow / Avoid / Build New</h2>
      <div class="grid">${renderDecision(report.decision)}</div>

      <h2>Credits & Licenses</h2>
      <div class="credits">
        ${(report.credits || [])
          .map(
            (credit) => `
              <section class="credit">
                <h3><a href="${esc(credit.url)}">${esc(credit.name)}</a></h3>
                <p>${esc(credit.credit)}</p>
                <p><strong>License:</strong> ${esc(credit.license || "unknown")}<br /><strong>Reuse:</strong> ${esc(credit.reuseGuidance || "Verify license compatibility before direct code reuse.")}</p>
              </section>
            `,
          )
          .join("")}
      </div>

      <h2>Next Implementation Constraints</h2>
      ${list(report.nextImplementationConstraints || [])}

      <div class="footer">Generated by Find OSS Alternative. Find alternatives. Credit builders. Respect licenses. Build better.</div>
    </main>
  </body>
</html>
`;
}

function main() {
  const flags = readArgs(process.argv.slice(2));
  const report = JSON.parse(fs.readFileSync(flags.input, "utf8"));
  const html = renderHtml(report);
  fs.mkdirSync(path.dirname(flags.out), { recursive: true });
  fs.writeFileSync(flags.out, html);
  console.log(flags.out);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
