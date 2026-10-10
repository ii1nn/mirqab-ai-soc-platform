import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { TicketAccessGuard } from '../../common/guards/ticket-access.guard';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ReassignTicketDto } from './dto/reassign-ticket.dto';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto';
import { TicketsService } from './tickets.service';

/** Requirement #30 (OWASP API#1): TicketAccessGuard adds the object-level
 * department check on top of RolesGuard's role-only check — see the guard. */
@Controller('tickets')
@Roles(Role.ADMIN, Role.SECURITY_ANALYST, Role.IT_TECHNICIAN)
@UseGuards(TicketAccessGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.findAll(user);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ticketsService.updateStatus(id, dto.status, user.email);
  }

  @Patch(':id/assignee')
  reassign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignTicketDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ticketsService.reassign(id, dto.assignee, user.email);
  }
}
