// Prefer the matching system Electron on Arch; fall back to the npm runtime.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const major = require('electron/package.json').version.split('.')[0];
const system = process.platform === 'linux' ? `/usr/lib/electron${major}/electron` : '';
const executable = system && fs.existsSync(system) ? system : require('electron');
const child = spawn(executable, [path.join(__dirname, '..'), ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
