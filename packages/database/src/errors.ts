import { Prisma } from '@prisma/client';

/**
 * Thrown when an invalid argument or payload is passed to a database repository operation.
 */
export class DatabaseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseValidationError';
  }
}

/**
 * Checks whether an error thrown by Prisma corresponds to a missing record
 * (Prisma error code P2025: "An operation failed because it depends on one or more records that were required but not found").
 */
export function isRecordNotFoundError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2025';
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2025'
  ) {
    return true;
  }
  return false;
}
