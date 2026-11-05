import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('AiStory')
export class AiStoryModel {
  @Field()
  title: string;

  @Field()
  description: string;

  @Field()
  type: string;

  @Field(() => Int)
  estimatedStoryPoints: number;

  @Field()
  acceptanceCriteriaGherkin: string;
}

@ObjectType('AiDecomposition')
export class AiDecompositionModel {
  @Field()
  epicTitle: string;

  @Field(() => [AiStoryModel])
  stories: AiStoryModel[];
}

@ObjectType('AiSprintPlan')
export class AiSprintPlanModel {
  @Field()
  sprintGoal: string;

  @Field(() => Int)
  allocatedStoryPoints: number;

  @Field(() => [String])
  recommendedIssueIds: string[];

  @Field()
  riskAssessment: string;
}

@ObjectType('AiDiagnosis')
export class AiDiagnosisModel {
  @Field()
  sprintId: string;

  @Field()
  healthStatus: string;

  @Field()
  summary: string;

  @Field(() => [String])
  rootCauses: string[];

  @Field(() => [String])
  recommendations: string[];
}
