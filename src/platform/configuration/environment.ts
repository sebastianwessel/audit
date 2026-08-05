import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import {
  ModelCostCeilingUsdSchema,
  ModelPricingSchema,
} from '../../features/model-operations/model-operations.schema.js';
import { catalogueModelPricing } from '../../features/model-operations/model-pricing-catalogue.js';
import { MaxParallelVectorsSchema } from '../../shared/contracts/concurrency.js';
import { ModelIdentifierSchema } from '../../shared/contracts/model-identity.js';

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export const ProviderNameSchema = z.enum(['openai', 'anthropic']);
export type ProviderName = z.infer<typeof ProviderNameSchema>;
export { MaxParallelVectorsSchema } from '../../shared/contracts/concurrency.js';
export const VerificationModeSchema = z.enum(['same-route', 'independent-route']);
export type VerificationMode = z.infer<typeof VerificationModeSchema>;

const EnvironmentVariableNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u);

export const IndependentVerifierRouteSchema = z.strictObject({
  provider: ProviderNameSchema,
  model: ModelIdentifierSchema,
  apiKeyEnvironmentVariable: EnvironmentVariableNameSchema,
  modelPricing: ModelPricingSchema,
});
export type IndependentVerifierRoute = z.infer<typeof IndependentVerifierRouteSchema>;

export const RuntimeConfigurationSchema = z
  .strictObject({
    provider: ProviderNameSchema.optional(),
    model: ModelIdentifierSchema.optional(),
    apiKeyEnvironmentVariable: z.string().trim().min(1).max(160).optional(),
    publicArtifactDirectory: z.string().trim().min(1).max(1_024),
    privateWorkDirectory: z.string().trim().min(1).max(1_024),
    evaluationCorpusRoot: z.string().trim().min(1).max(1_024),
    evaluationOutputRoot: z.string().trim().min(1).max(1_024),
    maxParallelVectors: MaxParallelVectorsSchema,
    maxEstimatedCostUsd: ModelCostCeilingUsdSchema.optional(),
    modelPricing: ModelPricingSchema,
    verificationMode: VerificationModeSchema,
    independentVerifierRoute: IndependentVerifierRouteSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.verificationMode !== 'independent-route') return;
    if (value.provider === undefined || value.model === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['verificationMode'],
        message: 'independent-route requires a configured primary provider and model.',
      });
    }
    if (value.independentVerifierRoute === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['independentVerifierRoute'],
        message: 'independent-route requires a complete verifier route.',
      });
      return;
    }
    if (
      value.provider?.toLowerCase() === value.independentVerifierRoute.provider.toLowerCase() &&
      value.model?.trim().toLowerCase() ===
        value.independentVerifierRoute.model.trim().toLowerCase()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['independentVerifierRoute'],
        message: 'The verifier provider/model pair must differ from the primary route.',
      });
    }
  });

export type RuntimeConfiguration = z.infer<typeof RuntimeConfigurationSchema>;
export type LoadedRuntimeConfiguration = Readonly<{
  configuration: RuntimeConfiguration;
  environment: EnvironmentSource;
}>;

export type RuntimeConfigurationOptions = Readonly<{
  cwd?: string;
  environment?: EnvironmentSource;
  loadDotEnv?: boolean;
}>;

const RemovedEnvironmentVariableNames = [
  'AUDIT_ARTIFACT_DIR',
  'AUDIT_COST_INPUT_PER_MILLION',
  'AUDIT_COST_CACHED_INPUT_PER_MILLION',
  'AUDIT_COST_OUTPUT_PER_MILLION',
] as const;

/** Loads the project-local optional .env file without ever logging its values. */
export async function loadRuntimeConfiguration(
  options: RuntimeConfigurationOptions = {},
): Promise<LoadedRuntimeConfiguration> {
  const processEnvironment = options.environment ?? process.env;
  const dotEnv =
    options.loadDotEnv === false
      ? {}
      : await readOptionalDotEnv(join(options.cwd ?? process.cwd(), '.env'));
  const environment = Object.freeze({ ...processEnvironment, ...dotEnv });
  assertNoRetiredEnvironmentVariables(environment);
  const provider = optionalValue(environment, 'AUDIT_PROVIDER');
  const model = optionalValue(environment, 'AUDIT_MODEL');
  const verificationMode = VerificationModeSchema.parse(
    optionalValue(environment, 'AUDIT_VERIFICATION_MODE') ?? 'same-route',
  );
  return Object.freeze({
    configuration: RuntimeConfigurationSchema.parse({
      provider,
      model,
      apiKeyEnvironmentVariable: optionalValue(environment, 'AUDIT_API_KEY_ENV'),
      publicArtifactDirectory:
        optionalValue(environment, 'AUDIT_PUBLIC_ARTIFACT_DIR') ?? '.audit-artifacts',
      privateWorkDirectory: optionalValue(environment, 'AUDIT_PRIVATE_WORK_DIR') ?? '.audit-work',
      evaluationCorpusRoot:
        optionalValue(environment, 'AUDIT_EVALUATION_CORPUS_ROOT') ?? 'evaluation/data/corpora',
      evaluationOutputRoot:
        optionalValue(environment, 'AUDIT_EVALUATION_OUTPUT_ROOT') ?? 'evaluation/runs',
      maxParallelVectors: optionalInteger(environment, 'AUDIT_MAX_PARALLEL_VECTORS') ?? 1,
      maxEstimatedCostUsd: optionalDecimal(environment, 'AUDIT_MAX_ESTIMATED_COST_USD'),
      modelPricing: catalogueModelPricing({ provider, model }),
      verificationMode,
      ...(verificationMode === 'independent-route'
        ? {
            independentVerifierRoute: {
              provider: ProviderNameSchema.parse(
                requiredEnvironmentValue(environment, 'AUDIT_VERIFIER_PROVIDER'),
              ),
              model: requiredEnvironmentValue(environment, 'AUDIT_VERIFIER_MODEL'),
              apiKeyEnvironmentVariable: requiredEnvironmentValue(
                environment,
                'AUDIT_VERIFIER_API_KEY_ENV',
              ),
              modelPricing: catalogueModelPricing({
                provider: requiredEnvironmentValue(environment, 'AUDIT_VERIFIER_PROVIDER'),
                model: requiredEnvironmentValue(environment, 'AUDIT_VERIFIER_MODEL'),
              }),
            },
          }
        : {}),
    }),
    environment,
  });
}

function assertNoRetiredEnvironmentVariables(environment: EnvironmentSource): void {
  const retiredVariable = Object.keys(environment).find(
    (variable) =>
      variable.startsWith('SECURITY_REVIEWER_') ||
      (RemovedEnvironmentVariableNames as readonly string[]).includes(variable),
  );
  if (retiredVariable !== undefined) {
    throw new TypeError(
      `${retiredVariable} has been removed. Use the AUDIT_* configuration names and bundled model pricing.`,
    );
  }
}

async function readOptionalDotEnv(path: string): Promise<EnvironmentSource> {
  try {
    return parseDotEnv(await readFile(path, 'utf8'));
  } catch (error) {
    if (isMissingFile(error)) return {};
    throw error;
  }
}

export function parseDotEnv(content: string): EnvironmentSource {
  const values: Record<string, string> = {};
  for (const [index, rawLine] of content.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) throw new TypeError(`Invalid .env line ${index + 1}.`);
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      throw new TypeError(`Invalid .env line ${index + 1}.`);
    }
    const value = line.slice(separator + 1).trim();
    values[key] = value.replace(/^"|"$/gu, '').replace(/^'|'$/gu, '');
  }
  return values;
}

function optionalValue(environment: EnvironmentSource, key: string): string | undefined {
  const value = environment[key]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function requiredEnvironmentValue(environment: EnvironmentSource, key: string): string {
  const value = optionalValue(environment, key);
  if (value === undefined) throw new TypeError(`${key} is required for independent-route.`);
  return value;
}

function optionalInteger(environment: EnvironmentSource, key: string): number | undefined {
  const value = optionalValue(environment, key);
  if (value === undefined) return undefined;
  if (!/^\d+$/u.test(value)) throw new TypeError(`${key} must be a positive integer.`);
  return Number(value);
}

function optionalDecimal(environment: EnvironmentSource, key: string): number | undefined {
  const value = optionalValue(environment, key);
  if (value === undefined) return undefined;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
    throw new TypeError(`${key} must be a positive decimal.`);
  }
  return ModelCostCeilingUsdSchema.parse(Number(value));
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
