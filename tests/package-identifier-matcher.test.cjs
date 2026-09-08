const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
vm.runInNewContext(fs.readFileSync('js/services/package-identifier-matcher.js', 'utf8'), { window });
const match = window.MkitePackageIdentifierMatcher.matchPackageIdentifier;
const row = trackingNumber => ({ trackingNumber });

test('exact matching wins over contained candidates and trims boundary whitespace', () => {
  const item = row('875539379028'), candidates = [row('539379028'), item];
  for (const scan of ['875539379028', ' 875539379028 ']) {
    const result = match(scan, candidates); assert.equal(result.type, 'EXACT'); assert.equal(result.package, item);
  }
});
test('contained matching requires the complete stored identifier', () => {
  const item = row('875539379028');
  assert.equal(match('ABC875539379028XYZ', [item]).type, 'CONTAINED_SINGLE');
  assert.equal(match('539379028', [item]).type, 'NOT_FOUND');
  assert.equal(match('539379028', [item, row('539379028')]).type, 'EXACT');
  assert.equal(match('875539379028 ABC/123', [item, row('ABC/123')]).type, 'CONTAINED_MULTIPLE');
});
test('opaque identifiers preserve punctuation, internal whitespace and case by default', () => {
  for (const value of ['ABC/123', 'A@B044', 'SKU-01_ABC', '123/456@XYZ', 'ABC/123@B044', 'A.B#C+D', 'A B']) {
    const item = row(value);
    assert.equal(match(value, [item]).type, 'EXACT');
    assert.equal(match(`XX${value}YY`, [item]).type, 'CONTAINED_SINGLE');
    assert.equal(match(value.replace(/[^a-z0-9]/gi, ''), [item]).type, 'NOT_FOUND');
  }
  assert.equal(match('abc/123', [row('ABC/123')]).type, 'NOT_FOUND');
});
test('empty values and duplicate exact identities cannot select a package', () => {
  assert.equal(match('anything', []).type, 'NOT_FOUND');
  assert.equal(match('anything', [row('')]).type, 'NOT_FOUND');
  assert.equal(match('  ', [row('')]).type, 'NOT_FOUND');
  assert.equal(match('ABC', [row('ABC'), row('ABC')]).type, 'CONTAINED_MULTIPLE');
});
