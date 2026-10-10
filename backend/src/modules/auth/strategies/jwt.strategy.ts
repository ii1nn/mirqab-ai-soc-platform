import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface';
import { UsersService } from '../../users/users.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.accessSecret'),
      // Phase 11: pin verification to the one algorithm this app ever signs
      // with (HS256, a plain shared secret — see AuthModule's JwtModule
      // config). Not currently exploitable here (no RSA/EC public key exists
      // anywhere for an attacker to redirect an "alg confusion" token
      // through), but explicit is cheap and removes the question entirely.
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.usersService.findById(payload.sub);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User no longer exists or is inactive');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
      organizationId: user.organizationId,
    };
  }
}
