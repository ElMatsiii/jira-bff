import { Field, Float, ID, Int, ObjectType, InputType } from '@nestjs/graphql';

@ObjectType()
export class UserModel {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  email: string;
}

@ObjectType()
export class WorkspaceModel {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  role: string;
}

@ObjectType()
export class ProjectModel {
  @Field(() => ID)
  id: string;

  @Field()
  workspaceId: string;

  @Field()
  name: string;

  @Field()
  key: string;

  @Field()
  description: string;
}

@ObjectType('ProjectMember')
export class ProjectMemberModel {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  email: string;

  @Field({ description: 'Role in the workspace: OWNER, ADMIN or MEMBER.' })
  role: string;

  @Field({ description: 'true when the access comes from an invitation (it can be removed); false for the OWNER and ADMINs.' })
  invited: boolean;
}

@InputType()
export class AddProjectMemberInput {
  @Field()
  projectId: string;

  @Field()
  email: string;
}

@InputType()
export class RemoveProjectMemberInput {
  @Field()
  projectId: string;

  @Field()
  userId: string;
}

@ObjectType()
export class AuthPayload {
  @Field()
  token: string;

  @Field(() => UserModel)
  user: UserModel;
}

@InputType()
export class RegisterInput {
  @Field()
  name: string;

  @Field()
  email: string;

  @Field()
  password: string;
}

@InputType()
export class LoginInput {
  @Field()
  email: string;

  @Field()
  password: string;
}

@InputType()
export class CreateProjectInput {
  @Field()
  workspaceId: string;

  @Field()
  name: string;

  @Field()
  key: string;

  @Field({ nullable: true })
  description?: string;
}

@InputType()
export class AddWorkspaceMemberInput {
  @Field()
  workspaceId: string;

  @Field()
  email: string;
}

@ObjectType()
export class WorkLogModel {
  @Field(() => ID)
  id: string;

  @Field()
  issueId: string;

  @Field()
  issueKey: string;

  @Field()
  issueTitle: string;

  @Field()
  userName: string;

  @Field(() => Float)
  hours: number;

  @Field()
  note: string;

  @Field()
  loggedAt: string;
}

@ObjectType()
export class WorkLogSummaryModel {
  @Field(() => Float)
  totalHours: number;

  @Field(() => [WorkLogModel])
  entries: WorkLogModel[];
}

@InputType()
export class LogWorkInput {
  @Field()
  projectId: string;

  @Field()
  issueId: string;

  @Field(() => Float)
  hours: number;

  @Field({ nullable: true })
  note?: string;
}
