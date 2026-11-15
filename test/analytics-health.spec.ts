import {
  classifyHealthScore,
  HEALTH_SCORE_AT_RISK_MIN,
  HEALTH_SCORE_HEALTHY_MIN,
  HEALTH_STATUS_UNAVAILABLE,
} from '../src/kafka/analytics-health';

describe('classifyHealthScore', () => {
  it('uses the agreed thresholds: >=75 HEALTHY, >=50 AT_RISK, <50 CRITICAL', () => {
    expect(HEALTH_SCORE_HEALTHY_MIN).toBe(75);
    expect(HEALTH_SCORE_AT_RISK_MIN).toBe(50);
  });

  it.each([
    [100, 'HEALTHY'],
    [75, 'HEALTHY'],
    [74.9, 'AT_RISK'],
    [50, 'AT_RISK'],
    [49.9, 'CRITICAL'],
    [0, 'CRITICAL'],
  ])('classifies %p as %p', (score, expected) => {
    expect(classifyHealthScore(score)).toBe(expected);
  });

  it.each([undefined, null, Number.NaN, '80', Infinity])('returns UNAVAILABLE for %p', (score) => {
    expect(classifyHealthScore(score)).toBe(HEALTH_STATUS_UNAVAILABLE);
  });
});
