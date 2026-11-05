import { Injectable } from '@nestjs/common';

@Injectable()
export class ConfigService {
  get port(): number {
    return parseInt(process.env.PORT || '4000', 10);
  }

  get issuesGrpcUrl(): string {
    return process.env.ISSUES_GRPC_URL || 'localhost:50051';
  }

  get sprintsGrpcUrl(): string {
    return process.env.SPRINTS_GRPC_URL || 'localhost:50052';
  }

  get kafkaBrokers(): string[] {
    return (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
  }

  get kafkaClientId(): string {
    return process.env.KAFKA_CLIENT_ID || 'jira-bff-gateway';
  }

  get mcpAgentUrl(): string {
    return process.env.MCP_AGENT_URL || 'http://localhost:3000';
  }

  get nodeEnv(): string {
    return process.env.NODE_ENV || 'development';
  }
}
