/**
 * Splits a slide's script into tracking segments (PRD §4.1).
 * Line breaks always start a new segment, so the presenter controls
 * segmentation by editing line breaks. Within a line, sentences are split
 * after sentence-ending punctuation followed by whitespace.
 */
export function splitScript(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line) => line.split(/(?<=[.!?。？！])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
