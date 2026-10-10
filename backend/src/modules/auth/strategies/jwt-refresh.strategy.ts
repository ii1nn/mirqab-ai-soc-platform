import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { RefreshTokenPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: (req: Request): string | null => req?.body?.refreshToken ?? null,
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.refreshSecret'),
      passReqToCallback: true,
      // Phase 11: see the matching comment in jwt.strategy.ts.
      algorithms: ['HS256'],
    });
  }

  validate(req: Request, payload: RefreshTokenPayload): RefreshTokenPayload & { rawToken: string } {
    const rawToken = req.body?.refreshToken;
    if (!rawToken) {
      throw new UnauthorizedException('Refresh token missing');
    }
    return { ...payload, rawToken };
  }
}
