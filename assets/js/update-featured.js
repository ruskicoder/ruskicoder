#!/usr/bin/env node
/**
 * update-featured.js
 * Populates the Featured Projects table between <!--START_FEATURED_PROJECTS--> and <!--END_FEATURED_PROJECTS-->
 * Selection heuristic:
 *  1. Exclude forks, archived, and repo named like username (profile repo)
 *  2. Score = stars*3 + forks*2 + (recent push recency bonus) + (language weight)
 *  3. Pick top N (default 3) unique languages if possible
 *  4. Provide concise description fallback if missing
 * Requires: GITHUB_TOKEN (fine-grained read-only public repos is enough).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const USER = 'ruskicoder';
// Resolve README relative to repo root (two levels up from assets/js)
const README_PATH = path.join(__dirname, '..', '..', 'README.md');
const START = '<!--START_FEATURED_PROJECTS-->';
const END = '<!--END_FEATURED_PROJECTS-->';
const COUNT = parseInt(process.env.FEATURED_COUNT || '3', 10);

function ghRequest(pathname) {
  const token = process.env.GITHUB_TOKEN;
  const opts = {
    hostname: 'api.github.com',
    path: pathname,
    headers: {
      'User-Agent': 'featured-projects-script',
      'Accept': 'application/vnd.github+json'
    }
  };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  return new Promise((resolve, reject) => {
    https.get(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        } else {
          reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0,200)}`));
        }
      });
    }).on('error', reject);
  });
}

function daysSince(dateStr) {
  return (Date.now() - new Date(dateStr).getTime()) / 86400000;
}

function score(repo) {
  const star = repo.stargazers_count || 0;
  const fork = repo.forks_count || 0;
  const rec = Math.max(0, 90 - daysSince(repo.pushed_at)); // recent activity bonus up to ~90 days
  const langWeight = repo.language ? 5 : 0;
  return star * 3 + fork * 2 + rec + langWeight;
}

function formatRow(r) {
  const desc = (r.description || 'No description provided').replace(/\|/g, '—').slice(0, 80);
  const tech = [r.language || ''].filter(Boolean).join(', ');
  const nameLink = `[${r.name}](${r.html_url})`;
  return `| ${nameLink} | ${desc} | ${tech || '—'} |`;
}

async function buildTable() {
  const repos = await ghRequest(`/users/${USER}/repos?per_page=100&sort=updated`);
  const filtered = repos.filter(r => !r.fork && !r.archived && r.name.toLowerCase() !== USER.toLowerCase());
  filtered.sort((a,b) => score(b) - score(a));
  const picked = [];
  for (const r of filtered) {
    if (picked.length >= COUNT) break;
    picked.push(r);
  }
  if (!picked.length) {
    return `${START}\n| Project | Description | Tech |\n|---------|-------------|------|\n| _No qualifying repositories yet_ | Create or update public repos to populate this section | — |\n${END}`;
  }
  const header = '| Project | Description | Tech |\n|---------|-------------|------|';
  const rows = picked.map(formatRow).join('\n');
  return `${START}\n${header}\n${rows}\n${END}`;
}

function replaceSection(readme, table) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, r => `\\${r}`);
  const re = new RegExp(`${esc(START)}[\r\n]*[\s\S]*?${esc(END)}`);
  if (re.test(readme)) return readme.replace(re, table);
  // Fallback manual slice replacement if both markers present but regex failed (line ending anomalies)
  const startIdx = readme.indexOf(START);
  const endIdx = readme.indexOf(END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const afterEnd = endIdx + END.length;
    return readme.slice(0, startIdx) + table + readme.slice(afterEnd);
  }
  return readme;
}

async function main() {
  try {
    if (!fs.existsSync(README_PATH)) {
      console.error('README.md not found at path:', README_PATH);
      process.exit(1);
    }
    const table = await buildTable();
    const readme = fs.readFileSync(README_PATH, 'utf8');
    const updated = replaceSection(readme, table);
    if (updated !== readme) {
      fs.writeFileSync(README_PATH, updated, 'utf8');
      console.log('Featured projects updated');
    } else {
      console.log('No changes');
    }
  } catch (e) {
    console.error('Failed to update featured projects:', e.message);
    process.exit(1);
  }
}

if (require.main === module) main();
