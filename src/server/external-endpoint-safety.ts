const LOCAL_TEST_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLocalTestEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      LOCAL_TEST_HOSTS.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}
