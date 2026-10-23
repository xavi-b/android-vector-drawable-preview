import assert from "node:assert/strict";
import { test } from "node:test";
import { measureFirstContour, trimPathData } from "./pathTrim";

test("keeps a full path, including when an offset is set", () => {
  const full = trimPathData("M0 0C10 0 10 10 0 10", 0, 1, 0.5);
  assert.equal(full.pathData, null);
  assert.equal(full.flattened, false);
});

test("trims a straight line to exact endpoints", () => {
  assert.equal(trimPathData("M0 0L10 0", 0, 0.5, 0).pathData, "M0 0L5 0");
  assert.equal(trimPathData("M0 0L10 0", 0, 0.5, 0.25).pathData, "M2.5 0L7.5 0");
  assert.equal(trimPathData("M0 0L10 0", 0.8, 0.2, 0).pathData, "M8 0L10 0M0 0L2 0");
});

test("a zero-length trim draws nothing", () => {
  assert.equal(trimPathData("M0 0L10 0", 0.4, 0.4, 0.2).pathData, "");
});

test("measures lines, implicit commands, and closed contours", () => {
  assert.equal(measureFirstContour("M0 0L10 0"), 10);
  assert.equal(measureFirstContour("M0 0 10 0"), 10);
  assert.equal(measureFirstContour("m0 0l10 0"), 10);
  assert.equal(measureFirstContour("M0 0L1e1 0"), 10);
  assert.equal(measureFirstContour("M0 0H10V10H0Z"), 40);
  assert.ok(Math.abs(measureFirstContour("M0 0L10-5") - Math.hypot(10, 5)) < 0.001);
});

test("a quadratic on a straight line keeps its length", () => {
  assert.ok(Math.abs(measureFirstContour("M0 0Q5 0 10 0") - 10) < 0.05);
});

test("an arc's halfway point sits on the circle", () => {
  const trimmed = trimPathData("M10 0A10 10 0 0 1 0 10", 0, 0.5, 0);
  assert.equal(trimmed.flattened, true);
  assert.ok(trimmed.pathData);
  const numbers = trimmed.pathData.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const x = numbers[numbers.length - 2];
  const y = numbers[numbers.length - 1];
  assert.ok(Math.abs(x - 7.071) < 0.2, `x=${x}`);
  assert.ok(Math.abs(y - 7.071) < 0.2, `y=${y}`);
});

test("reports extra contours and parser failures", () => {
  const extra = trimPathData("M0 0L10 0M0 1L10 1", 0, 0.5, 0);
  assert.equal(extra.droppedContours, true);
  assert.equal(extra.pathData, "M0 0L5 0");

  const bad = trimPathData("M0 0L", 0, 0.5, 0);
  assert.equal(bad.pathData, null);
  assert.ok(bad.error);
});
