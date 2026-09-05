const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('build output includes the server entrypoint', () => {
  const entryPoint = path.join(__dirname, '..', 'build', 'bin', 'server.js');
  assert.ok(fs.existsSync(entryPoint), 'Expected compiled server entrypoint at build/bin/server.js');
});
