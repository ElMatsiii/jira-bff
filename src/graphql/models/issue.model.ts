import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum IssueStatusEnum {
  UNSPECIFIED = 0,
  TODO = 1,
  IN_PROGRESS = 2,
  IN_REVIEW = 3,
  DONE = 4,
}

registerEnumType(IssueStatusEnum, {
  name: 'IssueStatusEnum',
  description: 'Status of an agile issue card',
});

@ObjectType('Issue')
export class IssueModel {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  key?: string;

  @Field()
  projectId: string;

  @Field()
  title: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => IssueStatusEnum)
  status: IssueStatusEnum;

  @Field(() => Int, { defaultValue: 2 })
  priority: number;

  @Field(() => Int, { defaultValue: 1 })
  type: number;

  @Field(() => Int, { defaultValue: 0 })
  storyPoints: number;

  @Field({ nullable: true })
  sprintId?: string;

  @Field({ nullable: true, description: 'Parent epic (an EPIC of the same project); null when the issue has none.' })
  parentId?: string;

  @Field({ nullable: true })
  assigneeId?: string;

  @Field({ nullable: true })
  reporterId?: string;

  @Field({ nullable: true })
  acceptanceCriteria?: string;

  @Field(() => String, { nullable: true })
  createdAt?: string;

  @Field(() => String, { nullable: true })
  updatedAt?: string;
}
