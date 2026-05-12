export class GoogleAdsApiError extends Error {
  constructor(message: string, public httpStatus: number, public body?: unknown) {
    super(message);
    this.name = 'GoogleAdsApiError';
  }
}

export class InvalidGrantError extends Error {
  constructor(message = 'invalid_grant') {
    super(message);
    this.name = 'InvalidGrantError';
  }
}

export class InvalidClientError extends Error {
  constructor(message = 'invalid_client') {
    super(message);
    this.name = 'InvalidClientError';
  }
}

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds?: number) {
    super('rate_limited');
    this.name = 'RateLimitError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export class TimeBudgetError extends Error {
  constructor(public reason: string, public elapsedMs: number) {
    super(`time_budget_exceeded: ${reason} after ${elapsedMs}ms`);
    this.name = 'TimeBudgetError';
  }
}
