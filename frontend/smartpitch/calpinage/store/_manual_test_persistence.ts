import {
  initCalpinagePersistence,
  resetCalpinagePersistence,
} from "./persistence";
import { getState, setState } from "./calpinageStore";

console.log("TEST persistence: start");

// fake lead id
const LEAD_ID = "TEST123";

// clean
resetCalpinagePersistence();

// init persistence
initCalpinagePersistence(LEAD_ID);

// mutate state
setState((prev) => {
  prev.pv.module = "PERSIST_TEST";
  return prev;
});

// wait > throttle
setTimeout(() => {
  const raw = localStorage.getItem(`CALPINAGE_STATE_${LEAD_ID}`);
  if (!raw) throw new Error("State not persisted");

  const parsed = JSON.parse(raw);
  if (parsed.pv.module !== "PERSIST_TEST") {
    throw new Error("Persisted value mismatch");
  }

  console.log("TEST persistence: OK");
}, 600);
