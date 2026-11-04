import math
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from backend.app.schemas.advisor import (
    FailureAnalysisRequest,
    FailureAnalysisResponse,
    EvidenceItem,
    ProposedChange,
    RecommendationItem,
)

def analyze_incident_and_recommend(request: FailureAnalysisRequest) -> FailureAnalysisResponse:
    inc = request.incident
    snap = inc.snapshot
    config = request.current_robot_config or {}

    # Extract physical ground-truth metrics
    v = snap.linear_velocity or 0.0
    omega = snap.angular_velocity or 0.0
    clearance = snap.min_clearance
    ttc = snap.ttc
    threat = snap.highest_risk_obstacle or "Unknown Obstacle"
    current_max_v = float(config.get("maxLinearSpeed", 3.5))
    current_accel = float(config.get("linearAcceleration", 6.0))
    current_max_omega = float(config.get("maxAngularSpeed", 2.8))
    current_pref = request.navigation_preference or "default"

    # Physics calculations (d = v^2 / 2a)
    stopping_dist = (v * v) / (2.0 * max(current_accel, 0.5)) if v > 0 else 0.0
    if snap.stopping_distance is not None:
        stopping_dist = snap.stopping_distance

    measured_evidence: List[EvidenceItem] = []
    contributing_factors: List[str] = []
    hypotheses: List[str] = []
    recommendations: List[RecommendationItem] = []

    # Evidence 1: Linear Speed
    measured_evidence.append(
        EvidenceItem(
            metric_name="Instantaneous Linear Speed",
            measured_value=f"{v:.2f} m/s",
            threshold_or_baseline=f"Max Config: {current_max_v:.1f} m/s",
            evidence_type="MEASURED_GROUND_TRUTH",
        )
    )

    # Evidence 2: Minimum Clearance
    if clearance is not None:
        measured_evidence.append(
            EvidenceItem(
                metric_name="Measured Obstacle Clearance",
                measured_value=f"{clearance:.2f} m",
                threshold_or_baseline="Safety Threshold: >= 0.45 m",
                evidence_type="MEASURED_GROUND_TRUTH",
            )
        )

    # Evidence 3: Time-to-Collision
    if ttc is not None:
        measured_evidence.append(
            EvidenceItem(
                metric_name="Time-to-Collision (TTC)",
                measured_value=f"{ttc:.2f} s",
                threshold_or_baseline="Critical Alert Threshold: < 1.2 s",
                evidence_type="MEASURED_GROUND_TRUTH",
            )
        )

    # Evidence 4: Calculated Stopping Distance
    measured_evidence.append(
        EvidenceItem(
            metric_name="Calculated Stopping Distance (d=v²/2a)",
            measured_value=f"{stopping_dist:.2f} m",
            threshold_or_baseline=f"Available Clearance: {f'{clearance:.2f} m' if clearance is not None else 'N/A'}",
            evidence_type="CALCULATED_PHYSICS",
        )
    )

    # Identify primary failure mode & recommendations
    rec_counter = 1

    if inc.incident_type == "COLLISION" or (clearance is not None and clearance <= 0.45):
        primary_mode = "INSUFFICIENT_STOPPING_CLEARANCE"
        summary = (
            f"Physical clearance deficit occurred while approaching {threat} at {v:.2f} m/s. "
            f"Theoretical stopping distance was {stopping_dist:.2f} m, exceeding available obstacle clearance."
        )
        contributing_factors.append(
            f"Robot forward velocity ({v:.2f} m/s) required more braking distance than corridor geometry allowed."
        )
        if ttc is not None and ttc < 1.2:
            contributing_factors.append(f"Rapid trajectory convergence (TTC = {ttc:.2f} s) compressed reactive window.")

        hypotheses.append("Dynamic obstacle or corner blindspot delayed optical line-of-sight acquisition.")

        # Recommendation 1: Speed Reduction
        safe_v = max(1.5, min(current_max_v - 1.0, math.sqrt(2.0 * current_accel * max(0.4, (clearance or 0.6) * 0.8))))
        safe_v = round(safe_v, 1)

        recommendations.append(
            RecommendationItem(
                id=f"REC-OPT-{rec_counter}",
                category="SOFTWARE_PARAMETER",
                title="Moderate Maximum Linear Velocity",
                problem_explanation=(
                    f"At current max speed ({current_max_v:.1f} m/s), braking distance ({stopping_dist:.2f} m) "
                    f"exceeds typical corridor clearance ({clearance or 0.5:.2f} m)."
                ),
                supporting_evidence=[
                    EvidenceItem(
                        metric_name="Stopping Distance Deficit",
                        measured_value=f"{stopping_dist:.2f} m",
                        threshold_or_baseline=f"{clearance or 0.5:.2f} m",
                        evidence_type="CALCULATED_PHYSICS",
                    )
                ],
                proposed_changes=[
                    ProposedChange(
                        parameter_key="maxLinearSpeed",
                        label="Maximum Linear Speed",
                        current_value=current_max_v,
                        proposed_value=safe_v,
                        unit="m/s",
                        allowed_range=[0.5, 5.0],
                    )
                ],
                expected_benefit=(
                    f"Reduces physical stopping distance from {stopping_dist:.2f} m to "
                    f"{(safe_v*safe_v)/(2*current_accel):.2f} m, guaranteeing safe braking inside corridor limits."
                ),
                potential_tradeoffs=(
                    f"Estimated +{int(round(((current_max_v / safe_v) - 1.0) * 100))}% increase in transit duration."
                ),
                is_hardware_advisory=False,
            )
        )
        rec_counter += 1

    elif inc.incident_type == "EMERGENCY_BRAKING":
        primary_mode = "SUDDEN_BRAKING_SURGE"
        summary = (
            f"Robot triggered emergency deceleration override (a_req > a_max) near {threat}. "
            f"High momentum into transit corridor necessitated maximum deceleration."
        )
        contributing_factors.append("Approached turn or corridor junction with aggressive linear acceleration.")

        # Recommendation: Acceleration Smoothing
        safe_accel = round(max(2.5, current_accel - 2.0), 1)
        recommendations.append(
            RecommendationItem(
                id=f"REC-OPT-{rec_counter}",
                category="SOFTWARE_PARAMETER",
                title="Smooth Acceleration Dynamics",
                problem_explanation=(
                    f"High acceleration ({current_accel:.1f} m/s²) builds rapid forward momentum before obstacle "
                    "boundaries are fully verified by LiDAR scans."
                ),
                supporting_evidence=[
                    EvidenceItem(
                        metric_name="Linear Acceleration",
                        measured_value=f"{current_accel:.1f} m/s²",
                        threshold_or_baseline="Conservative Warehouse Baseline: <= 4.0 m/s²",
                        evidence_type="MEASURED_GROUND_TRUTH",
                    )
                ],
                proposed_changes=[
                    ProposedChange(
                        parameter_key="linearAcceleration",
                        label="Linear Acceleration",
                        current_value=current_accel,
                        proposed_value=safe_accel,
                        unit="m/s²",
                        allowed_range=[0.5, 10.0],
                    )
                ],
                expected_benefit="Smoother speed transitions; avoids sudden emergency braking spikes.",
                potential_tradeoffs="Slightly slower acceleration from stationary stops.",
                is_hardware_advisory=False,
            )
        )
        rec_counter += 1

    else:
        primary_mode = "TRAJECTORY_CONVERGENCE_WARNING"
        summary = (
            f"Autonomous navigation recorded proximity warning near {threat}. "
            f"Trajectory passed within {(clearance or 1.0):.2f} m of obstacle boundary."
        )
        contributing_factors.append("Route selection steered through narrow or congested aisle.")

    # Recommendation 2: Route Preference Detour (if in high-risk corridor or current preference is default)
    target_pref = "alternative_route" if current_pref != "alternative_route" else "shortest_safe_path"
    recommendations.append(
        RecommendationItem(
            id=f"REC-OPT-{rec_counter}",
            category="ROUTE_PREFERENCE",
            title="Adopt Wide-Arterial Alternative Routing",
            problem_explanation=(
                f"Current route preference ('{current_pref}') directed navigation through the congested corridor "
                f"containing {threat}."
            ),
            supporting_evidence=[
                EvidenceItem(
                    metric_name="Corridor Threat Density",
                    measured_value=f"Active threat: {threat}",
                    threshold_or_baseline="Clear Arterial Corridor",
                    evidence_type="MEASURED_GROUND_TRUTH",
                )
            ],
            proposed_changes=[
                ProposedChange(
                    parameter_key="navigationPreference",
                    label="Navigation Route Preference",
                    current_value=current_pref,
                    proposed_value=target_pref,
                    unit=None,
                    allowed_range=None,
                )
            ],
            expected_benefit=f"Bypasses the congested corridor in favor of wider transit arterials.",
            potential_tradeoffs="May increase total path length by approximately 10-15%.",
            is_hardware_advisory=False,
        )
    )
    rec_counter += 1

    # Recommendation 3: Hardware Advisory (Always marked as advisory only)
    recommendations.append(
        RecommendationItem(
            id=f"REC-OPT-{rec_counter}",
            category="HARDWARE_ADVISORY",
            title="Consider Wide-Angle LiDAR or Stereo Depth Camera",
            problem_explanation=(
                f"Obstacle ({threat}) entered critical clearance rapidly. Horizontal sensor FOV or lookahead range "
                "may have limited optical detection time at rack corners."
            ),
            supporting_evidence=[
                EvidenceItem(
                    metric_name="Reactive Decision Horizon",
                    measured_value=f"{ttc:.2f} s" if ttc is not None else "Sudden Proximity",
                    threshold_or_baseline="Nominal Predictive Window: >= 2.5 s",
                    evidence_type="AI_HYPOTHESIS",
                )
            ],
            proposed_changes=[],
            expected_benefit="Broadens field-of-view around corner blindspots before initiating aisle entry.",
            potential_tradeoffs="Physical sensor retrofitting required. Software configuration cannot physically modify hardware.",
            is_hardware_advisory=True,
        )
    )

    return FailureAnalysisResponse(
        incident_id=inc.incident_id,
        primary_failure_mode=primary_mode,
        summary_explanation=summary,
        contributing_factors=contributing_factors,
        measured_evidence=measured_evidence,
        hypothesized_causes=hypotheses,
        recommendations=recommendations,
        analyzed_at_iso=datetime.now(timezone.utc).isoformat(),
    )
