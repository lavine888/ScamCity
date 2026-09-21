import type {
  ComparisonScorecard,
  ComparisonVerdict,
  InterventionStrategy,
  SimulationMetrics,
} from "@/types";
import { INTERVENTION_LABELS } from "@/types";
import { round } from "@/simulation/seeded-random";

/** The verdict only needs the strategy and its metrics, so both the engine's
 * `ComparisonSummary` and the UI/live-snapshot shapes (which may omit `world`)
 * can be scored by the same rule. */
export interface ComparisonInput {
  strategy: InterventionStrategy;
  label?: string;
  metrics: SimulationMetrics;
}

/**
 * Comparison口径：把一次同 seed 复盘拆成三栏，避免只按损失挑“最佳”。
 *
 * - impact：victims / moneyLost，衡量结果。
 * - friction：falsePositives / warningsSent，衡量给市民带来的摩擦。
 * - cost：interventionCost，抽象比较单位，不是真实部署成本。
 *
 * 主判定按审计约定的优先级执行，并且必须给出可复述的理由：
 *
 *   少损失 → 少受害 → 可接受误报 → 成本可解释
 *
 * 排序是确定性的：所有比较项都来自同一 seed 的复盘，最后以 strategy 名称兜底，
 * 保证同一组输入总是得到同一个 best。
 */

/** 损失差异小于该比例时视为同档，继续看下一优先级。 */
export const LOSS_TIE_RATIO = 0.05;
/** 误报差异在该数量内视为“可接受”，继续看成本。 */
export const FALSE_POSITIVE_TOLERANCE = 2;

const STRATEGY_ORDER: InterventionStrategy[] = [
  "baseline",
  "mass-warning",
  "bank-risk-agent",
  "social-guardian",
  "network-intervention",
];

export function scorecardFor(
  strategy: InterventionStrategy,
  label: string,
  metrics: SimulationMetrics,
): ComparisonScorecard {
  return {
    strategy,
    label,
    impact: {
      victims: metrics.victims,
      moneyLost: Math.round(metrics.moneyLost),
    },
    friction: {
      falsePositives: metrics.falsePositives,
      warningsSent: round(metrics.warningsSent),
    },
    cost: {
      interventionCost: Math.round(metrics.interventionCost),
    },
  };
}

export function scorecardsFor(results: readonly ComparisonInput[]): ComparisonScorecard[] {
  return results.map((result) =>
    scorecardFor(result.strategy, result.label ?? INTERVENTION_LABELS[result.strategy], result.metrics),
  );
}

/**
 * 统一主判定。返回值包含理由，UI 和报告都必须显示它，
 * 而不是自己再定义一套“最佳”。
 */
export function rankScorecards(cards: readonly ComparisonScorecard[]): ComparisonScorecard[] {
  const maxLoss = Math.max(1, ...cards.map((card) => card.impact.moneyLost));
  return [...cards].sort((left, right) => {
    // 1. 少损失（同档内不分胜负）
    const lossGap = Math.abs(left.impact.moneyLost - right.impact.moneyLost) / maxLoss;
    if (lossGap > LOSS_TIE_RATIO) return left.impact.moneyLost - right.impact.moneyLost;
    // 2. 少受害
    if (left.impact.victims !== right.impact.victims) return left.impact.victims - right.impact.victims;
    // 3. 可接受误报
    const falsePositiveGap = left.friction.falsePositives - right.friction.falsePositives;
    if (Math.abs(falsePositiveGap) > FALSE_POSITIVE_TOLERANCE) return falsePositiveGap;
    // 4. 成本可解释
    if (left.cost.interventionCost !== right.cost.interventionCost) {
      return left.cost.interventionCost - right.cost.interventionCost;
    }
    return STRATEGY_ORDER.indexOf(left.strategy) - STRATEGY_ORDER.indexOf(right.strategy);
  });
}

function reasonFor(best: ComparisonScorecard, baseline: ComparisonScorecard | undefined): string {
  if (!baseline || baseline.strategy === best.strategy) {
    return `${best.label} 在该 seed 下损失最低（HK$${best.impact.moneyLost.toLocaleString("en-HK")}、${best.impact.victims} 名受害者），未计入额外干预成本。`;
  }
  const lossDelta = baseline.impact.moneyLost - best.impact.moneyLost;
  const victimDelta = baseline.impact.victims - best.impact.victims;
  return [
    `${best.label}：损失较 baseline 变化 HK$${lossDelta.toLocaleString("en-HK")}、受害者变化 ${victimDelta} 人`,
    `误报 ${best.friction.falsePositives}、警告 ${best.friction.warningsSent}`,
    `成本 ${best.cost.interventionCost.toLocaleString("en-HK")} 比较单位`,
  ].join("；") + "。判定顺序：少损失 → 少受害 → 可接受误报 → 成本可解释。";
}

export function verdictFor(results: readonly ComparisonInput[]): ComparisonVerdict | undefined {
  if (!results.length) return undefined;
  const cards = scorecardsFor(results);
  const ranked = rankScorecards(cards);
  const best = ranked[0];
  const baseline = cards.find((card) => card.strategy === "baseline");
  return {
    rule: "少损失 → 少受害 → 可接受误报 → 成本可解释",
    bestStrategy: best.strategy,
    bestLabel: best.label,
    reason: reasonFor(best, baseline),
    ranking: ranked.map((card) => card.strategy),
    scorecards: cards,
    disclaimer: "这是该 seed 与该时间窗下的 synthetic modeled outcome，不代表任一策略普遍最优。",
  };
}
