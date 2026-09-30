import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SolanaService } from './solana.service';

@ApiTags('solana')
@Controller('solana')
export class SolanaController {
  constructor(private readonly solanaService: SolanaService) {}

  @Get('health')
  @ApiOperation({ summary: 'Check Solana service health' })
  health() {
    return this.solanaService.getHealth();
  }

  @Get('credentials/v1/:hash.json')
  credentialMetadata(@Param('hash') hash: string) {
    return this.solanaService.getCredentialMetadata(hash);
  }

  @Get('credentials/:submissionId/verify')
  verifyCredential(@Param('submissionId') submissionId: string) {
    return this.solanaService.verifyCredential(submissionId);
  }

  @Get('winner-credentials/v1/:hash.json')
  winnerCredentialMetadata(@Param('hash') hash: string) {
    return this.solanaService.getWinnerCredentialMetadata(hash);
  }

  @Get('winner-credentials/:awardId/verify')
  verifyWinnerCredential(@Param('awardId') awardId: string) {
    return this.solanaService.verifyWinnerCredential(awardId);
  }
}
