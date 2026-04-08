const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveContainedImageClick
} = require('../public/live-view-coordinates');

function assertAlmostEqual(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} ≈ ${expected}`);
}

test('resolveContainedImageClick removes horizontal letterbox offset when image is centered', () => {
  const point = resolveContainedImageClick({
    clientX: 40,
    clientY: 325,
    rectLeft: 0,
    rectTop: 0,
    rectWidth: 1180,
    rectHeight: 650,
    sourceWidth: 1365,
    sourceHeight: 768
  });

  assertAlmostEqual(point.offsetX, 12.36328125);
  assert.equal(point.offsetY, 0);
  assertAlmostEqual(point.pageX, 32.65384615384615);
  assert.equal(point.pageY, 384);
});

test('resolveContainedImageClick removes vertical letterbox offset when image is centered', () => {
  const point = resolveContainedImageClick({
    clientX: 400,
    clientY: 70,
    rectLeft: 100,
    rectTop: 20,
    rectWidth: 900,
    rectHeight: 700,
    sourceWidth: 1280,
    sourceHeight: 720
  });

  assert.equal(point.offsetX, 0);
  assertAlmostEqual(point.offsetY, 96.875);
  assertAlmostEqual(point.pageX, 426.66666666666663);
  assert.equal(point.pageY, 0);
});

test('resolveContainedImageClick clamps clicks outside the rendered image bounds', () => {
  const point = resolveContainedImageClick({
    clientX: 10,
    clientY: 10,
    rectLeft: 0,
    rectTop: 0,
    rectWidth: 900,
    rectHeight: 700,
    sourceWidth: 1280,
    sourceHeight: 720
  });

  assertAlmostEqual(point.pageX, 14.222222222222221);
  assert.equal(point.pageY, 0);
});
