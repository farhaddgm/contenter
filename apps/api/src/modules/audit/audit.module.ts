import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { PaginationQuerySchema } from '@contenter/shared';
import { z } from 'zod';
import { Roles } from '../../common/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from './audit.service';

const AuditQuerySchema = PaginationQuerySchema.extend({ entityType: z.string().optional() });

@Controller('admin/audit-logs')
@Roles('ADMIN')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query(new ZodValidationPipe(AuditQuerySchema)) query: z.infer<typeof AuditQuerySchema>) {
    return this.audit.list(query);
  }
}

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
