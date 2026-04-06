import {
  getState,
  setState,
  undo,
  redo,
  canUndo,
  canRedo,
  reset,
  subscribe,
} from "./calpinageStore";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
}

console.log("TEST store: start");

reset();

const unsub = subscribe((st) => {
  // minimal: ensure state object exists
  if (!st || !st.meta) throw new Error("listener received invalid state");
});

const s1 = getState();
assert(s1.meta.version === "v1", "version should be v1");
assert(s1.pv.layout.length === 0, "layout starts empty");

setState((prev) => {
  prev.pv.module = "TEST_MODULE";
  return prev;
}, { action: "set_module" });

const s2 = getState();
assert(s2.pv.module === "TEST_MODULE", "module updated");
assert(canUndo(), "canUndo true after change");
assert(!canRedo(), "canRedo false after new change");

undo();
const s3 = getState();
assert(s3.pv.module !== "TEST_MODULE", "undo restored previous");
assert(canRedo(), "canRedo true after undo");

redo();
const s4 = getState();
assert(s4.pv.module === "TEST_MODULE", "redo restored change");

unsub();

console.log("TEST store: OK");
