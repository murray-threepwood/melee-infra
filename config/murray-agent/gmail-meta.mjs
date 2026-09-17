export async function fetchGmailMeta({
  fetchImpl = fetch,
  baseUrl = process.env.GMAIL_MCP_URL || "http://workspace-mcp:8000",
  timeoutMs = 10000,
} = {}) {
  const url = `${String(baseUrl).replace(/\/+$/, "")}/gmail/unread`;
  const res = await fetchImpl(url, {
    method: "GET",
    signal: AbortSignal.timeout(timeoutMs),
  });
  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  return {
    http: res.status,
    status: body.status || "",
    error: body.error || "",
    unread_count: body.unread_count,
  };
}
