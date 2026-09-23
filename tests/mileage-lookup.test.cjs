const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createIndex, formatMileage, uniqueLocations } = require('../mileage-lookup.js');
const coords = [[-4, 56], [-4, 56.002]];
const link = (elr = 'TEST', anchors = [[0, 1760], [1, 3520]], geometry = coords) => ({ elr, anchors, coords: geometry });
const middle = { lat: 56.001, lng: -4 };
const value = index => index.lookup(middle).locations[0].mileage;

test('click mileage follows a curved polyline rather than its endpoint chord', () => {
  const index = createIndex([link('TEST', [[0, 0], [1, 1760]], [[-4, 56], [-4, 56.001], [-4.001, 56.001]])]);
  assert.equal(index.lookup({ lat: 56.001, lng: -4.001 }).locations[0].mileage, '1m 0yd');
  assert.equal(index.lookup({ lat: 56.001, lng: -4 }).locations[0].mileage, '0m 1129yd');
});
test('interpolates calibrated intervals in yards', () => {
  assert.equal(value(createIndex([link('TEST', [[0, 1760], [0.5, 2200], [1, 3520]])])), '1m 440yd');
});
test('handles decreasing mileage', () => {
  assert.equal(value(createIndex([link('TEST', [[0, 3520], [1, 1760]])])), '1m 880yd');
});
test('rounds yards through mile boundaries and handles negative mileage', () => {
  assert.equal(formatMileage(1759.6), '1m 0yd');
  assert.equal(formatMileage(-1782), '−1m 22yd');
  assert.equal(formatMileage(0), '0m 0yd');
  assert.equal(formatMileage(1759.4), '0m 1759yd');
});
test('strict 20 metre radius and only the closest ELR', () => {
  const offset = metres => metres / (6371008.8 * Math.PI / 180 * Math.cos(middle.lat * Math.PI / 180));
  const index = createIndex([link()]);
  assert.equal(index.lookup({ ...middle, lng: -4 + offset(19.99) }).status, 'ok');
  assert.equal(index.lookup({ ...middle, lng: -4 + offset(20.01) }).status, 'unavailable');
  const parallel = coords.map(([x,y]) => [x + offset(15),y]);
  const result = createIndex([link('AAA'), link('BBB', [[0, 0], [1, 1760]], parallel)]).lookup(middle);
  assert.deepEqual(result.locations.map(l => [l.elr,l.mileage]), [['AAA','1m 880yd']]);
  const reversed = createIndex([link('BBB', [[0, 0], [1, 1760]], parallel), link('AAA')]).lookup(middle);
  assert.equal(reversed.locations[0].elr, 'AAA');
});
test('does not assign malformed data or degenerate geometry', () => {
  assert.equal(createIndex([{ ...link(), anchors: [[0, null], [1, 4]] }]).lookup(middle).status, 'unavailable');
  assert.equal(createIndex([link('TEST', [[0, 0], [1, 1]], [[-4, 56], [-4, 56]])]).lookup(middle).status, 'unavailable');
});
test('same ELR with conflicting mileages returns only the nearest reference', () => {
  const result = createIndex([link(), link('TEST', [[0, 0], [1, 1760]])]).lookup(middle);
  assert.deepEqual(result.locations.map(l => l.mileage), ['1m 880yd']);
});
test('agreeing parallel lines return one result without track identity', () => {
  const result = createIndex([{ ...link(), TRID: '1234', trackName: 'Down Main' }, link()]).lookup(middle);
  assert.equal(result.locations.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /TRID|1234|Down Main/);
});
test('mileage search reverses interpolation, including decreasing mileage', () => {
  for (const anchors of [[[0, 1760], [0.5, 2200], [1, 3520]], [[0, 3520], [0.5, 2200], [1, 1760]]]) {
    const index = createIndex([link('TEST', anchors)]);
    const matches = index.findMileage('test', 2200);
    assert.equal(matches.length, 1);
    assert.ok(Math.abs(matches[0].lat - middle.lat) < 1e-8);
    assert.equal(matches[0].mileage, '1m 440yd');
    assert.equal(index.findMileage('TEST', 5000).length, 0);
    assert.equal(index.findMileage('XXXX', 2200).length, 0);
  }
});
test('search keeps separate locations while deduplicating adjacent tracks and section overlaps', () => {
  const index = createIndex([link(), link(), link('TEST', [[0,1760],[1,3520]], coords.map(([x,y])=>[x+.01,y]))]);
  const matches = index.findMileage('TEST', 2640);
  assert.equal(matches.length, 2);
  assert.equal(uniqueLocations([...matches,...matches]).length, 2);
});
