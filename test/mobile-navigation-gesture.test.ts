import assert from "node:assert/strict";
import test from "node:test";
import { createMobileNavigationGesture } from "../src/client/src/mobile/navigation-gesture";

test("mobile navigation claims a rightward swipe that starts at the viewport edge", () => {
  const gesture = createMobileNavigationGesture();
  assert.equal(gesture.start(1, 4, 120), true);
  assert.deepEqual(gesture.move(1, 28, 126), { handled: false, open: false });
  assert.deepEqual(gesture.move(1, 52, 130), { handled: true, open: true });
  assert.deepEqual(gesture.move(1, 80, 134), { handled: true, open: false });
  assert.equal(gesture.end(1), true);
});

test("mobile navigation leaves vertical and non-edge gestures to their surfaces", () => {
  const gesture = createMobileNavigationGesture();
  assert.equal(gesture.start(2, 40, 100), false);
  assert.deepEqual(gesture.move(2, 100, 105), { handled: false, open: false });

  assert.equal(gesture.start(3, 5, 100), true);
  assert.deepEqual(gesture.move(3, 12, 122), { handled: false, open: false });
  assert.deepEqual(gesture.move(3, 60, 126), { handled: false, open: false });
  assert.equal(gesture.end(3), false);
});

test("mobile navigation respects a shifted visual viewport edge and pointer identity", () => {
  const gesture = createMobileNavigationGesture();
  assert.equal(gesture.start(4, 24, 80, 20), true);
  assert.deepEqual(gesture.move(5, 80, 82), { handled: false, open: false });
  assert.equal(gesture.end(5), false);
  gesture.cancel(5);
  assert.deepEqual(gesture.move(4, 70, 84), { handled: true, open: true });
  gesture.cancel(4);
  assert.equal(gesture.end(4), false);
});
