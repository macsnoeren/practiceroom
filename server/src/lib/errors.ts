/** An error with an associated HTTP status code, surfaced to the client. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message = 'Niet ingelogd') => new HttpError(401, message);
export const forbidden = (message = 'Geen toegang') => new HttpError(403, message);
export const notFound = (message = 'Niet gevonden') => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
export const payloadTooLarge = (message: string) => new HttpError(413, message);
export const tooManyRequests = (message: string) => new HttpError(429, message);
