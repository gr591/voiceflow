/**
 * Parses a Server-Sent Events response body into an async iterable of data lines.
 * Handles chunked streaming and multi-line buffering.
 */
export async function* parseSSEStream(
  response: Response
): AsyncIterable<string> {
  if (!response.body) throw new Error("Response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") return;
        if (data) yield data;
      }
    }
  }
}
