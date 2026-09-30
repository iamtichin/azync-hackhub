import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaExceptionFilter } from './prisma-exception.filter';

describe('PrismaExceptionFilter', () => {
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['P2002', HttpStatus.CONFLICT, 'A record with those values already exists'],
    ['P2003', HttpStatus.CONFLICT, 'This change conflicts with related records'],
    ['P2014', HttpStatus.CONFLICT, 'This change conflicts with related records'],
    ['P2025', HttpStatus.NOT_FOUND, 'The requested record no longer exists'],
  ])('maps nested-write Prisma %s without exposing database details', (code, status, message) => {
    const error = new Prisma.PrismaClientKnownRequestError('internal constraint detail', {
      code,
      clientVersion: 'test',
      meta: { target: ['TeamMember_teamId_userId_key'] },
    });

    new PrismaExceptionFilter().catch(error, host);

    expect(response.status).toHaveBeenCalledWith(status);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: status, message }));
    expect(response.json).not.toHaveBeenCalledWith(expect.stringContaining('TeamMember'));
  });
});
