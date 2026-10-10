import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { IsEqualTo } from '../../../common/validators/is-equal-to.decorator';

/**
 * Self-service registration — unlike RegisterDto (admin-only, any role),
 * this is the payload for the public "Create account" screen. There is no
 * `role` field here at all, so a caller can never request one; the account
 * is always provisioned as IT_TECHNICIAN — see AuthService.signup for why
 * that's used instead of EMPLOYEE.
 */
export class SignupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters long' })
  @MaxLength(128)
  password!: string;

  @IsString()
  @IsEqualTo('password', { message: 'Passwords do not match' })
  confirmPassword!: string;
}
