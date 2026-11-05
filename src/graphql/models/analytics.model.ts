import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('BurndownAnalytics')
export class AnalyticsModel {
  @Field(() => ID)
  sprintId: string;

  @Field(() => Float)
  velocity: number;

  @Field(() => [Int])
  idealBurndown: number[];

  @Field(() => [Int])
  actualBurndown: number[];

  @Field(() => Int)
  blockedCount: number;

  @Field()
  healthStatus: string;
}
