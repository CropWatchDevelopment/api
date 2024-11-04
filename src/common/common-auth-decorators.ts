import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity } from '@nestjs/swagger';

export function ApiCommonAuth(summary: string) {
  return applyDecorators(
    ApiSecurity('x-api-key', ['x-api-key']),
    ApiBearerAuth('JWT'),
    ApiOperation({ summary }),
  );
}