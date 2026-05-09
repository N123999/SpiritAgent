import type { EvalScenario } from './types.js';

export interface EvalValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateEvalScenario(value: unknown): EvalValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return {
      valid: false,
      errors: ['scenario must be an object'],
    };
  }

  requireNonEmptyString(value, 'id', errors);
  requireNonEmptyString(value, 'title', errors);
  requireNonEmptyString(value, 'userPrompt', errors);

  if (!isRecord(value.rubric)) {
    errors.push('rubric must be an object');
  } else {
    requireNonEmptyString(value.rubric, 'id', errors, 'rubric');
    requireNonEmptyString(value.rubric, 'title', errors, 'rubric');

    if (!Array.isArray(value.rubric.criteria) || value.rubric.criteria.length === 0) {
      errors.push('rubric.criteria must be a non-empty array');
    } else {
      value.rubric.criteria.forEach((criterion, index) => {
        if (!isRecord(criterion)) {
          errors.push(`rubric.criteria[${index}] must be an object`);
          return;
        }

        const prefix = `rubric.criteria[${index}]`;
        requireNonEmptyString(criterion, 'id', errors, prefix);
        requireNonEmptyString(criterion, 'label', errors, prefix);
        requireNonEmptyString(criterion, 'description', errors, prefix);

        if (typeof criterion.weight !== 'number' || !Number.isFinite(criterion.weight) || criterion.weight <= 0) {
          errors.push(`${prefix}.weight must be a positive number`);
        }

        if (!isRecord(criterion.scale)) {
          errors.push(`${prefix}.scale must be an object`);
          return;
        }

        if (typeof criterion.scale.min !== 'number' || typeof criterion.scale.max !== 'number') {
          errors.push(`${prefix}.scale min/max must be numbers`);
          return;
        }

        if (criterion.scale.min >= criterion.scale.max) {
          errors.push(`${prefix}.scale.min must be less than scale.max`);
        }
      });
    }
  }

  validateStringArray(value, 'expectedDeliverables', errors);
  validateStringArray(value, 'constraints', errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function assertEvalScenario(value: unknown): asserts value is EvalScenario {
  const result = validateEvalScenario(value);
  if (!result.valid) {
    throw new Error(`Invalid EvalScenario:\n${result.errors.map((error) => `- ${error}`).join('\n')}`);
  }
}

function requireNonEmptyString(
  value: Record<string, unknown>,
  field: string,
  errors: string[],
  prefix?: string,
): void {
  if (typeof value[field] !== 'string' || !value[field].trim()) {
    errors.push(`${prefix ? `${prefix}.` : ''}${field} must be a non-empty string`);
  }
}

function validateStringArray(value: Record<string, unknown>, field: string, errors: string[]): void {
  const entry = value[field];
  if (entry === undefined) {
    return;
  }

  if (!Array.isArray(entry) || entry.some((item) => typeof item !== 'string' || !item.trim())) {
    errors.push(`${field} must be an array of non-empty strings`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
