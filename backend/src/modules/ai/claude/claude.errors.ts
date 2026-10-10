export class ClaudeUnavailableError extends Error {
  constructor(message = 'Claude API is not configured') {
    super(message);
    this.name = 'ClaudeUnavailableError';
  }
}

export class ClaudeRefusalError extends Error {
  constructor(message = 'Claude declined to process this request') {
    super(message);
    this.name = 'ClaudeRefusalError';
  }
}
