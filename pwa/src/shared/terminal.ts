/** Output as text: without the terminal's colours, cursor moves and window titles. */
export function plainOutput(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g, '').replace(/\r(?!\n)/g, '\n')
}
