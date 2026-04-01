#!/usr/bin/env node
const { execSync } = require('child_process');

const port = Number(process.env.PORT) || 4000;

try {
  const pids = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim();
  if (pids) {
    execSync(`kill -9 ${pids.split('\n').join(' ')}`);
    console.log(`Killed process(es) on port ${port}: ${pids.replace(/\n/g, ', ')}`);
  } else {
    console.log(`No process running on port ${port}.`);
  }
} catch {
  console.log(`No process running on port ${port}.`);
}
