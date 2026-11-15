import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('BurndownAnalytics')
export class AnalyticsModel {
  @Field(() => ID)
  sprintId: string;

  @Field(() => Float)
  velocity: number;

  @Field(() => Int, {
    nullable: true,
    description: 'Closed sprints averaged in velocity. 0 = no closed sprints yet; null = unknown (analytics unavailable).',
  })
  velocitySampleSize: number | null;

  @Field(() => [Int], { description: 'Ideal remaining story points, one value per sprint day.' })
  idealBurndown: number[];

  @Field(() => [Int], {
    nullable: 'items',
    description: 'Actual remaining story points, aligned with idealBurndown; null for days that have not happened yet.',
  })
  actualBurndown: (number | null)[];

  @Field(() => Int)
  blockedCount: number;

  @Field({ description: 'Classified by MS3: HEALTHY, AT_RISK, CRITICAL, NOT_STARTED, NO_SCOPE, or UNAVAILABLE.' })
  healthStatus: string;
}
