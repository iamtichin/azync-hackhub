import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UsersController } from './users.controller';
import { UpdateProfileDto } from './dto/update-profile.dto';

describe('UsersController profile privacy', () => {
  const users: any = { findOne: jest.fn(), getTeams: jest.fn(), updateProfile: jest.fn() };
  const controller = new UsersController(users);
  beforeEach(() => jest.clearAllMocks());

  it('requests private fields only for the authenticated self profile', async () => {
    await controller.getCurrentUser({ user: { id: 'self' } });
    await controller.getUser('other');
    expect(users.findOne).toHaveBeenNthCalledWith(1, 'self', true);
    expect(users.findOne).toHaveBeenNthCalledWith(2, 'other');
  });

  it('rejects another user’s team memberships and limits profile writes to self', async () => {
    await expect(controller.getUserTeams('other', { user: { id: 'self' } })).rejects.toBeInstanceOf(ForbiddenException);
    await controller.updateCurrentUser({ user: { id: 'self' } }, { university: 'Uni', skills: ['TypeScript'] });
    expect(users.updateProfile).toHaveBeenCalledWith('self', { university: 'Uni', skills: ['TypeScript'] });
  });

  it('enforces bounded university and skills inputs for the self profile', async () => {
    const invalid = plainToInstance(UpdateProfileDto, {
      university: 'U'.repeat(161), skills: Array.from({ length: 31 }, () => 'TypeScript'),
    });
    const valid = plainToInstance(UpdateProfileDto, { university: 'University', skills: ['TypeScript', 'Solana'] });
    await expect(validate(invalid)).resolves.toHaveLength(2);
    await expect(validate(valid)).resolves.toHaveLength(0);
  });
});
