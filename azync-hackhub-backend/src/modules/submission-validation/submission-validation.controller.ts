import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ValidateSubmissionDraftDto } from './dto/validate-submission-draft.dto';
import { SubmissionValidationService } from './submission-validation.service';

@Controller('submission-validation')
@UseGuards(JwtAuthGuard)
export class SubmissionValidationController {
  constructor(private readonly service: SubmissionValidationService) {}

  @Post('draft')
  validate(@Body() dto: ValidateSubmissionDraftDto, @Req() req: any) {
    return this.service.validateDraft(dto, req.user.id);
  }
}
