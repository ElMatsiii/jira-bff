import { Field, InputType, Int } from '@nestjs/graphql';

@InputType()
export class DecomposeEpicInput {
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
  sprintGoal: string;

  @Field(() => Int, { defaultValue: 30 })
  teamCapacityStoryPoints: number;

  @Field(() => [String], { nullable: true })
  candidateIssueIds?: string[];
}

@InputType()
export class DiagnoseMetricsInput {
  @Field()
  sprintId: string;

  @Field(() => Int, { defaultValue: 0 })
  blockedIssuesCount?: number;
}
