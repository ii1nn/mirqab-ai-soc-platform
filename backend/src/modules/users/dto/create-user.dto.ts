import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters long' })
  @MaxLength(128)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @IsEnum(Role, { message: 'role must be one of ADMIN, SECURITY_ANALYST, IT_TECHNICIAN, EMPLOYEE' })
  role!: Role;

  /** Scopes an IT_TECHNICIAN's case access (see IncidentAccessGuard) — ignored for other roles. */
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
