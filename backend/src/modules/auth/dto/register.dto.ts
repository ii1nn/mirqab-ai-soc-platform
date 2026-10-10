import { CreateUserDto } from '../../users/dto/create-user.dto';

/**
 * Identical shape to CreateUserDto today. Kept as a distinct class because
 * registration is an auth-module concern (who is allowed to create accounts,
 * via `@Roles(Role.ADMIN)` on AuthController) and may diverge from the
 * users module's internal creation contract later (e.g. self-service
 * employee sign-up with a different validation set).
 */
export class RegisterDto extends CreateUserDto {}
