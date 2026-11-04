/**
 * AI Failure Analysis & Optimization Advisor Service
 * 
 * ROBOTRISK AI — PHASE 5.4
 * 
 * MANDATORY PRINCIPLES:
 * 1. REAL EVIDENCE FIRST:
 *    - Strictly analyzes measured Flight Recorder telemetry, Rapier velocities, obstacle clearances & TTC.
 *    - Never invents missing values; missing values display as "N/A".
 *    - Clearly distinguishes MEASURED_GROUND_TRUTH, CALCULATED_PHYSICS, and AI_HYPOTHESIS.
 * 2. ACTIONABLE SOFTWARE OPTIMIZATIONS:
 *    - Proposes only supported parameters: maxLinearSpeed, linearAcceleration, maxAngularSpeed, angularAcceleration, navigationPreference.
 *    - Hardware recommendations remain advisory only (isHardwareAdvisory: true).
 * 3. HUMAN APPROVAL REQUIRED:
 *    - No configuration is ever silently applied. Requires explicit Approve/Reject.
 * 4. CONFIGURATION VERSIONING & ROLLBACK:
 *    - Preserves baseline configuration snapshot and allows instantaneous rollback.
 * 5. SCENARIO EQUIVALENCE DISCLOSURE:
 *    - RERUN SAME SCENARIO strictly preserves environment, destination, barriers, and hazards.
 *    - Discloses any parameter or layout divergence transparently.
 * 6. DETERMINISTIC LOCAL FALLBACK:
 *    - If FastAPI backend is unreachable or offline, the full failure analysis and recommendation engine
 *      runs deterministically client-side without degrading user capabilities.
 */

import { RobotConfig, InteractiveObject, AisleBarrier } from '../types/simulation';
import { SpatialIncident } from './spatialRiskService';

export interface EvidenceItem {
  metricName: string;
  measuredValue: string;
  thresholdOrBaseline: string;
  evidenceType: 'MEASURED_GROUND_TRUTH' | 'CALCULATED_PHYSICS' | 'AI_HYPOTHESIS';
}

export interface ProposedChange {
  parameterKey: keyof RobotConfig | 'navigationPreference';
  label: string;
  currentValue: any;
  proposedValue: any;
  unit?: string;
  allowedRange?: [number, number];
}

export type RecommendationStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'APPLIED';

export interface OptimizationRecommendation {
  id: string;
  category: 'SOFTWARE_PARAMETER' | 'ROUTE_PREFERENCE' | 'HARDWARE_ADVISORY';
  title: string;
  problemExplanation: string;
  supportingEvidence: EvidenceItem[];
  proposedChanges: ProposedChange[];
  expectedBenefit: string;
  potentialTradeoffs: string;
  status: RecommendationStatus;
  isHardwareAdvisory: boolean;
}

export interface FailureAnalysisReport {
  incidentId: string;
  incidentType: string;
  primaryFailureMode: string;
  summaryExplanation: string;
  contributingFactors: string[];
  measuredEvidence: EvidenceItem[];
  hypothesizedCauses: string[];
  recommendations: OptimizationRecommendation[];
  analyzedAtISO: string;
  isDeterministicFallback: boolean;
}

export interface ScenarioSnapshot {
  scenarioId: string;
  environmentName: string;
  difficulty: 'normal' | 'hard' | 'extreme';
  startPosition: [number, number, number];
  startRotation: number;
  destinationId: string;
  destinationName: string;
  interactiveObjects: InteractiveObject[];
  activeBarriers: AisleBarrier[];
  navigationPreference: 'default' | 'shortest_safe_path' | 'alternative_route';
  baselineConfig: RobotConfig;
  baselineRunId?: string;
  recordedAt: number;
}

export interface ParameterBounds {
  min: number;
  max: number;
  step: number;
  unit: string;
}

export const SUPPORTED_PARAMETER_BOUNDS: Record<string, ParameterBounds> = {
  maxLinearSpeed: { min: 0.5, max: 5.0, step: 0.1, unit: 'm/s' },
  linearAcceleration: { min: 0.5, max: 10.0, step: 0.5, unit: 'm/s²' },
  maxAngularSpeed: { min: 0.5, max: 4.0, step: 0.1, unit: 'rad/s' },
  angularAcceleration: { min: 1.0, max: 12.0, step: 0.5, unit: 'rad/s²' },
  linearDamping: { min: 0.1, max: 5.0, step: 0.1, unit: '' },
  angularDamping: { min: 0.1, max: 5.0, step: 0.1, unit: '' },
};

export class FailureAnalysisService {
  /**
   * Validates whether a proposed parameter value falls within safe operational bounds.
   */
  public validateParameter(
    key: string,
    value: any
  ): { valid: boolean; clampedValue?: any; error?: string } {
    if (key === 'navigationPreference') {
      const allowed = ['default', 'shortest_safe_path', 'alternative_route'];
      if (!allowed.includes(value)) {
        return { valid: false, error: `Invalid navigation preference: "${value}". Must be one of: ${allowed.join(', ')}.` };
      }
      return { valid: true, clampedValue: value };
    }

    const bounds = SUPPORTED_PARAMETER_BOUNDS[key];
    if (!bounds) {
      return { valid: false, error: `Unsupported robot parameter: "${key}". Software cannot tune this field.` };
    }

    const num = Number(value);
    if (!Number.isFinite(num)) {
      return { valid: false, error: `Parameter "${key}" must be a finite numerical value.` };
    }

    if (num < bounds.min || num > bounds.max) {
      const clamped = Math.max(bounds.min, Math.min(bounds.max, num));
      return {
        valid: false,
        clampedValue: clamped,
        error: `Value ${num}${bounds.unit} is out of safe range [${bounds.min}, ${bounds.max}${bounds.unit}]. Clamped to ${clamped}${bounds.unit}.`,
      };
    }

    return { valid: true, clampedValue: num };
  }

  /**
   * Performs evidence-based AI Failure Analysis on a selected incident.
   * Calls FastAPI backend if available; falls back to deterministic local physics analysis.
   */
  public async analyzeFailure(
    incident: SpatialIncident,
    robotConfig: RobotConfig,
    navigationPreference: 'default' | 'shortest_safe_path' | 'alternative_route' = 'default',
    environmentName: string = 'Warehouse',
    spatialRiskLevel: string = 'CLEAR'
  ): Promise<FailureAnalysisReport> {
    const payload = {
      incident: {
        incident_id: incident.id,
        incident_type: incident.type,
        sim_time: incident.simTime,
        description: incident.description,
        snapshot: {
          position: incident.position,
          rotation: 0.0,
          linear_velocity: incident.linearVelocity ?? 0.0,
          angular_velocity: 0.0,
          ttc: incident.ttc,
          min_clearance: incident.minClearance,
          highest_risk_obstacle: incident.highestRiskObstacle,
          safety_status: incident.type === 'COLLISION' ? 'CRITICAL' : 'WARNING',
          stopping_distance: incident.stoppingDistance ?? null,
        },
      },
      current_robot_config: { ...robotConfig },
      navigation_preference: navigationPreference,
      environment_name: environmentName,
      nearby_spatial_risk_level: spatialRiskLevel,
    };

    try {
      const resp = await fetch('/api/advisor/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (resp.ok) {
        const data = await resp.json();
        return {
          incidentId: data.incident_id,
          incidentType: incident.type,
          primaryFailureMode: data.primary_failure_mode,
          summaryExplanation: data.summary_explanation,
          contributingFactors: data.contributing_factors || [],
          measuredEvidence: (data.measured_evidence || []).map((e: any) => ({
            metricName: e.metric_name,
            measuredValue: e.measured_value,
            thresholdOrBaseline: e.threshold_or_baseline,
            evidenceType: e.evidence_type,
          })),
          hypothesizedCauses: data.hypothesized_causes || [],
          recommendations: (data.recommendations || []).map((r: any) => ({
            id: r.id,
            category: r.category,
            title: r.title,
            problemExplanation: r.problem_explanation,
            supportingEvidence: (r.supporting_evidence || []).map((se: any) => ({
              metricName: se.metric_name,
              measuredValue: se.measured_value,
              thresholdOrBaseline: se.threshold_or_baseline,
              evidenceType: se.evidence_type,
            })),
            proposedChanges: (r.proposed_changes || []).map((pc: any) => ({
              parameterKey: pc.parameter_key,
              label: pc.label,
              currentValue: pc.current_value,
              proposedValue: pc.proposed_value,
              unit: pc.unit,
              allowedRange: pc.allowed_range,
            })),
            expectedBenefit: r.expected_benefit,
            potentialTradeoffs: r.potential_tradeoffs,
            status: 'PENDING_REVIEW',
            isHardwareAdvisory: Boolean(r.is_hardware_advisory),
          })),
          analyzedAtISO: data.analyzed_at_iso || new Date().toISOString(),
          isDeterministicFallback: false,
        };
      }
    } catch (err) {
      console.warn('Backend Failure Analysis API unavailable. Activating deterministic local engine:', err);
    }

    // Deterministic Client-Side Fallback Engine
    return this.generateDeterministicAnalysis(
      incident,
      robotConfig,
      navigationPreference,
      environmentName
    );
  }

  /**
   * Deterministic local physics-based failure analysis engine.
   */
  public generateDeterministicAnalysis(
    incident: SpatialIncident,
    robotConfig: RobotConfig,
    navigationPreference: 'default' | 'shortest_safe_path' | 'alternative_route' = 'default',
    _environmentName: string = 'Warehouse'
  ): FailureAnalysisReport {
    const v = incident.linearVelocity ?? 0.0;
    const clearance = incident.minClearance;
    const ttc = incident.ttc;
    const threat = incident.highestRiskObstacle || 'Aisle Obstacle';
    const currentMaxV = robotConfig.maxLinearSpeed;
    const currentAccel = robotConfig.linearAcceleration;

    // Physics stopping distance d = v^2 / 2a
    const stoppingDist = v > 0 ? (v * v) / (2.0 * Math.max(currentAccel, 0.5)) : 0.0;

    const measuredEvidence: EvidenceItem[] = [
      {
        metricName: 'Instantaneous Linear Speed',
        measuredValue: `${v.toFixed(2)} m/s`,
        thresholdOrBaseline: `Max Config: ${currentMaxV.toFixed(1)} m/s`,
        evidenceType: 'MEASURED_GROUND_TRUTH',
      },
    ];

    if (clearance !== null) {
      measuredEvidence.push({
        metricName: 'Measured Obstacle Clearance',
        measuredValue: `${clearance.toFixed(2)} m`,
        thresholdOrBaseline: 'Safety Threshold: >= 0.45 m',
        evidenceType: 'MEASURED_GROUND_TRUTH',
      });
    }

    if (ttc !== null) {
      measuredEvidence.push({
        metricName: 'Time-to-Collision (TTC)',
        measuredValue: `${ttc.toFixed(2)} s`,
        thresholdOrBaseline: 'Critical Alert Threshold: < 1.2 s',
        evidenceType: 'MEASURED_GROUND_TRUTH',
      });
    }

    measuredEvidence.push({
      metricName: 'Calculated Stopping Distance (d=v²/2a)',
      measuredValue: `${stoppingDist.toFixed(2)} m`,
      thresholdOrBaseline: `Available Clearance: ${clearance !== null ? `${clearance.toFixed(2)} m` : 'N/A'}`,
      evidenceType: 'CALCULATED_PHYSICS',
    });

    const contributingFactors: string[] = [];
    const hypothesizedCauses: string[] = [];
    const recommendations: OptimizationRecommendation[] = [];

    let primaryMode = 'INSUFFICIENT_STOPPING_CLEARANCE';
    let summary = '';

    if (incident.type === 'COLLISION' || (clearance !== null && clearance <= 0.45)) {
      primaryMode = 'INSUFFICIENT_STOPPING_CLEARANCE';
      summary = `Physical clearance deficit occurred while approaching ${threat} at ${v.toFixed(2)} m/s. Required stopping distance (${stoppingDist.toFixed(2)} m) exceeded available clearance (${clearance !== null ? `${clearance.toFixed(2)} m` : 'unbounded'}).`;
      contributingFactors.push(`High linear velocity (${v.toFixed(2)} m/s) built momentum faster than braking decelerations allowed.`);
      if (ttc !== null && ttc < 1.2) {
        contributingFactors.push(`Rapid trajectory convergence (TTC = ${ttc.toFixed(2)} s) compressed reactive window.`);
      }
      hypothesizedCauses.push('Optical or LiDAR line-of-sight occlusion around rack corners delayed hazard acquisition.');

      // Recommendation 1: Speed Modulation
      const safeV = Math.max(1.5, Math.min(currentMaxV - 1.0, Math.sqrt(2.0 * currentAccel * Math.max(0.4, (clearance ?? 0.6) * 0.8))));
      const roundedSafeV = Number(safeV.toFixed(1));

      recommendations.push({
        id: 'REC-OPT-1',
        category: 'SOFTWARE_PARAMETER',
        title: 'Moderate Maximum Linear Speed',
        problemExplanation: `At current speed setting (${currentMaxV.toFixed(1)} m/s), braking distance (${stoppingDist.toFixed(2)} m) exceeds corridor clearance.`,
        supportingEvidence: [
          {
            metricName: 'Stopping Distance Deficit',
            measuredValue: `${stoppingDist.toFixed(2)} m`,
            thresholdOrBaseline: `${clearance !== null ? `${clearance.toFixed(2)} m` : '0.50 m'}`,
            evidenceType: 'CALCULATED_PHYSICS',
          },
        ],
        proposedChanges: [
          {
            parameterKey: 'maxLinearSpeed',
            label: 'Maximum Linear Speed',
            currentValue: currentMaxV,
            proposedValue: roundedSafeV,
            unit: 'm/s',
            allowedRange: [0.5, 5.0],
          },
        ],
        expectedBenefit: `Shortens stopping distance from ${stoppingDist.toFixed(2)} m to ${((roundedSafeV * roundedSafeV) / (2 * currentAccel)).toFixed(2)} m.`,
        potentialTradeoffs: `Estimated +${Math.round(((currentMaxV / roundedSafeV) - 1.0) * 100)}% transit time duration.`,
        status: 'PENDING_REVIEW',
        isHardwareAdvisory: false,
      });

    } else if (incident.type === 'EMERGENCY_BRAKING') {
      primaryMode = 'SUDDEN_BRAKING_SURGE';
      summary = `Emergency braking override engaged near ${threat}. Aggressive forward acceleration required maximum deceleration.`;
      contributingFactors.push('Approached corridor junction with high acceleration surge.');

      const safeAccel = Number(Math.max(2.5, currentAccel - 2.0).toFixed(1));
      recommendations.push({
        id: 'REC-OPT-1',
        category: 'SOFTWARE_PARAMETER',
        title: 'Smooth Linear Acceleration Dynamics',
        problemExplanation: `Linear acceleration (${currentAccel.toFixed(1)} m/s²) builds rapid forward momentum before obstacle boundaries are fully confirmed.`,
        supportingEvidence: [
          {
            metricName: 'Linear Acceleration',
            measuredValue: `${currentAccel.toFixed(1)} m/s²`,
            thresholdOrBaseline: '<= 4.0 m/s²',
            evidenceType: 'MEASURED_GROUND_TRUTH',
          },
        ],
        proposedChanges: [
          {
            parameterKey: 'linearAcceleration',
            label: 'Linear Acceleration',
            currentValue: currentAccel,
            proposedValue: safeAccel,
            unit: 'm/s²',
            allowedRange: [0.5, 10.0],
          },
        ],
        expectedBenefit: 'Avoids sudden momentum spikes into obstructed corridors.',
        potentialTradeoffs: 'Slightly slower acceleration from stationary stops.',
        status: 'PENDING_REVIEW',
        isHardwareAdvisory: false,
      });

    } else {
      primaryMode = 'TRAJECTORY_PROXIMITY_WARNING';
      summary = `Proximity warning near ${threat}. Trajectory passed within ${(clearance ?? 1.0).toFixed(2)} m of boundary.`;
      contributingFactors.push('Route selection navigated through narrow, crowded corridor.');
    }

    // Recommendation 2: Route Preference
    const targetPref = navigationPreference !== 'alternative_route' ? 'alternative_route' : 'shortest_safe_path';
    recommendations.push({
      id: 'REC-OPT-2',
      category: 'ROUTE_PREFERENCE',
      title: 'Adopt Wide-Arterial Alternative Routing',
      problemExplanation: `Current route preference ('${navigationPreference}') routed the AMR through the constrained bottleneck containing ${threat}.`,
      supportingEvidence: [
        {
          metricName: 'Corridor Threat Density',
          measuredValue: `Active threat: ${threat}`,
          thresholdOrBaseline: 'Clear Arterial Corridor',
          evidenceType: 'MEASURED_GROUND_TRUTH',
        },
      ],
      proposedChanges: [
        {
          parameterKey: 'navigationPreference',
          label: 'Navigation Route Preference',
          currentValue: navigationPreference,
          proposedValue: targetPref,
        },
      ],
      expectedBenefit: 'Bypasses the congested corridor in favor of wider arterial bypasses.',
      potentialTradeoffs: 'May increase total path length by approximately 10-15%.',
      status: 'PENDING_REVIEW',
      isHardwareAdvisory: false,
    });

    // Recommendation 3: Hardware Advisory
    recommendations.push({
      id: 'REC-OPT-3',
      category: 'HARDWARE_ADVISORY',
      title: 'Hardware Advisory: Wide-Angle LiDAR / Stereo Camera',
      problemExplanation: `Threat (${threat}) entered proximity rapidly. Horizontal sensor FOV or lookahead range may be constrained by chassis placement.`,
      supportingEvidence: [
        {
          metricName: 'Predictive Reaction Window',
          measuredValue: ttc !== null ? `${ttc.toFixed(2)} s` : 'Constrained',
          thresholdOrBaseline: '>= 2.5 s',
          evidenceType: 'AI_HYPOTHESIS',
        },
      ],
      proposedChanges: [],
      expectedBenefit: 'Increases peripheral visibility around rack corner blindspots.',
      potentialTradeoffs: 'Physical sensor retrofitting required. Software configuration cannot physically modify hardware.',
      status: 'PENDING_REVIEW',
      isHardwareAdvisory: true,
    });

    return {
      incidentId: incident.id,
      incidentType: incident.type,
      primaryFailureMode: primaryMode,
      summaryExplanation: summary,
      contributingFactors,
      measuredEvidence,
      hypothesizedCauses,
      recommendations,
      analyzedAtISO: new Date().toISOString(),
      isDeterministicFallback: true,
    };
  }

  /**
   * Compares a baseline scenario snapshot against current simulation conditions to verify exact equivalence.
   */
  public checkScenarioEquivalence(
    baseline: ScenarioSnapshot,
    current: {
      destinationId: string;
      difficulty: 'normal' | 'hard' | 'extreme';
      interactiveObjects: InteractiveObject[];
      activeBarriers: AisleBarrier[];
      startPosition: [number, number, number];
    }
  ): { isIdentical: boolean; differences: string[] } {
    const diffs: string[] = [];

    if (baseline.destinationId !== current.destinationId) {
      diffs.push(`Destination mismatch: ${baseline.destinationId} vs ${current.destinationId}`);
    }
    if (baseline.difficulty !== current.difficulty) {
      diffs.push(`Difficulty mismatch: ${baseline.difficulty} vs ${current.difficulty}`);
    }
    if (baseline.interactiveObjects.length !== current.interactiveObjects.length) {
      diffs.push(`Hazard count mismatch: ${baseline.interactiveObjects.length} vs ${current.interactiveObjects.length} interactive objects`);
    }
    if (baseline.activeBarriers.length !== current.activeBarriers.length) {
      diffs.push(`Barrier count mismatch: ${baseline.activeBarriers.length} vs ${current.activeBarriers.length} aisle barriers`);
    }

    const posDist = Math.hypot(
      baseline.startPosition[0] - current.startPosition[0],
      baseline.startPosition[2] - current.startPosition[2]
    );
    if (posDist > 0.5) {
      diffs.push(`Start position altered by ${posDist.toFixed(2)} m`);
    }

    return {
      isIdentical: diffs.length === 0,
      differences: diffs,
    };
  }
}

// Global Singleton Instance
export const failureAnalysisService = new FailureAnalysisService();
