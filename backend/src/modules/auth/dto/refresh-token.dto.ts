import { IsString, MaxLength } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @MaxLength(2000)
  refreshToken!: string;
}
