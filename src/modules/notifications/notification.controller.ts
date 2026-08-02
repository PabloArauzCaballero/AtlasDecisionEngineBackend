import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeysetResponse } from '../../common/http/pagination.dto';
import { parseBigIntId } from '../../common/http/id';
import {
  MarkAllReadResponseDto,
  NotificationDto,
  UnreadCountResponseDto,
} from './notification.response.dto';
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
  @ApiOperation({ summary: 'List notifications addressed to the caller or its roles' })
  @ApiKeysetResponse(
    'Página por cursor de la bandeja del llamante. Sin `total`: recorrer por cursor evita contar.',
  )
  list(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: NotificationListQueryDto,
  ) {
    return this.notifications.list(tenantId, this.recipient(principal), query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Count unread notifications visible to the caller' })
  @ApiOkResponse({ description: 'Contador de no leídas.', type: UnreadCountResponseDto })
  unreadCount(@TenantId() tenantId: bigint, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.notifications.unreadCount(tenantId, this.recipient(principal));
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark one visible notification as read' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Notificación marcada como leída.', type: NotificationDto })
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
  @ApiOperation({ summary: 'Mark every visible notification as read' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'Cuántas notificaciones pasaron a leídas. Idempotente: repetir devuelve 0.',
    type: MarkAllReadResponseDto,
  })
  markAllRead(@TenantId() tenantId: bigint, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.notifications.markAllRead(tenantId, this.recipient(principal));
  }
}
