import { Resolver, Query, Args, Float, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { KafkaAnalyticsClient } from '../../kafka/kafka-analytics.client';
import { AnalyticsModel } from '../models/analytics.model';
import { GqlAuthGuard } from '../../identity/gql-auth.guard';
import { IdentityService } from '../../identity/identity.service';
import { UserModel } from '../../identity/identity.models';
import { SprintsGrpcClient } from '../../grpc/sprints-grpc.client';

@Resolver(() => AnalyticsModel)
@UseGuards(GqlAuthGuard)
export class AnalyticsResolver {
  constructor(
    private readonly analyticsClient: KafkaAnalyticsClient,
    private readonly identity: IdentityService,
    private readonly sprintsClient: SprintsGrpcClient,
  ) {}

  @Query(() => AnalyticsModel, { name: 'getBurndownAnalytics' })
  async getBurndownAnalytics(
    @Args('sprintId') sprintId: string,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<AnalyticsModel> {
    const sprint = await this.sprintsClient.getSprint(sprintId);
    await this.identity.assertProjectAccess(request.user.id, sprint.projectId);
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
  async getTeamVelocity(
    @Args('teamId') teamId: string,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<number> {
    await this.identity.assertWorkspaceAccess(request.user.id, teamId);
    return this.analyticsClient.getTeamVelocity(teamId);
  }
}
