export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds, so clients know when to refresh. */
  expiresIn: number;
}
