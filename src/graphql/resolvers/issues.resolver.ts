import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { IssuesGrpcClient } from '../../grpc/issues-grpc.client';
import { IssueModel, IssueStatusEnum } from '../models/issue.model';
import { CreateIssueInput, UpdateIssueStatusInput } from '../dto/issue.inputs';
import { CreateIssueRequest, Issue } from 'jira-contracts/gen/ts';

@Resolver(() => IssueModel)
export class IssuesResolver {
  constructor(private readonly issuesClient: IssuesGrpcClient) {}

  @Query(() => IssueModel, { name: 'getIssue' })
  async getIssue(@Args('id', { type: () => ID }) id: string): Promise<IssueModel> {
    const issue = await this.issuesClient.getIssue(id);
    return this.mapToModel(issue);
  }

  @Query(() => [IssueModel], { name: 'listIssues' })
  async listIssues(
    @Args('projectId') projectId: string,
    @Args('sprintId', { nullable: true }) sprintId?: string,
  ): Promise<IssueModel[]> {
    const issues = await this.issuesClient.listIssues(projectId, sprintId);
    return (issues || []).map((i) => this.mapToModel(i));
  }

  @Mutation(() => IssueModel, { name: 'createIssue' })
  async createIssue(@Args('input') input: CreateIssueInput): Promise<IssueModel> {
    const req: CreateIssueRequest = {
      projectId: input.projectId,
      title: input.title,
      description: input.description || '',
      priority: input.priority || 2,
      type: input.type || 1,
      storyPoints: input.storyPoints || 0,
      sprintId: input.sprintId || '',
      assigneeId: input.assigneeId || '',
      reporterId: 'user-default',
      acceptanceCriteria: input.acceptanceCriteria || '',
    };
    const issue = await this.issuesClient.createIssue(req);
    return this.mapToModel(issue);
  }

  @Mutation(() => IssueModel, { name: 'updateIssueStatus' })
  async updateIssueStatus(@Args('input') input: UpdateIssueStatusInput): Promise<IssueModel> {
    const issue = await this.issuesClient.updateIssueStatus(input.id, input.status as number);
    return this.mapToModel(issue);
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
      assigneeId: issue.assigneeId || '',
      reporterId: issue.reporterId || '',
      acceptanceCriteria: issue.acceptanceCriteria || '',
      createdAt: issue.createdAt ? new Date(Number(issue.createdAt)).toISOString() : new Date().toISOString(),
      updatedAt: issue.updatedAt ? new Date(Number(issue.updatedAt)).toISOString() : new Date().toISOString(),
    };
  }
}
