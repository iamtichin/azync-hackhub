import { SolanaController } from './solana.controller';

describe('SolanaController public proof projection', () => {
  it('projects only metadata and verification service results, never a submission snapshot', async () => {
    const service = {
      getHealth: jest.fn(),
      getCredentialMetadata: jest
        .fn()
        .mockResolvedValue({
          name: 'Azync HackHub Credential',
          symbol: 'AHSUB',
        }),
      verifyCredential: jest
        .fn()
        .mockResolvedValue({
          verified: true,
          assetId: 'asset',
          signature: 'tx',
        }),
      getWinnerCredentialMetadata: jest
        .fn()
        .mockResolvedValue({ name: 'Azync HackHub Winner', symbol: 'AHWIN' }),
      verifyWinnerCredential: jest
        .fn()
        .mockResolvedValue({
          verified: true,
          assetId: 'winner-asset',
          signature: 'winner-tx',
        }),
    } as any;
    const controller = new SolanaController(service);
    await expect(controller.credentialMetadata('hash')).resolves.toEqual({
      name: 'Azync HackHub Credential',
      symbol: 'AHSUB',
    });
    await expect(controller.verifyCredential('submission')).resolves.toEqual({
      verified: true,
      assetId: 'asset',
      signature: 'tx',
    });
    expect(service.getCredentialMetadata).toHaveBeenCalledWith('hash');
    expect(service.verifyCredential).toHaveBeenCalledWith('submission');
    await expect(
      controller.winnerCredentialMetadata('winner-hash'),
    ).resolves.toEqual({ name: 'Azync HackHub Winner', symbol: 'AHWIN' });
    await expect(controller.verifyWinnerCredential('award')).resolves.toEqual({
      verified: true,
      assetId: 'winner-asset',
      signature: 'winner-tx',
    });
    expect(service.getWinnerCredentialMetadata).toHaveBeenCalledWith(
      'winner-hash',
    );
    expect(service.verifyWinnerCredential).toHaveBeenCalledWith('award');
  });
});
