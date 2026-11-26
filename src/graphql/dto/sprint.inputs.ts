import { Field, InputType, Int } from '@nestjs/graphql';

@InputType()
export class CreateSprintInput {
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

  @Field(() => Int, { nullable: true })
  capacityStoryPoints?: number;
}
