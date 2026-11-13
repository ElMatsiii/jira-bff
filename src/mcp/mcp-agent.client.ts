import { Injectable, Optional } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '../config/config.service';

export interface AiStory {
  title: string;
  description: string;
  type: string;
  estimatedStoryPoints: number;
  acceptanceCriteriaGherkin: string;
}

export interface AiDecompositionResult {
  epicTitle: string;
  stories: AiStory[];
}

export interface AiSprintPlanResult {
  sprintGoal: string;
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

@Injectable()
export class McpAgentClient {
  constructor(@Optional() private readonly configService?: ConfigService) {}

  private get baseUrl(): string {
    return this.configService?.mcpAgentUrl || 'http://localhost:3000';
  }

  async decomposeEpic(input: {
    epicTitle: string;
    epicDescription?: string;
    projectKey?: string;
  }): Promise<AiDecompositionResult> {
    const response = await axios.post(`${this.baseUrl}/agent/decompose-epic`, input, { timeout: 15000 });
    return response.data;
  }

  async planSprint(input: {
    sprintGoal: string;
    teamCapacityStoryPoints: number;
    candidateIssues?: { id: string; title: string; storyPoints: number; priority: number }[];
  }): Promise<AiSprintPlanResult> {
    const response = await axios.post(`${this.baseUrl}/agent/plan-sprint`, input, { timeout: 15000 });
    return response.data;
  }

  async diagnoseMetrics(input: {
    sprintId: string;
    burndownData?: unknown[];
    blockedIssuesCount?: number;
    alerts?: string[];
  }): Promise<AiDiagnosisResult> {
    const response = await axios.post(`${this.baseUrl}/agent/diagnose-metrics`, input, { timeout: 15000 });
    return response.data;
  }

  async improveStory(input: { title: string; description?: string; type: string }): Promise<AiStoryImprovementResult> {
    const response = await axios.post(`${this.baseUrl}/agent/improve-story`, input, { timeout: 15000 });
    return response.data;
  }

  async breakdownTask(input: {
    title: string;
    description?: string;
    projectKey?: string;
  }): Promise<AiBreakdownTaskResult> {
    const response = await axios.post(`${this.baseUrl}/agent/breakdown-task`, input, { timeout: 15000 });
    return response.data;
  }
}
