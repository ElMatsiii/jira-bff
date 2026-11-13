import { Field, InputType, Int } from '@nestjs/graphql';

@InputType()
export class DecomposeEpicInput {
  @Field()
  projectId: string;

  @Field()
  epicTitle: string;

  @Field({ nullable: true })
  epicDescription?: string;

  @Field({ nullable: true })
  projectKey?: string;
}

@InputType()
export class PlanSprintInput {
  @Field()
  projectId: string;

  @Field()
  sprintGoal: string;

  @Field(() => Int, { defaultValue: 30 })
  teamCapacityStoryPoints: number;

  @Field(() => [String], { nullable: true })
  candidateIssueIds?: string[];
}

@InputType()
export class DiagnoseMetricsInput {
  @Field()
  projectId: string;

  @Field()
  sprintId: string;

  @Field(() => Int, { defaultValue: 0 })
  blockedIssuesCount?: number;
}

@InputType()
export class ImproveStoryInput {
  @Field()
  projectId: string;

  @Field()
  title: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true, defaultValue: 'STORY' })
  type?: string;
}

@InputType()
export class BreakdownTaskInput {
  @Field()
  projectId: string;

  @Field()
  title: string;

  @Field({ nullable: true })
  description?: string;
}
