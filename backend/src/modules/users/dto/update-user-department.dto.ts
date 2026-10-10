import { IsOptional, IsUUID } from 'class-validator';

export class UpdateUserDepartmentDto {
  /** Omit or send null to clear (grants org-wide access — see IncidentAccessGuard). */
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;
}
