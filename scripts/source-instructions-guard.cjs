#!/usr/bin/env node
// Structural checks only: these do not prove a legal interpretation or its applicability.
const fs = require('fs');
const { createHash } = require('crypto');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const DISPOSITIONS = new Set(['rewrite', 'router', 'reference', 'retired', 'history']);
const PRIMARY_HOSTS = new Set(['selling-guide.fanniemae.com', 'www.consumerfinance.gov', 'angeloakms.com']);

function validateSources(data, sourceMap, now = new Date()) {
  const errors = [], sources = new Map(), ids = new Set();
  for (const s of data.sources || []) {
    if (sources.has(s.id)) errors.push(`duplicate source ${s.id}`);
    sources.set(s.id, s);
    try {
      const u = new URL(s.url);
      if (u.protocol !== 'https:' || !PRIMARY_HOSTS.has(u.hostname) || u.username || u.password)
        errors.push(`source ${s.id}: publisher URL is not approved`);
    } catch { errors.push(`source ${s.id}: invalid URL`); }
    if (!s.publisher || !['law', 'program', 'lender'].includes(s.kind))
      errors.push(`source ${s.id}: publisher and source kind required`);
  }
  for (const c of data.claims || []) {
    if (ids.has(c.id)) errors.push(`duplicate claim ${c.id}`);
    ids.add(c.id);
    for (const key of ['id', 'locator', 'applicability', 'statement'])
      if (typeof c[key] !== 'string' || !c[key].trim()) errors.push(`claim ${c.id}: missing ${key}`);
    if (c.versionStatus === 'dated') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.effectiveDate || '') || !Number.isFinite(Date.parse(c.effectiveDate)))
        errors.push(`claim ${c.id}: invalid effective date`);
    } else if (c.versionStatus !== 'transaction-version-unresolved' || c.effectiveDate !== null || !c.versionNote) {
      errors.push(`claim ${c.id}: missing effective version record`);
    }
    if (!sources.has(c.source)) errors.push(`claim ${c.id}: unknown primary source`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.verifiedOn || '') ||
        !Number.isFinite(Date.parse(c.verifiedOn)) || Date.parse(c.verifiedOn) > now.getTime())
      errors.push(`claim ${c.id}: invalid/future verification date`);
    if (!sourceMap.includes(c.statement)) errors.push(`claim ${c.id}: source-map statement drift`);
  }
  if (!ids.size) errors.push('no source readings registered');
  return errors;
}

function validateDocuments(register, files, read) {
  const errors = [], rows = new Map();
  for (const row of register.documents || []) {
    if (rows.has(row.path)) errors.push(`duplicate document ${row.path}`);
    rows.set(row.path, row);
    if (!DISPOSITIONS.has(row.disposition) || !row.reason || !/^[a-f0-9]{40}$/.test(row.originalBlob || ''))
      errors.push(`${row.path}: incomplete disposition/recovery record`);
  }
  for (const file of files) if (!rows.has(file)) errors.push(`${file}: unclassified Markdown`);
  for (const file of rows.keys()) if (!files.includes(file)) errors.push(`${file}: registered file missing`);
  const excluded = [...rows.values()].filter(r => ['retired', 'history'].includes(r.disposition));
  const ignore = read('.ignore');
  for (const row of excluded) {
    if (!ignore.split('\n').includes('/' + row.path)) errors.push(`${row.path}: not excluded from ordinary searches`);
    if (row.disposition === 'retired') {
      const text = read(row.path);
      if (!text.startsWith('<!-- homiquity-doc: retired -->') || text.split('\n').length > 9 ||
          createHash('sha256').update(text).digest('hex') !== row.retiredSha256)
        errors.push(`${row.path}: retired policy has been reintroduced`);
    }
  }
  const entry = new Set([...(register.activeInstructions || []), ...[...rows.values()]
    .filter(r => r.disposition === 'router').map(r => r.path), 'docs/fannie-mae/AGENTS.md', 'README.md', 'knowledge-base/README.md']);
  if (!entry.has('AGENTS.md') || !(register.activeInstructions || []).includes('CLAUDE.md'))
    errors.push('shared entry points missing');
  for (const file of entry) {
    if (!rows.has(file) || excluded.some(r => r.path === file)) {
      errors.push(`${file}: invalid active instruction`); continue;
    }
    const text = read(file);
    if (text.startsWith('---\n') && !/^---\n[\s\S]*?\n---\n/.test(text))
      errors.push(`${file}: unclosed task frontmatter`);
    if (file !== 'AGENTS.md' && (rows.get(file).disposition === 'router' || file.endsWith('CLAUDE.md')) &&
        !text.includes('AGENTS.md')) errors.push(`${file}: shared entry point missing`);
    for (const row of excluded) {
      // Full paths and Markdown links, not common basenames such as README.md.
      if (text.includes(row.path) || (!['README.md', 'SKILL.md', 'LEDGER.md'].includes(path.basename(row.path)) && text.includes(path.basename(row.path))) || [...text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)].some(m =>
        path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])) === row.path))
        errors.push(`${file}: loads or names retired/history authority ${row.path}`);
    }
    for (const m of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      if (/^(https?:|mailto:)/.test(m[1])) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1]));
      if (target.endsWith('.md') && !rows.has(target)) errors.push(`${file}: broken instruction link ${target}`);
    }
  }
  return errors;
}

function run(root = ROOT) {
  try {
    const read = p => fs.readFileSync(path.join(root, p), 'utf8');
    const register = JSON.parse(read('knowledge-base/document-register.json'));
    const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard',
      '*.md', '*.MD', '*.mdx'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean))];
    const errors = validateDocuments(register, files, read);
    errors.push(...validateSources(JSON.parse(read('knowledge-base/compliance/source-claims.json')),
      read('knowledge-base/compliance/SELLING_GUIDE_DECISION_RULE.md')));
    return { errors, count: files.length };
  } catch (e) { return { errors: [e.message], count: 0 }; }
}
function main() {
  const result = run();
  for (const error of result.errors) console.error(`FAIL ${error}`);
  console.log(`source-instructions: ${result.count} Markdown dispositions checked; ` +
    `${result.errors.length} structural problem(s). Source meaning/applicability requires review.`);
  process.exitCode = result.errors.length ? 1 : 0;
}
module.exports = { run, main, validateSources, validateDocuments };
if (require.main === module) main();
