import { Resolver, Query, Mutation, Args, ID, Context } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { IssuesGrpcClient } from '../../grpc/issues-grpc.client';
import { IssueModel, IssueStatusEnum } from '../models/issue.model';
import { AssignIssuesToSprintInput, CreateIssueInput, UpdateIssueStatusInput } from '../dto/issue.inputs';
import { CreateIssueRequest, Issue } from 'jira-contracts/gen/ts';
import { GqlAuthGuard } from '../../identity/gql-auth.guard';
import { IdentityService } from '../../identity/identity.service';
import { UserModel } from '../../identity/identity.models';
import { SprintsGrpcClient } from '../../grpc/sprints-grpc.client';
import { translateParentEpicError, translateStatusUpdateError } from '../../identity/ms1-errors';

@Resolver(() => IssueModel)
@UseGuards(GqlAuthGuard)
export class IssuesResolver {
  constructor(
    private readonly issuesClient: IssuesGrpcClient,
    private readonly identity: IdentityService,
    private readonly sprintsClient: SprintsGrpcClient,
  ) {}

  @Query(() => IssueModel, { name: 'getIssue' })
  async getIssue(
    @Args('id', { type: () => ID }) id: string,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<IssueModel> {
    const issue = await this.issuesClient.getIssue(id);
    await this.identity.assertProjectAccess(request.user.id, issue.projectId);
    return this.mapToModel(issue);
  }

  @Query(() => [IssueModel], { name: 'listIssues' })
  async listIssues(
    @Args('projectId') projectId: string,
    @Args('sprintId', { nullable: true }) sprintId: string | undefined,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<IssueModel[]> {
    await this.identity.assertProjectAccess(request.user.id, projectId);
    const issues = await this.issuesClient.listIssues(projectId, sprintId);
    return (issues || []).map((i) => this.mapToModel(i));
  }

  @Mutation(() => IssueModel, { name: 'createIssue' })
  async createIssue(
    @Args('input') input: CreateIssueInput,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<IssueModel> {
    await this.identity.assertProjectAccess(request.user.id, input.projectId);
    const req: CreateIssueRequest = {
      projectId: input.projectId,
      title: input.title,
      description: input.description || '',
      priority: input.priority || 2,
      type: input.type || 1,
      storyPoints: input.storyPoints || 0,
      sprintId: input.sprintId || '',
      assigneeId: input.assigneeId || '',
      reporterId: request.user.id,
      acceptanceCriteria: input.acceptanceCriteria || '',
      parentId: input.parentId || '',
    };
    const issue = await this.issuesClient.createIssue(req).catch((err) => {
      throw translateParentEpicError(err);
    });
    return this.mapToModel(issue);
  }

  @Mutation(() => IssueModel, { name: 'updateIssueStatus' })
  async updateIssueStatus(
    @Args('input') input: UpdateIssueStatusInput,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<IssueModel> {
    const currentIssue = await this.issuesClient.getIssue(input.id).catch((err) => {
      throw translateStatusUpdateError(err);
    });
    await this.identity.assertProjectAccess(request.user.id, currentIssue.projectId);
    const issue = await this.issuesClient.updateIssueStatus(input.id, input.status as number).catch((err) => {
      throw translateStatusUpdateError(err);
    });
    return this.mapToModel(issue);
  }

  @Mutation(() => [IssueModel], { name: 'assignIssuesToSprint' })
  async assignIssuesToSprint(
    @Args('input') input: AssignIssuesToSprintInput,
    @Context('req') request: Request & { user: UserModel },
  ): Promise<IssueModel[]> {
    if (!input.issueIds.length) return [];
    const sprint = await this.sprintsClient.getSprint(input.sprintId);
    await this.identity.assertProjectAccess(request.user.id, sprint.projectId);
    const issues = await Promise.all(input.issueIds.map((id) => this.issuesClient.getIssue(id)));
    if (issues.some((issue) => issue.projectId !== sprint.projectId)) {
      throw new BadRequestException('Todas las historias deben pertenecer al proyecto del sprint.');
    }
    const updated = await this.issuesClient.assignIssuesToSprint(input.issueIds, input.sprintId);
    return updated.map((issue) => this.mapToModel(issue));
  }

  private mapToModel(issue: Issue): IssueModel {
    return {
      id: issue.id,
      key: issue.key || '',
      projectId: issue.projectId || '',
      title: issue.title || '',
      description: issue.description || '',
      status: (issue.status as unknown) as IssueStatusEnum,
      priority: issue.priority || 2,
      type: issue.type || 1,
      storyPoints: issue.storyPoints || 0,
      sprintId: issue.sprintId || '',
      parentId: issue.parentId || undefined,
      assigneeId: issue.assigneeId || '',
      reporterId: issue.reporterId || '',
      reporterName: issue.reporterName || undefined,
      acceptanceCriteria: issue.acceptanceCriteria || '',
      createdAt: issue.createdAt ? new Date(Number(issue.createdAt)).toISOString() : new Date().toISOString(),
      updatedAt: issue.updatedAt ? new Date(Number(issue.updatedAt)).toISOString() : new Date().toISOString(),
    };
  }
}
