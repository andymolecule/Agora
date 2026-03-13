export function isMissingHistoricalBlockError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /header not found|block not found|unknown block/i.test(message);
}
