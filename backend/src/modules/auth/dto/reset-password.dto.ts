import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsEqualTo } from '../../../common/validators/is-equal-to.decorator';

export class ResetPasswordDto {
  @IsString()
  @MaxLength(500)
  token!: string;

  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters long' })
  @MaxLength(128)
  newPassword!: string;

  @IsString()
  @IsEqualTo('newPassword', { message: 'Passwords do not match' })
  confirmPassword!: string;
}
