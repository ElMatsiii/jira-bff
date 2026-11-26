import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('AiStory')
export class AiStoryModel {
  @Field()
  title: string;

  @Field()
  description: string;

  @Field()
  type: string;

  @Field({ description: 'Suggested priority: LOW, MEDIUM, HIGH or CRITICAL' })
  priority: string;

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

@ObjectType()
export class AiStoryImprovementModel {
  @Field(() => Int)
  storyPoints: number;

  @Field(() => Float)
  confidence: number;

  @Field()
  reasoning: string;

  @Field(() => [String])
  complexityFactors: string[];

  @Field()
  acceptanceCriteriaGherkin: string;
}

@ObjectType('AiSuggestedSubtask')
export class AiSuggestedSubtaskModel {
  @Field()
  title: string;

  @Field()
  description: string;

  @Field()
  type: string;

  @Field()
  priority: string;

  @Field(() => Int)
  estimatedStoryPoints: number;

  @Field({ nullable: true })
  acceptanceCriteriaGherkin?: string;
}

@ObjectType('AiBreakdownTask')
export class AiBreakdownTaskModel {
  @Field()
  parentTitle: string;

  @Field(() => [AiSuggestedSubtaskModel])
  subtasks: AiSuggestedSubtaskModel[];
}

@ObjectType('AiProjectRetrospective')
export class AiProjectRetrospectiveModel {
  @Field(() => ID)
  projectId: string;

  @Field()
  summary: string;

  @Field(() => [String])
  strengths: string[];

  @Field(() => [String])
  areasForImprovement: string[];

  @Field(() => [String])
  actionableRecommendations: string[];
}
