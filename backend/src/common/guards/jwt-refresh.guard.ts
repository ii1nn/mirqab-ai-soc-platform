import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Validates the `jwt-refresh` Passport strategy. Used only on POST /auth/refresh. */
@Injectable()
export class JwtRefreshGuard extends AuthGuard('jwt-refresh') {}
