import { Field, InputType, Int } from '@nestjs/graphql';
import { IssueStatusEnum } from '../models/issue.model';

@InputType()
export class CreateIssueInput {
  @Field()
  projectId: string;

  @Field()
  title: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Int, { defaultValue: 2 })
  priority?: number;

  @Field(() => Int, { defaultValue: 1 })
  type?: number;

  @Field(() => Int, { defaultValue: 3 })
  storyPoints?: number;

  @Field({ nullable: true })
  sprintId?: string;

  @Field({ nullable: true })
  assigneeId?: string;

  @Field({ nullable: true })
  acceptanceCriteria?: string;
}

@InputType()
export class UpdateIssueStatusInput {
  @Field()
  id: string;

  @Field(() => IssueStatusEnum)
  status: IssueStatusEnum;
}

@InputType()
export class AssignIssuesToSprintInput {
  @Field()
  sprintId: string;

  @Field(() => [String])
  issueIds: string[];
}
