const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('css/in-house-tools/in-house-tools.css', 'utf8');

test('in-house workspaces map their existing hooks to approved hero images', () => {
  assert.match(css, /data-in-house-theme="receiving"[^}]*RECEVING\.png/);
  assert.match(css, /data-in-house-theme="location-move"[^}]*MOVE BY LOCATION\.png/);
  assert.match(css, /data-in-house-theme="batch-inventory"[^}]*BATCH INVENTORY\.png/);
  assert.match(css, /in-house-tool-page:has\(\.bpl-app\)[^}]*PICKING LIST\.png/);
});

test('workspace hero keeps its geometry and uses layered readable treatment', () => {
  assert.match(css, /\.in-house-tool-hero \{[^}]*min-height:210px/);
  assert.match(css, /\.in-house-tool-hero \{[^}]*border-radius:28px/);
  assert.match(css, /\.in-house-tool-hero::before \{[^}]*background-size:cover/);
  assert.match(css, /\.in-house-tool-hero::after \{[^}]*linear-gradient\(90deg/);
});
