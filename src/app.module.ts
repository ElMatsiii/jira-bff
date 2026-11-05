import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ConfigModule } from './config/config.module';
import { IssuesGrpcClient } from './grpc/issues-grpc.client';
import { SprintsGrpcClient } from './grpc/sprints-grpc.client';
import { KafkaAnalyticsClient } from './kafka/kafka-analytics.client';
import { McpAgentClient } from './mcp/mcp-agent.client';
import { IssuesResolver } from './graphql/resolvers/issues.resolver';
import { SprintsResolver } from './graphql/resolvers/sprints.resolver';
import { AnalyticsResolver } from './graphql/resolvers/analytics.resolver';
import { AiResolver } from './graphql/resolvers/ai.resolver';

@Module({
  imports: [
    ConfigModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      playground: true,
      path: '/graphql',
    }),
  ],
  providers: [
    IssuesGrpcClient,
    SprintsGrpcClient,
    KafkaAnalyticsClient,
    McpAgentClient,
    IssuesResolver,
    SprintsResolver,
    AnalyticsResolver,
    AiResolver,
  ],
})
export class AppModule {}
