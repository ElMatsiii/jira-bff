import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '../config/config.service';

const MCP_TIMEOUT_MS = 15000;

/**
 * Turns an axios failure towards the MCP agent into an HttpException whose message reaches
 * GraphQL in readable Spanish (instead of "Request failed with status code 422").
 */
export function toAgentError(operation: string, error: unknown): HttpException {
  const err = error as {
    code?: string;
    message?: string;
    response?: { status?: number; data?: { error?: unknown } | string };
  } | null;
  const status = err?.response?.status;
  if (typeof status === 'number') {
    const data = err?.response?.data;
    const detail = typeof data === 'string' ? data : typeof data?.error === 'string' ? data.error : '';
    const suffix = detail ? `: ${detail}` : '.';
    if (status >= 400 && status < 500) {
      return new BadRequestException(`El agente de IA rechazó la solicitud de ${operation} (HTTP ${status})${suffix}`);
    }
    return new BadGatewayException(`El agente de IA falló al procesar ${operation} (HTTP ${status})${suffix}`);
  }
  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') {
    return new GatewayTimeoutException(`El agente de IA no respondió a tiempo en ${operation}.`);
  }
  const reason = err?.message ? ` (${err.message})` : '';
  return new ServiceUnavailableException(`El agente de IA no está disponible para ${operation}${reason}.`);
}

export interface AiStory {
  title: string;
  description: string;
  type: string;
  /** LOW | MEDIUM | HIGH | CRITICAL, as suggested by the agent (Gemini or fallback). */
  priority?: string;
  estimatedStoryPoints: number;
  acceptanceCriteriaGherkin: string;
}

export interface AiDecompositionResult {
  epicTitle: string;
  stories: AiStory[];
}

export interface AiSprintPlanResult {
  /** The agent does not echo the goal; the resolver falls back to the requested one. */
  sprintGoal?: string;
  allocatedStoryPoints: number;
  recommendedIssueIds: string[];
  riskAssessment: string;
}

export interface AiDiagnosisResult {
  sprintId?: string;
  healthStatus: string;
  summary?: string;
  diagnosis?: string;
  rootCauses: string[];
  recommendations?: string[];
  actionableRecommendations?: string[];
}

export interface AiStoryImprovementResult {
  storyPoints: number;
  confidence: number;
  reasoning: string;
  complexityFactors: string[];
  acceptanceCriteriaGherkin: string;
}

export interface AiSuggestedSubtask {
  title: string;
  description: string;
  type: string;
  priority: string;
  estimatedStoryPoints: number;
  acceptanceCriteriaGherkin?: string;
}

export interface AiBreakdownTaskResult {
  parentTitle: string;
  subtasks: AiSuggestedSubtask[];
}

export interface AiProjectRetrospectiveResult {
  projectId: string;
  summary: string;
  strengths: string[];
  areasForImprovement: string[];
  actionableRecommendations: string[];
}

@Injectable()
export class McpAgentClient {
  constructor(@Optional() private readonly configService?: ConfigService) {}

  private get baseUrl(): string {
    return this.configService?.mcpAgentUrl || 'http://localhost:3000';
  }

  private async post<T>(path: string, body: unknown, operation: string): Promise<T> {
    try {
      const response = await axios.post(`${this.baseUrl}${path}`, body, { timeout: MCP_TIMEOUT_MS });
      return response.data;
    } catch (error) {
      throw toAgentError(operation, error);
    }
  }

  async decomposeEpic(input: {
    epicTitle: string;
    epicDescription?: string;
    projectKey?: string;
  }): Promise<AiDecompositionResult> {
    return this.post('/agent/decompose-epic', input, 'desglose de épica');
  }

  async planSprint(input: {
    sprintGoal: string;
    teamCapacityStoryPoints: number;
    /** priority uses the agent's names: LOW | MEDIUM | HIGH | CRITICAL. */
    candidateIssues?: { id: string; title: string; storyPoints: number; priority: string }[];
  }): Promise<AiSprintPlanResult> {
    return this.post('/agent/plan-sprint', input, 'planificación de sprint');
  }

  async diagnoseMetrics(input: {
    sprintId: string;
    sprintName?: string;
    /** Points accepted by the agent's BurndownPointSchema: day, optional date, ideal/actual remaining. */
    burndownData?: { day: number; date?: string; idealRemaining: number; actualRemaining: number }[];
    blockedIssuesCount?: number;
    alerts?: string[];
  }): Promise<AiDiagnosisResult> {
    return this.post('/agent/diagnose-metrics', input, 'diagnóstico de métricas');
  }

  async improveStory(input: { title: string; description?: string; type: string }): Promise<AiStoryImprovementResult> {
    return this.post('/agent/improve-story', input, 'mejora de historia');
  }

  async breakdownTask(input: {
    title: string;
    description?: string;
    projectKey?: string;
  }): Promise<AiBreakdownTaskResult> {
    return this.post('/agent/breakdown-task', input, 'segmentación de subtareas');
  }

  async projectRetrospective(input: {
    projectId: string;
    projectKey?: string;
    velocityHistory?: {
      sprintId: string;
      sprintName: string;
      committedStoryPoints: number;
      completedStoryPoints: number;
      completedDate: string;
    }[];
  }): Promise<AiProjectRetrospectiveResult> {
    return this.post('/agent/project-retrospective', input, 'retrospectiva de proyecto');
  }
}
