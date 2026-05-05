/**
 * Rule Performance Metrics
 * 
 * Tracks performance metrics for business rule execution.
 * Extracted from business-rule-validator.ts to reduce file size.
 */

export interface RulePerformanceMetrics {
  ruleId: string;
  ruleName: string;
  executionCount: number;
  totalExecutionTimeMs: number;
  averageExecutionTimeMs: number;
  minExecutionTimeMs: number;
  maxExecutionTimeMs: number;
  failureCount: number;
  errorCount: number;
  lastExecutedAt: Date;
}

export class RulePerformanceMetricsTracker {
  private performanceMetrics: Map<string, RulePerformanceMetrics> = new Map();

  recordRuleExecution(
    ruleId: string,
    ruleName: string,
    executionTime: number,
    passed: boolean,
    error: boolean
  ): void {
    let metrics = this.performanceMetrics.get(ruleId);

    if (!metrics) {
      metrics = {
        ruleId,
        ruleName,
        executionCount: 0,
        totalExecutionTimeMs: 0,
        averageExecutionTimeMs: 0,
        minExecutionTimeMs: Infinity,
        maxExecutionTimeMs: 0,
        failureCount: 0,
        errorCount: 0,
        lastExecutedAt: new Date()
      };
      this.performanceMetrics.set(ruleId, metrics);
    }

    metrics.executionCount++;
    metrics.totalExecutionTimeMs += executionTime;
    metrics.averageExecutionTimeMs = metrics.totalExecutionTimeMs / metrics.executionCount;
    metrics.minExecutionTimeMs = Math.min(metrics.minExecutionTimeMs, executionTime);
    metrics.maxExecutionTimeMs = Math.max(metrics.maxExecutionTimeMs, executionTime);
    metrics.lastExecutedAt = new Date();

    if (error) {
      metrics.errorCount++;
    } else if (!passed) {
      metrics.failureCount++;
    }
  }

  getPerformanceMetrics(): RulePerformanceMetrics[] {
    return Array.from(this.performanceMetrics.values());
  }

  getRulePerformanceMetrics(ruleId: string): RulePerformanceMetrics | null {
    return this.performanceMetrics.get(ruleId) || null;
  }

  getPerformanceSummary(): {
    totalRules: number;
    totalExecutions: number;
    averageExecutionTimeMs: number;
    slowestRules: { ruleId: string; ruleName: string; avgTimeMs: number }[];
    mostFailedRules: { ruleId: string; ruleName: string; failureRate: number }[];
  } {
    const metrics = this.getPerformanceMetrics();

    const totalExecutions = metrics.reduce((sum, m) => sum + m.executionCount, 0);
    const totalTime = metrics.reduce((sum, m) => sum + m.totalExecutionTimeMs, 0);

    // Get slowest rules (top 5 by average execution time)
    const slowestRules = metrics
      .map((m) => ({
        ruleId: m.ruleId,
        ruleName: m.ruleName,
        avgTimeMs: m.averageExecutionTimeMs,
      }))
      .sort((a, b) => b.avgTimeMs - a.avgTimeMs)
      .slice(0, 5);

    // Get rules with highest failure rate (top 5)
    const mostFailedRules = metrics
      .map((m) => ({
        ruleId: m.ruleId,
        ruleName: m.ruleName,
        failureRate: m.executionCount > 0 ? m.failureCount / m.executionCount : 0,
      }))
      .filter((m) => m.failureRate > 0)
      .sort((a, b) => b.failureRate - a.failureRate)
      .slice(0, 5);

    return {
      totalRules: metrics.length,
      totalExecutions,
      averageExecutionTimeMs: totalExecutions > 0 ? totalTime / totalExecutions : 0,
      slowestRules,
      mostFailedRules,
    };
  }

  clearMetrics(): void {
    this.performanceMetrics.clear();
  }
}

