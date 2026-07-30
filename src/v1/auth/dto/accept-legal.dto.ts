import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsIn } from 'class-validator';

export const LEGAL_DOCUMENT_KINDS = [
  'privacy_policy',
  'terms_of_service',
  'eula',
] as const;

export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];

// Deliberately no version field: the server stamps the current version itself,
// so a client can never record acceptance of a version it was not shown.
export class AcceptLegalDto {
  @ApiProperty({ isArray: true, enum: LEGAL_DOCUMENT_KINDS })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(LEGAL_DOCUMENT_KINDS, { each: true })
  kinds: LegalDocumentKind[];
}
