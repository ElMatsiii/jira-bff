import { Resolver, Query, Args, Float, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Sprint, SprintStatus } from 'jira-contracts/gen/ts';
import { KafkaAnalyticsClient } from '../../kafka/kafka-analytics.client';
import { AnalyticsModel, ProjectVelocityTrendModel } from '../models/analytics.model';
import { GqlAuthGuard } from '../../identity/gql-auth.guard';
import { IdentityService } from '../../identity/identity.service';
import { UserModel } from '../../identity/identity.models';
import { SprintsGrpcClient } from '../../grpc/sprints-grpc.client';

/**
 * Sprint whose analytics represent the project's current pace: the active one, otherwise the
 * most recently finished one, otherwise the latest planned one.
 */
export function pickReferenceSprint(sprints: Sprint[]): Sprint | null {
  const byEndDesc = [...sprints].sort((a, b) => (b.endDate || 0) - (a.endDate || 0));
  return (
    sprints.find((s) => s.status === SprintStatus.SPRINT_STATUS_ACTIVE) ||
    byEndDesc.find((s) => s.status === SprintStatus.SPRINT_STATUS_COMPLETED) ||
    byEndDesc.find((s) => s.status !== SprintStatus.SPRINT_STATUS_CANCELLED) ||
    null
  );
}

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
    const data = await this.analyticsClient.getBurndownAnalytics(sprintId, sprint.projectId);
    return {
      sprintId: data.sprintId,
      velocity: data.velocity,
      velocitySampleSize: data.velocitySampleSize,
      idealBurndown: data.idealBurndown,
      actualBurndown: data.actualBurndown,
      blockedCount: data.blockedCount,
      healthStatus: data.healthStatus,
    };
  }

  /**
   * Rolling velocity of a project, as computed by MS3 (which tracks velocity per project).
   * Replaces getTeamVelocity(teamId), which sent a workspace id where MS3 expects a sprint id.
   * Returns null when the project has no sprints or MS3 is unavailable.
   */
  @Query(() => Float, { name: 'getProjectVelocity', nullable: true })
  async getProjectVelocity(
    @Args('projectId') projectId: string,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<number | null> {
    await this.identity.assertProjectAccess(request.user.id, projectId);
    const reference = pickReferenceSprint(await this.sprintsClient.listSprints(projectId));
    if (!reference) return null;
    return this.analyticsClient.getVelocity(reference.id, projectId);
  }

  @Query(() => ProjectVelocityTrendModel, { name: 'getProjectVelocityTrend', nullable: true })
  async getProjectVelocityTrend(
    @Args('projectId') projectId: string,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<ProjectVelocityTrendModel | null> {
    await this.identity.assertProjectAccess(request.user.id, projectId);
    const trend = await this.analyticsClient.getProjectTrend(projectId);
    if (!trend) return null;
    return {
      projectId: trend.projectId,
      velocity: trend.velocity,
      velocitySampleSize: trend.velocitySampleSize,
      totalPoints: trend.totalPoints,
      completedPoints: trend.completedPoints,
      velocityHistory: trend.velocityHistory,
    };
  }
}
