import { Injectable } from '@nestjs/common';
import type {
  HackathonRule,
  RubricCriterion,
  SubmissionAnalysisResponse,
} from '../schemas/submission-analysis.schema';

@Injectable()
export class AnalysisBusinessValidator {
  validate(
    analysis: SubmissionAnalysisResponse,
    rules: readonly HackathonRule[],
    rubric: readonly RubricCriterion[],
    evidenceIds: ReadonlySet<string>,
    verifiedEvidenceIds: ReadonlySet<string> = evidenceIds,
  ): string[] {
    const errors: string[] = [];
    const ruleIds = new Set(rules.map((rule) => rule.id));
    const rubricById = new Map(rubric.map((item) => [item.id, item]));

    this.validateCoverage(
      analysis.requirements.map((item) => item.requirementId),
      ruleIds,
      'requirementId',
      errors,
    );
    this.validateCoverage(
      analysis.rubricAnalysis.map((item) => item.rubricId),
      new Set(rubricById.keys()),
      'rubricId',
      errors,
    );

    for (const item of analysis.requirements) {
      this.validateEvidenceIds(item.evidenceIds, evidenceIds, errors);
      if (
        item.status === 'PASS' &&
        !item.evidenceIds.some((id) => verifiedEvidenceIds.has(id))
      ) {
        errors.push(`PASS requires verified evidence: ${item.requirementId}`);
      }
    }

    for (const item of analysis.rubricAnalysis) {
      const criterion = rubricById.get(item.rubricId);
      if (
        criterion &&
        (item.suggestedScore < criterion.minScore ||
          item.suggestedScore > criterion.maxScore)
      ) {
        errors.push(`Score outside bounds for ${item.rubricId}`);
      }
      this.validateEvidenceIds(item.evidenceIds, evidenceIds, errors);
      if (
        criterion &&
        item.suggestedScore > criterion.minScore &&
        !item.evidenceIds.some((id) => verifiedEvidenceIds.has(id))
      ) {
        errors.push(
          `Positive rubric finding requires verified evidence: ${item.rubricId}`,
        );
      }
    }
    return [...new Set(errors)];
  }

  private validateCoverage(
    actualIds: string[],
    expectedIds: ReadonlySet<string>,
    label: string,
    errors: string[],
  ): void {
    if (new Set(actualIds).size !== actualIds.length)
      errors.push(`Duplicate ${label}`);
    for (const id of actualIds) {
      if (!expectedIds.has(id)) errors.push(`Unknown ${label}: ${id}`);
    }
    for (const id of expectedIds) {
      if (!actualIds.includes(id)) errors.push(`Missing ${label}: ${id}`);
    }
  }

  private validateEvidenceIds(
    actualIds: string[],
    evidenceIds: ReadonlySet<string>,
    errors: string[],
  ): void {
    for (const id of actualIds) {
      if (!evidenceIds.has(id)) errors.push(`Unknown evidenceId: ${id}`);
    }
  }
}
