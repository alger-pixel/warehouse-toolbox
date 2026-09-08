(function (window) {
  'use strict';
  const trimIdentifier = value => String(value == null ? '' : value).trim();
  function matchPackageIdentifier(scanValue, candidates, options = {}) {
    const normalize = options.normalize || trimIdentifier;
    const identifier = options.identifier || (item => item.trackingNumber);
    const scan = normalize(scanValue);
    if (!scan) return { type: 'NOT_FOUND', candidates: [] };
    const entries = candidates.map(item => ({ item, value: normalize(identifier(item)) })).filter(entry => entry.value);
    const exact = entries.filter(entry => entry.value === scan).map(entry => entry.item);
    if (exact.length === 1) return { type: 'EXACT', package: exact[0], candidates: exact };
    // Duplicate exact identities are ambiguous too; never choose one implicitly.
    if (exact.length > 1) return { type: 'CONTAINED_MULTIPLE', packages: exact, candidates: exact };
    const contained = entries.filter(entry => scan.includes(entry.value)).map(entry => entry.item);
    if (contained.length === 1) return { type: 'CONTAINED_SINGLE', package: contained[0], candidates: contained };
    if (contained.length > 1) return { type: 'CONTAINED_MULTIPLE', packages: contained, candidates: contained };
    return { type: 'NOT_FOUND', candidates: [] };
  }
  window.MkitePackageIdentifierMatcher = Object.freeze({ matchPackageIdentifier });
}(window));
