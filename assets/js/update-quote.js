#!/usr/bin/env node
/**
 * update-quote.js
 * Inserts / replaces a quote card between markers in README.md
 * Markers: <!--STARTS_HERE_QUOTE_CARD--> and <!--ENDS_HERE_QUOTE_CARD-->
 * Deterministic daily selection based on date in chosen timezone (env QUOTE_TZ, default UTC).
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../');
const README_PATH = path.join(REPO_ROOT, 'README.md');
const QUOTES_PATH = path.join(REPO_ROOT, 'quotes.json');

const START_MARK = '<!--STARTS_HERE_QUOTE_CARD-->';
const END_MARK = '<!--ENDS_HERE_QUOTE_CARD-->';

function loadQuotes() {
  if (!fs.existsSync(QUOTES_PATH)) throw new Error('Missing quotes.json at repo root.');
  const data = JSON.parse(fs.readFileSync(QUOTES_PATH, 'utf8'));
  if (!Array.isArray(data) || data.length === 0) throw new Error('quotes.json must be a non-empty array.');
  return data;
}

function getLocalDate(tz) {
  // Build date components for given timezone w/out external deps
  const now = new Date();
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = fmt.formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    return `${parts.year}-${parts.month}-${parts.day}`; // YYYY-MM-DD
  } catch (e) {
    return now.toISOString().slice(0,10); // fallback UTC
  }
}

function todayIndex(len, tz) {
  const key = getLocalDate(tz);
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash |= 0; // force 32-bit
  }
  return Math.abs(hash) % len;
}

function escapeMd(s) {
  return s.replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
}

function buildCard(q) {
  const quote = escapeMd(q.quote.trim());
  const author = escapeMd(q.author.trim());
  return `\n${START_MARK}\n> “${quote}”  \n> — ${author}\n${END_MARK}\n`;
}

function insertOrReplace(readme, card) {
  const regex = new RegExp(`${START_MARK}[\s\S]*?${END_MARK}`);
  if (regex.test(readme)) return readme.replace(regex, card.trim());
  const headingRegex = /##\s+💬\s+Random Dev Quote/;
  if (headingRegex.test(readme)) return readme.replace(headingRegex, m => `${m}\n\n${card.trim()}`);
  const endIdx = readme.indexOf('<!-- END OF PROFILE README -->');
  if (endIdx !== -1) return readme.slice(0, endIdx) + card + readme.slice(endIdx);
  return readme + '\n' + card;
}

function main() {
  const tz = process.env.QUOTE_TZ || 'UTC';
  const quotes = loadQuotes();
  const idx = todayIndex(quotes.length, tz);
  const card = buildCard(quotes[idx]);
  let readme = fs.readFileSync(README_PATH, 'utf8');
  const updated = insertOrReplace(readme, card);
  if (updated !== readme) {
    fs.writeFileSync(README_PATH, updated, 'utf8');
    console.log(`Updated quote (index ${idx}) for ${tz} date.`);
  } else {
    console.log('No change applied (markers not found or identical content).');
  }
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e); process.exit(1); }
}
