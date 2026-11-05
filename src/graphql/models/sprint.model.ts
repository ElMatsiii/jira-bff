import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum SprintStatusEnum {
  UNSPECIFIED = 0,
  PLANNED = 1,
  ACTIVE = 2,
  COMPLETED = 3,
  CANCELLED = 4,
}

registerEnumType(SprintStatusEnum, {
  name: 'SprintStatusEnum',
  description: 'Lifecycle state of a sprint',
});

@ObjectType('Sprint')
export class SprintModel {
  @Field(() => ID)
  id: string;

  @Field()
  projectId: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  goal?: string;

  @Field(() => String, { nullable: true })
  startDate?: string;

  @Field(() => String, { nullable: true })
  endDate?: string;

  @Field(() => SprintStatusEnum)
  status: SprintStatusEnum;

  @Field(() => Int, { defaultValue: 0 })
  totalStoryPoints: number;

  @Field(() => Int, { defaultValue: 0 })
  completedStoryPoints: number;
}
