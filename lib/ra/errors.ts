export interface RaHttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly responseBody: string;
}
