/**
 * Sprint health classification derived from MS3's healthScore (0-100).
 *
 * MS3 does not send a classification yet, so the BFF derives it here, in one place.
 * TODO(paso 8): move this rule to MS3 (it belongs to the analytics domain), send it in
 * analytics.reply and make the BFF use MS3's value instead of computing it.
 */
export type SprintHealthStatus = 'HEALTHY' | 'AT_RISK' | 'CRITICAL' | 'UNAVAILABLE';

/** Score at or above which a sprint is HEALTHY. */
export const HEALTH_SCORE_HEALTHY_MIN = 75;
/** Score at or above which (and below HEALTHY) a sprint is AT_RISK; below it, CRITICAL. */
export const HEALTH_SCORE_AT_RISK_MIN = 50;

/** Status returned when MS3 did not answer, failed, or sent no usable score. */
export const HEALTH_STATUS_UNAVAILABLE: SprintHealthStatus = 'UNAVAILABLE';

export function classifyHealthScore(score: unknown): SprintHealthStatus {
  if (typeof score !== 'number' || !Number.isFinite(score)) return HEALTH_STATUS_UNAVAILABLE;
  if (score >= HEALTH_SCORE_HEALTHY_MIN) return 'HEALTHY';
  if (score >= HEALTH_SCORE_AT_RISK_MIN) return 'AT_RISK';
  return 'CRITICAL';
}
