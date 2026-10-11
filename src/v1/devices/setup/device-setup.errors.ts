import { HttpException, HttpStatus } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

/**
 * Machine-readable outcomes the app maps to localized, actionable messages.
 * `message` is an English fallback for API clients.
 */
export type DeviceSetupErrorCode =
  | 'INVALID_DEV_EUI'
  | 'INVALID_NAME'
  | 'INVALID_KEYS'
  | 'KEYS_REQUIRED'
  | 'KEYS_DO_NOT_MATCH'
  | 'DEVICE_OWNED_BY_OTHER_ACCOUNT'
  | 'DEVICE_ALREADY_YOURS'
  | 'SETUP_IN_PROGRESS'
  | 'MODEL_NOT_AVAILABLE_IN_REGION'
  | 'NETWORK_MODEL_MISMATCH'
  | 'LICENSE_REQUIRED'
  | 'NETWORK_EUI_CLAIMED_ELSEWHERE'
  | 'NETWORK_DEVICE_UNVERIFIABLE'
  | 'NETWORK_UNAVAILABLE'
  | 'NETWORK_NOT_CONFIGURED'
  | 'SETUP_FAILED';

const STATUS: Record<DeviceSetupErrorCode, HttpStatus> = {
  INVALID_DEV_EUI: HttpStatus.BAD_REQUEST,
  INVALID_NAME: HttpStatus.BAD_REQUEST,
  INVALID_KEYS: HttpStatus.BAD_REQUEST,
  KEYS_REQUIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  KEYS_DO_NOT_MATCH: HttpStatus.UNPROCESSABLE_ENTITY,
  DEVICE_OWNED_BY_OTHER_ACCOUNT: HttpStatus.CONFLICT,
  DEVICE_ALREADY_YOURS: HttpStatus.CONFLICT,
  SETUP_IN_PROGRESS: HttpStatus.CONFLICT,
  MODEL_NOT_AVAILABLE_IN_REGION: HttpStatus.UNPROCESSABLE_ENTITY,
  NETWORK_MODEL_MISMATCH: HttpStatus.CONFLICT,
  LICENSE_REQUIRED: HttpStatus.FORBIDDEN,
  NETWORK_EUI_CLAIMED_ELSEWHERE: HttpStatus.CONFLICT,
  NETWORK_DEVICE_UNVERIFIABLE: HttpStatus.CONFLICT,
  NETWORK_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  NETWORK_NOT_CONFIGURED: HttpStatus.SERVICE_UNAVAILABLE,
  SETUP_FAILED: HttpStatus.INTERNAL_SERVER_ERROR,
};

/** Short id shown to the user and logged, so support can find the request. */
export const newSetupReference = (): string =>
  `CW-${randomBytes(3).toString('hex').toUpperCase()}`;

export class DeviceSetupException extends HttpException {
  constructor(
    public readonly code: DeviceSetupErrorCode,
    message: string,
    public readonly reference: string,
    details?: Record<string, unknown>,
  ) {
    super(
      {
        statusCode: STATUS[code],
        code,
        message,
        reference,
        ...(details ? { details } : {}),
      },
      STATUS[code],
    );
  }
}
