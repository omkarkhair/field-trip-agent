#!/usr/bin/env node
// Pre-work check for the Field Trip Agent workshop.
// Usage: npm run check
//
// Written in plain Node (no bash/jq) so it runs the same on macOS, Linux, and Windows.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

let failures = 0;
const pass = (msg) => console.log(`${green('✔')} ${msg}`);
const warn = (msg, hint) => console.log(`${yellow('!')} ${msg}${hint ? `\n    → ${hint}` : ''}`);
const fail = (msg, hint) => {
  failures++;
  console.log(`${red('✘')} ${msg}${hint ? `\n    → ${hint}` : ''}`);
};

console.log('\nField Trip Agent — pre-work check\n');

// 1. Node version (the pinned Flue dependency tree excludes Node 23)
{
  const [major, minor] = process.versions.node.split('.').map(Number);
  const supported = (major === 22 && minor >= 19) || major > 24 || (major === 24 && minor >= 11);
  if (supported) pass(`Node ${process.versions.node}`);
  else {
    fail(
      `Node ${process.versions.node} is unsupported`,
      'Install Node 22.19+ LTS or 24.11+: https://nodejs.org',
    );
  }
}

// 2. Dependencies installed at the pinned versions
{
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const wanted = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!existsSync(new URL('../node_modules', import.meta.url))) {
    fail('Dependencies not installed', 'Run: npm ci');
  } else {
    const wrong = [];
    for (const [name, version] of Object.entries(wanted)) {
      try {
        // Read the file directly: many packages don't export ./package.json.
        const pkgPath = new URL(`../node_modules/${name}/package.json`, import.meta.url);
        const installed = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
        if (installed !== version) wrong.push(`${name} (have ${installed}, want ${version})`);
      } catch {
        wrong.push(`${name} (missing)`);
      }
    }
    if (wrong.length === 0) pass(`Dependencies installed (${Object.keys(wanted).length} packages)`);
    else fail(`Dependency mismatch: ${wrong.join(', ')}`, 'Run: npm ci');
  }
}

// 3. Cloudflare login
{
  try {
    const out = execFileSync('npx', ['--no-install', 'wrangler', 'whoami', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32',
    });
    const who = JSON.parse(out);
    if (!who.loggedIn) throw new Error('not logged in');
    const accounts = who.accounts ?? [];
    pass(`Logged in to Cloudflare as ${who.email ?? 'API token user'} (${accounts.length} account${accounts.length === 1 ? '' : 's'})`);
    if (accounts.length > 1 && !process.env.CLOUDFLARE_ACCOUNT_ID) {
      warn(
        'You have access to several Cloudflare accounts',
        'Set CLOUDFLARE_ACCOUNT_ID to the one you want to deploy to, or pick it when wrangler asks',
      );
    }
    const scopes = (who.tokenPermissions ?? []).join(' ');
    if (scopes && !/\bai\b/.test(scopes)) {
      warn('Your token may be missing the Workers AI scope', 'Re-run: npx wrangler login');
    }
  } catch {
    fail('Not logged in to Cloudflare', 'Run: npx wrangler login');
  }
}

// 4. No secrets tracked by accident
if (existsSync(new URL('../.dev.vars', import.meta.url))) {
  warn('.dev.vars exists', 'Fine for local dev — it is gitignored. Workers AI needs no keys, though.');
}

console.log('');
if (failures === 0) {
  console.log(green('All good. Next: npm run dev, then curl http://localhost:5173/api/ping'));
} else {
  console.log(red(`${failures} check(s) failed. Fix the items above and re-run: npm run check`));
  process.exit(1);
}
