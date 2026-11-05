import { ConfigService } from '../src/config/config.service';

describe('ConfigService', () => {
  let service: ConfigService;

  beforeEach(() => {
    service = new ConfigService();
  });

  it('should return default port 4000', () => {
    expect(service.port).toBe(4000);
  });

  it('should return default issues gRPC url', () => {
    expect(service.issuesGrpcUrl).toBe('localhost:50051');
  });

  it('should return default sprints gRPC url', () => {
    expect(service.sprintsGrpcUrl).toBe('localhost:50052');
  });

  it('should return default kafka brokers array', () => {
    expect(service.kafkaBrokers).toEqual(['localhost:9092']);
  });

  it('should return default kafka client id', () => {
    expect(service.kafkaClientId).toBe('jira-bff-gateway');
  });

  it('should return default mcp agent url', () => {
    expect(service.mcpAgentUrl).toBe('http://localhost:3000');
  });

  it('should return nodeEnv', () => {
    expect(service.nodeEnv).toBeDefined();
  });
});
