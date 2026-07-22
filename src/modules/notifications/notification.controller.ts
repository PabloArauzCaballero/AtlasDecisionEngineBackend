import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { PLATFORM_ROLES } from '../../common/security/platform-roles';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { NotificationListQueryDto } from './notification.dto';
import { NotificationRecipient, NotificationService } from './notification.service';

/**
 * Personal notification inbox. Every platform role may call it — but each caller only
 * ever sees notifications addressed to their own principal or to a role they hold; the
 * recipient filter is built from the server-established principal, never from input.
 */
@ApiTags('Notifications')
@Controller('v1/notifications')
@Roles(...PLATFORM_ROLES)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  private recipient(principal: AuthenticatedPrincipal): NotificationRecipient {
    return { principalId: principal.id, roles: principal.roles };
  }

  @Get()
  list(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: NotificationListQueryDto,
  ) {
    return this.notifications.list(tenantId, this.recipient(principal), query);
  }

  @Get('unread-count')
  unreadCount(@TenantId() tenantId: bigint, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.notifications.unreadCount(tenantId, this.recipient(principal));
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ) {
    return this.notifications.markRead(
      tenantId,
      this.recipient(principal),
      parseBigIntId(id, 'id'),
    );
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@TenantId() tenantId: bigint, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.notifications.markAllRead(tenantId, this.recipient(principal));
  }
}
