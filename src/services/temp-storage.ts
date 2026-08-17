export const mockStoragePrefix = "crewqual:mock:";

function currentInstanceId() {
  if (typeof document === "undefined") return "server";
  return document.body?.dataset.mockInstanceId || "local";
}

export function mockStorageKey(key: string) {
  return `${mockStoragePrefix}${currentInstanceId()}:${key}`;
}

export function clearMockStorage() {
  if (typeof window === "undefined") return;
  const keysToRemove: string[] = [];
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index);
    if (key?.startsWith(mockStoragePrefix)) keysToRemove.push(key);
  }
  keysToRemove.forEach((key) => window.sessionStorage.removeItem(key));
}
