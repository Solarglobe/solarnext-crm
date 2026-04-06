export function deepClone<T>(obj: T): T {
  // structuredClone is supported in modern browsers + recent Node
  // Fallback to JSON for simple data (our state is JSON-safe)
  // @ts-ignore
  if (typeof structuredClone === "function") return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}
