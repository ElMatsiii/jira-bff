import { Resolver, Query, Args, Float } from '@nestjs/graphql';
import { KafkaAnalyticsClient } from '../../kafka/kafka-analytics.client';
import { AnalyticsModel } from '../models/analytics.model';

@Resolver(() => AnalyticsModel)
export class AnalyticsResolver {
  constructor(private readonly analyticsClient: KafkaAnalyticsClient) {}

  @Query(() => AnalyticsModel, { name: 'getBurndownAnalytics' })
  async getBurndownAnalytics(@Args('sprintId') sprintId: string): Promise<AnalyticsModel> {
    const data = await this.analyticsClient.getBurndownAnalytics(sprintId);
    return {
      sprintId: data.sprintId,
      velocity: data.velocity,
      idealBurndown: data.idealBurndown,
      actualBurndown: data.actualBurndown,
      blockedCount: data.blockedCount,
      healthStatus: data.healthStatus,
    };
  }

  @Query(() => Float, { name: 'getTeamVelocity' })
  async getTeamVelocity(@Args('teamId') teamId: string): Promise<number> {
    return this.analyticsClient.getTeamVelocity(teamId);
  }
}
