import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/**
 * Converts database constraint failures into intentional HTTP responses.
 *
 * Pre-flight checks improve usability, but concurrent nested writes (for example
 * adding the same team member twice) can still race.  Do not expose Prisma's
 * model, field, or SQL details to clients in that case.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const mapped = this.toHttpException(exception);
    const payload = mapped.getResponse();
    response.status(mapped.getStatus()).json(payload);
  }

  private toHttpException(exception: Prisma.PrismaClientKnownRequestError) {
    switch (exception.code) {
      case 'P2002':
        return new ConflictException('A record with those values already exists');
      case 'P2003':
      case 'P2014':
        return new ConflictException('This change conflicts with related records');
      case 'P2025':
        return new NotFoundException('The requested record no longer exists');
      default:
        return {
          getStatus: () => HttpStatus.INTERNAL_SERVER_ERROR,
          getResponse: () => ({
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Unable to complete the database operation',
          }),
        };
    }
  }
}
