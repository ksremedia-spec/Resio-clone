export type ErrorCode =
  | 'validation_error' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited'
  | 'invalid_credentials' | 'token_expired' | 'token_invalid' | 'version_conflict' | 'payload_too_large' | 'internal';

export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: ErrorCode, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'AppError';
  }
  static validation(message: string, details?: unknown) { return new AppError(400, 'validation_error', message, details); }
  static unauthenticated(message = 'Sign in to continue.') { return new AppError(401, 'unauthenticated', message); }
  static forbidden(message = 'You do not have permission to do that.') { return new AppError(403, 'forbidden', message); }
  static notFound(what = 'Record') { return new AppError(404, 'not_found', `${what} was not found.`); }
  static conflict(message: string, details?: unknown) { return new AppError(409, 'conflict', message, details); }
  static versionConflict(details?: unknown) { return new AppError(409, 'version_conflict', 'This record was changed by someone else. Refresh and try again.', details); }
}
