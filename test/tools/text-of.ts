// Shared test helper: a tool result's text blocks, joined (non-text blocks contribute nothing).

/** All text blocks of a result, joined with newlines. */
export const textOf = (r: { content: readonly { type: string; text?: string }[] }): string =>
  r.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
