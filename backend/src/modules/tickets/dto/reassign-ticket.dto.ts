import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReassignTicketDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  assignee!: string;
}
