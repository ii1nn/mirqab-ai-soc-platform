import { Role } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}

/** Refresh tokens additionally carry the RefreshToken row's id, so a
 *  presented token can be matched (and revoked) against its DB record. */
export interface RefreshTokenPayload extends JwtPayload {
  tokenId: string;
}
