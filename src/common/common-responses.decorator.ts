import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

export function CommonResponses() {
  return applyDecorators(
    ApiResponse({ status: 400, description: 'Bad Request' }),
    ApiResponse({ status: 401, description: 'Unauthorized' }),
    ApiResponse({ status: 402, description: 'Payment Required' }),
    ApiResponse({ status: 403, description: 'Forbidden' }),
    ApiResponse({ status: 404, description: 'Not Found' }),
    ApiResponse({ status: 500, description: 'Internal Server Error' }),
  );
}

export function ApiCreateResponses() {
  return applyDecorators(
    ApiResponse({ status: 201, description: 'Content Created' }),
    CommonResponses()
  );
}

export function ApiGetResponses() {
  return applyDecorators(
    ApiResponse({ status: 200, description: 'OK' }),
    CommonResponses()
  );
}

export function ApiDeleteResponses() {
  return applyDecorators(
    ApiResponse({ status: 204, description: 'No Content' }),
    CommonResponses(),
  );
}
