import {
  AnyMetric,
  BaseMetric,
  BaseMetricValue,
  EnvironmentalMetric,
  environmentalMetrics,
  EnvironmentalMetricValue,
  Metric,
  MetricValue,
  TemporalMetric,
  temporalMetrics,
  TemporalMetricValue
} from './models';
import { validate } from './validator';

// https://www.first.org/cvss/v3.1/specification-document#7-4-Metric-Values
const baseMetricValueScores: Record<BaseMetric, Partial<Record<BaseMetricValue, number>> | null> = {
  [BaseMetric.ATTACK_VECTOR]: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  [BaseMetric.ATTACK_COMPLEXITY]: { L: 0.77, H: 0.44 },
  [BaseMetric.PRIVILEGES_REQUIRED]: null, // scope-dependent: see getPrivilegesRequiredNumericValue()
  [BaseMetric.USER_INTERACTION]: { N: 0.85, R: 0.62 },
  [BaseMetric.SCOPE]: { U: 0, C: 0 },
  [BaseMetric.CONFIDENTIALITY]: { N: 0, L: 0.22, H: 0.56 },
  [BaseMetric.INTEGRITY]: { N: 0, L: 0.22, H: 0.56 },
  [BaseMetric.AVAILABILITY]: { N: 0, L: 0.22, H: 0.56 }
};

const temporalMetricValueScores: Record<TemporalMetric, Partial<Record<TemporalMetricValue, number>> | null> = {
  [TemporalMetric.EXPLOITABILITY]: { X: 1, U: 0.91, F: 0.97, P: 0.94, H: 1 },
  [TemporalMetric.REMEDIATION_LEVEL]: { X: 1, O: 0.95, T: 0.96, W: 0.97, U: 1 },
  [TemporalMetric.REPORT_CONFIDENCE]: { X: 1, U: 0.92, R: 0.96, C: 1 }
};

const environmentalMetricValueScores: Record<EnvironmentalMetric, Partial<Record<EnvironmentalMetricValue, number>> | null> = {
  [EnvironmentalMetric.ATTACK_VECTOR]: { N: 0.85, A: 0.62, L: 0.55, P: 0.2, X: 1 },
  [EnvironmentalMetric.ATTACK_COMPLEXITY]: { X: 1, L: 0.77, H: 0.44 },
  [EnvironmentalMetric.PRIVILEGES_REQUIRED]: null,
  [EnvironmentalMetric.USER_INTERACTION]: { N: 0.85, R: 0.62, X: 1 },
  [EnvironmentalMetric.SCOPE]: { U: 0, C: 0, X: 0 },
  [EnvironmentalMetric.CONFIDENTIALITY]: { N: 0, L: 0.22, H: 0.56, X: 0.22 },
  [EnvironmentalMetric.INTEGRITY]: { N: 0, L: 0.22, H: 0.56, X: 0.22 },
  [EnvironmentalMetric.AVAILABILITY]: { N: 0, L: 0.22, H: 0.56, X: 0.22 },
  [EnvironmentalMetric.CONFIDENTIALITY_REQUIREMENT]: { M: 1, L: 0.5, H: 1.5, X: 1 },
  [EnvironmentalMetric.INTEGRITY_REQUIREMENT]: { M: 1, L: 0.5, H: 1.5, X: 1 },
  [EnvironmentalMetric.AVAILABILITY_REQUIREMENT]: { M: 1, L: 0.5, H: 1.5, X: 1 }
};

const getPrivilegesRequiredNumericValue = (value: MetricValue, scopeValue: MetricValue): number => {
  if (scopeValue !== 'U' && scopeValue !== 'C' && scopeValue !== 'X') {
    throw new Error(`Unknown Scope value: ${scopeValue}`);
  }

  switch (value) {
    case 'N':
      return 0.85;
    case 'L':
      return scopeValue !== 'C' ? 0.62 : 0.68;
    case 'H':
      return scopeValue !== 'C' ? 0.27 : 0.5;
    default:
      throw new Error(`Unknown PrivilegesRequired value: ${value}`);
  }
};

const getMetricValue = (metric: Metric, metricsMap: Map<Metric, MetricValue>): MetricValue => {
  if (!metricsMap.has(metric)) {
    throw new Error(`Missing metric: ${metric}`);
  }

  return metricsMap.get(metric) as BaseMetricValue;
};

const getMetricNumericValue = (metric: Metric, metricsMap: Map<Metric, MetricValue>): number => {
  const value = getMetricValue(metric as AnyMetric, metricsMap);

  if (metric === BaseMetric.PRIVILEGES_REQUIRED) {
    return getPrivilegesRequiredNumericValue(value, getMetricValue(BaseMetric.SCOPE as AnyMetric, metricsMap));
  }
  if (metric === EnvironmentalMetric.PRIVILEGES_REQUIRED) {
    return getPrivilegesRequiredNumericValue(value, getMetricValue(EnvironmentalMetric.SCOPE as AnyMetric, metricsMap));
  }

  const score: Partial<Record<MetricValue, number>> | null = {
    ...baseMetricValueScores,
    ...temporalMetricValueScores,
    ...environmentalMetricValueScores
  }[metric];
  if (!score) {
    throw new Error(`Internal error. Missing metric score: ${metric}`);
  }

  return score[value]!;
};

// ISS = 1 - [ (1 - Confidentiality) × (1 - Integrity) × (1 - Availability) ]
export const calculateIss = (metricsMap: Map<Metric, MetricValue>): number => {
  const confidentiality = getMetricNumericValue(BaseMetric.CONFIDENTIALITY, metricsMap);
  const integrity = getMetricNumericValue(BaseMetric.INTEGRITY, metricsMap);
  const availability = getMetricNumericValue(BaseMetric.AVAILABILITY, metricsMap);

  return 1 - (1 - confidentiality) * (1 - integrity) * (1 - availability);
};
// https://www.first.org/cvss/v3.1/specification-document#7-3-Environmental-Metrics-Equations
// MISS =Minimum ( 1 - [ (1 - ConfidentialityRequirement × ModifiedConfidentiality) × (1 - IntegrityRequirement × ModifiedIntegrity) × (1 - AvailabilityRequirement × ModifiedAvailability) ],
// 0.915)
export const calculateMiss = (metricsMap: Map<Metric, MetricValue>): number => {
  const rConfidentiality = getMetricNumericValue(EnvironmentalMetric.CONFIDENTIALITY_REQUIREMENT, metricsMap);
  const mConfidentiality = getMetricNumericValue(EnvironmentalMetric.CONFIDENTIALITY, metricsMap);

  const rIntegrity = getMetricNumericValue(EnvironmentalMetric.INTEGRITY_REQUIREMENT, metricsMap);
  const mIntegrity = getMetricNumericValue(EnvironmentalMetric.INTEGRITY, metricsMap);

  const rAvailability = getMetricNumericValue(EnvironmentalMetric.AVAILABILITY_REQUIREMENT, metricsMap);
  const mAvailability = getMetricNumericValue(EnvironmentalMetric.AVAILABILITY, metricsMap);

  return Math.min(
    1 - (1 - rConfidentiality * mConfidentiality) * (1 - rIntegrity * mIntegrity) * (1 - rAvailability * mAvailability),
    0.915
  );
};

// https://www.first.org/cvss/v3.1/specification-document#7-1-Base-Metrics-Equations
// Impact =
//   If Scope is Unchanged 	6.42 × ISS
//   If Scope is Changed 	7.52 × (ISS - 0.029) - 3.25 × (ISS - 0.02)
export const calculateImpact = (metricsMap: Map<Metric, MetricValue>, iss: number): number =>
  metricsMap.get(BaseMetric.SCOPE) !== 'C' ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);

// https://www.first.org/cvss/v3.1/specification-document#7-3-Environmental-Metrics-Equations
// ModifiedImpact =
// If ModifiedScope is Unchanged	6.42 × MISS
// If ModifiedScope is Changed	7.52 × (MISS - 0.029) - 3.25 × (MISS × 0.9731 - 0.02)13
// ModifiedExploitability =	8.22 × ModifiedAttackVector × ModifiedAttackComplexity × ModifiedPrivilegesRequired × ModifiedUserInteraction
export const calculateMImpact = (metricsMap: Map<Metric, MetricValue>, miss: number): number =>
  metricsMap.get(EnvironmentalMetric.SCOPE) !== 'C'
    ? 6.42 * miss
    : 7.52 * (miss - 0.029) - 3.25 * Math.pow(miss * 0.9731 - 0.02, 13);

// https://www.first.org/cvss/v3.1/specification-document#7-1-Base-Metrics-Equations
// Exploitability = 8.22 × AttackVector × AttackComplexity × PrivilegesRequired × UserInteraction
export const calculateExploitability = (metricsMap: Map<Metric, MetricValue>): number =>
  8.22 *
  getMetricNumericValue(BaseMetric.ATTACK_VECTOR, metricsMap) *
  getMetricNumericValue(BaseMetric.ATTACK_COMPLEXITY, metricsMap) *
  getMetricNumericValue(BaseMetric.PRIVILEGES_REQUIRED, metricsMap) *
  getMetricNumericValue(BaseMetric.USER_INTERACTION, metricsMap);

// https://www.first.org/cvss/v3.1/specification-document#7-3-Environmental-Metrics-Equations
// Exploitability = 8.22 × ModifiedAttackVector × ModifiedAttackComplexity × ModifiedPrivilegesRequired × ModifiedUserInteraction
export const calculateMExploitability = (metricsMap: Map<Metric, MetricValue>): number =>
  8.22 *
  getMetricNumericValue(EnvironmentalMetric.ATTACK_VECTOR, metricsMap) *
  getMetricNumericValue(EnvironmentalMetric.ATTACK_COMPLEXITY, metricsMap) *
  getMetricNumericValue(EnvironmentalMetric.PRIVILEGES_REQUIRED, metricsMap) *
  getMetricNumericValue(EnvironmentalMetric.USER_INTERACTION, metricsMap);

// https://www.first.org/cvss/v3.1/specification-document#Appendix-A---Floating-Point-Rounding
const roundUp = (input: number): number => {
  const intInput = Math.round(input * 100000);

  return intInput % 10000 === 0 ? intInput / 100000 : (Math.floor(intInput / 10000) + 1) / 10;
};

type ScoreResult = {
  score: number;
  impact: number;
  exploitability: number;
};

// https://www.first.org/cvss/v3.0/specification-document#7-3-Environmental-Metrics-Equations
// If ModifiedImpact <= 0 =>	0; else
// If ModifiedScope is	Roundup ( Roundup [Minimum ([ModifiedImpact + ModifiedExploitability], 10) ] × ExploitCodeMaturity × RemediationLevel × ReportConfidence)
// Unchanged
// If ModifiedScope is	Roundup (
//   Roundup [
//     Minimum (
//       1.08 × [ModifiedImpact + ModifiedExploitability], 10
//     )
//   ] × ExploitCodeMaturity × RemediationLevel × ReportConfidence)
// Changed
export const calculateEnvironmentalScore = (cvssString: string): ScoreResult => {
  const { metricsMap } = validate(cvssString);

  // populate temp and env metrics if not provided
  [...temporalMetrics, ...environmentalMetrics].map((metric) => {
    if (![...metricsMap.keys()].includes(metric)) {
      metricsMap.set(metric, 'X');
    }
  });

  const miss = calculateMiss(metricsMap);
  const impact = calculateMImpact(metricsMap, miss);
  const exploitability = calculateMExploitability(metricsMap);
  const scopeUnchanged = metricsMap.get(EnvironmentalMetric.SCOPE) !== 'C';

  const score =
    impact <= 0
      ? 0
      : scopeUnchanged
      ? roundUp(
          roundUp(Math.min(impact + exploitability, 10)) *
            getMetricNumericValue(TemporalMetric.EXPLOITABILITY, metricsMap) *
            getMetricNumericValue(TemporalMetric.REMEDIATION_LEVEL, metricsMap) *
            getMetricNumericValue(TemporalMetric.REPORT_CONFIDENCE, metricsMap)
        )
      : roundUp(
          roundUp(Math.min(1.08 * (impact + exploitability), 10)) *
            getMetricNumericValue(TemporalMetric.EXPLOITABILITY, metricsMap) *
            getMetricNumericValue(TemporalMetric.REMEDIATION_LEVEL, metricsMap) *
            getMetricNumericValue(TemporalMetric.REPORT_CONFIDENCE, metricsMap)
        );

  return {
    score,
    impact: impact <= 0 ? 0 : roundUp(impact),
    exploitability: impact <= 0 ? 0 : roundUp(exploitability)
  };
};

// https://www.first.org/cvss/v3.1/specification-document#7-1-Base-Metrics-Equations
// If Impact <= 0 => 0; else
// If Scope is Unchanged => Roundup (Minimum [(Impact + Exploitability), 10])
// If Scope is Changed => Roundup (Minimum [1.08 × (Impact + Exploitability), 10])
export const calculateBaseScore = (cvssString: string): ScoreResult => {
  const { metricsMap } = validate(cvssString);

  const iss = calculateIss(metricsMap);
  const impact = calculateImpact(metricsMap, iss);
  const exploitability = calculateExploitability(metricsMap);
  const scopeUnchanged = metricsMap.get(BaseMetric.SCOPE) !== 'C';

  const score =
    impact <= 0
      ? 0
      : scopeUnchanged
      ? roundUp(Math.min(impact + exploitability, 10))
      : roundUp(Math.min(1.08 * (impact + exploitability), 10));

  return {
    score,
    impact: impact <= 0 ? 0 : roundUp(impact),
    exploitability: impact <= 0 ? 0 : roundUp(exploitability)
  };
};

// https://www.first.org/cvss/v3.1/specification-document#7-2-Temporal-Metrics-Equations
// 	Roundup (BaseScore × ExploitCodeMaturity × RemediationLevel × ReportConfidence)
export const calculateTemporalScore = (cvssString: string): ScoreResult => {
  const { metricsMap } = validate(cvssString);
  // populate temp metrics if not provided
  [...temporalMetrics].map((metric) => {
    if (![...metricsMap.keys()].includes(metric)) {
      metricsMap.set(metric, 'X');
    }
  });

  const { score, impact, exploitability } = calculateBaseScore(cvssString);

  const tempScore = roundUp(
    score *
      getMetricNumericValue(TemporalMetric.REPORT_CONFIDENCE, metricsMap) *
      getMetricNumericValue(TemporalMetric.EXPLOITABILITY, metricsMap) *
      getMetricNumericValue(TemporalMetric.REMEDIATION_LEVEL, metricsMap)
  );

  return {
    score: tempScore,
    impact,
    exploitability
  };
};
