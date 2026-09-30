import { ApiProperty } from '@nestjs/swagger';

export class SubmissionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  status: string;

  @ApiProperty({ required: false })
  transactionSignature?: string;

  @ApiProperty({ required: false })
  nftAssetId?: string;

  @ApiProperty({ required: false })
  explorerUrl?: string;

  @ApiProperty({ enum: ['queued', 'completed', 'not_queued'] })
  aiAnalysisStatus: string;

  @ApiProperty()
  createdAt: Date;
}
