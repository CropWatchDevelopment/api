import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Machine-readable outcomes the app maps to localized messages.
 * `message` is an English fallback for API clients.
 */
export type GatewayClaimErrorCode =
  | 'INVALID_EUI'
  | 'STAFF_ONLY'
  | 'USER_NOT_FOUND'
  | 'GATEWAY_NOT_FOUND'
  | 'GATEWAY_AMBIGUOUS'
  | 'GATEWAY_CLAIMED'
  | 'GATEWAY_NOT_HEARD';

const STATUS: Record<GatewayClaimErrorCode, HttpStatus> = {
  INVALID_EUI: HttpStatus.BAD_REQUEST,
  STAFF_ONLY: HttpStatus.FORBIDDEN,
  USER_NOT_FOUND: HttpStatus.NOT_FOUND,
  GATEWAY_NOT_FOUND: HttpStatus.NOT_FOUND,
  GATEWAY_AMBIGUOUS: HttpStatus.CONFLICT,
  GATEWAY_CLAIMED: HttpStatus.CONFLICT,
  GATEWAY_NOT_HEARD: HttpStatus.UNPROCESSABLE_ENTITY,
};

export class GatewayClaimException extends HttpException {
  constructor(
    public readonly code: GatewayClaimErrorCode,
    message: string,
  ) {
    super({ statusCode: STATUS[code], code, message }, STATUS[code]);
  }
}
