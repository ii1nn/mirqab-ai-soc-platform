import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RedisModule } from '../../redis/redis.module';
import { UsersModule } from '../users/users.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [
    UsersModule,
    RedisModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.accessSecret'),
      }),
    }),
  ],
  providers: [RealtimeGateway],
})
export class WebsocketModule {}
