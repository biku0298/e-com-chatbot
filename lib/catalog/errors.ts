/** The product catalog could not be reached (timeout, network, server or rate-limit failure). */
export class CatalogUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(`Product catalog unavailable: ${reason}`);
    this.name = 'CatalogUnavailableError';
  }
}
