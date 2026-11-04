import os
import re
import math
import json
from typing import Optional, List, Tuple, Dict, Any
from backend.app.schemas.command import (
    CommandParseRequest,
    CommandParseResponse,
    CommandParameters,
    CommandContext,
    SubAction,
    CommandActionType,
)

AISLE_MAP = {
    "1": ("aisle-1", "Aisle 1 (Rack Bay A-B)"),
    "one": ("aisle-1", "Aisle 1 (Rack Bay A-B)"),
    "first": ("aisle-1", "Aisle 1 (Rack Bay A-B)"),
    "2": ("aisle-2", "Aisle 2 (Rack Bay B-C)"),
    "two": ("aisle-2", "Aisle 2 (Rack Bay B-C)"),
    "second": ("aisle-2", "Aisle 2 (Rack Bay B-C)"),
    "3": ("aisle-3", "Aisle 3 (Rack Bay C-D)"),
    "three": ("aisle-3", "Aisle 3 (Rack Bay C-D)"),
    "third": ("aisle-3", "Aisle 3 (Rack Bay C-D)"),
    "west": ("aisle-main-west", "West Transit Arterial"),
    "east": ("aisle-main-east", "East Transit Arterial"),
    "north": ("aisle-north-cross", "North Cross Aisle"),
    "south": ("aisle-south-cross", "South Cross Aisle"),
}

WORD_TO_NUM = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
}

# Warehouse boundaries in world coordinates (meters)
WAREHOUSE_BOUNDS = {
    "min_x": -19.0,
    "max_x": 19.0,
    "min_z": -15.0,
    "max_z": 15.0,
}

def parse_natural_language_command(req: CommandParseRequest) -> CommandParseResponse:
    """
    Main entry point for command orchestration.
    1. If LLM key is present, attempt LLM-backed parsing.
    2. Fall back to deterministic multi-intent natural language decomposition parser.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if api_key:
        try:
            llm_res = call_llm_parser(req, api_key)
            if llm_res and llm_res.action != "unknown":
                return llm_res
        except Exception:
            pass  # Transparent fallback to deterministic parser

    return parse_deterministic_multiaction(req)


def parse_deterministic_multiaction(req: CommandParseRequest) -> CommandParseResponse:
    raw = req.prompt.strip()
    ctx = req.context or CommandContext()

    # Step 1: Check for Multi-Intent Decomposition
    chunks = split_multi_intent_prompt(raw)

    if len(chunks) > 1:
        sub_actions: List[SubAction] = []
        requires_any_approval = False
        all_proposed_changes: List[str] = []
        impact_summaries: List[str] = []

        # Maintain running context across sub-intents (e.g. difficulty set in chunk 1 feeds chunk 2)
        running_ctx = ctx.model_copy()

        for idx, chunk in enumerate(chunks):
            single_req = CommandParseRequest(prompt=chunk, context=running_ctx)
            parsed = parse_single_intent(single_req)

            if parsed.action != "unknown":
                sub_id = f"step-{idx + 1}"
                sub_act = SubAction(
                    id=sub_id,
                    action=parsed.action,
                    intent=parsed.intent,
                    confidence=parsed.confidence,
                    parameters=parsed.parameters,
                    description=parsed.description,
                    requires_approval=parsed.requires_approval,
                    impact_summary=parsed.impact_summary,
                    proposed_changes=parsed.proposed_changes,
                )
                sub_actions.append(sub_act)

                if parsed.requires_approval:
                    requires_any_approval = True
                
                # Update running context
                if parsed.action == "set_difficulty" and parsed.parameters.difficulty:
                    running_ctx.current_difficulty = parsed.parameters.difficulty
                running_ctx.last_action_type = parsed.action

                impact_summaries.append(f"Step {idx + 1}: {parsed.intent}")
                for change in parsed.proposed_changes:
                    all_proposed_changes.append(f"[Step {idx + 1}] {change}")

        # If at least 2 distinct valid actions were extracted
        if len(sub_actions) >= 2:
            combined_intent = " + ".join([a.intent for a in sub_actions])
            combined_impact = "Sequential multi-action workflow: " + " -> ".join([a.intent for a in sub_actions])
            combined_desc = f"Execute {len(sub_actions)} coordinated simulation operations sequentially."

            return CommandParseResponse(
                action=sub_actions[0].action,
                intent=combined_intent,
                confidence=round(sum([a.confidence for a in sub_actions]) / len(sub_actions), 2),
                parameters=sub_actions[0].parameters,
                description=combined_desc,
                requires_approval=requires_any_approval,
                impact_summary=combined_impact,
                proposed_changes=all_proposed_changes,
                sub_actions=sub_actions,
                is_multi_intent=True,
                direct_response=f"Prepared composite workflow with {len(sub_actions)} coordinated actions. Awaiting operator confirmation.",
                parser_mode="deterministic_fallback",
            )

    # Step 2: Single Intent Parsing
    return parse_single_intent(req)


def split_multi_intent_prompt(prompt: str) -> List[str]:
    """
    Decomposes compound sentences with multiple actions into distinct action phrases.
    Protects coordinate commas like 'x 5, z 8' or numbers.
    """
    # Protect coordinates like 'x 5, z 8' or 'X 5, Z 8'
    protected = re.sub(r'([xX]\s*[:=]?\s*-?\d+\.?\d*)\s*,\s*([zZ]\s*[:=]?\s*-?\d+\.?\d*)', r'\1_COORD_COMMA_\2', prompt)

    # Regex splitting on coordinating conjunctions followed by action verbs
    # e.g., 'and take it through', 'and start the robot', 'block aisle two and start'
    action_verb_lookahead = r'(?:take|start|begin|launch|block|close|unblock|reopen|create|spawn|place|drop|make|set|put|add|remove|clear|delete|pause|resume|freeze|explain|show|try|run|stop|halt|hold)\b'

    pattern = (
        r'\s+(?:and\s+then|then|as\s+well\s+as)\s+|'  # explicit temporal connectors
        r';\s*|'                                     # semicolons
        r',\s*(?=' + action_verb_lookahead + r')|'   # comma before action verb
        r'\s+and\s+(?=' + action_verb_lookahead + r')' # 'and' before action verb
    )

    parts = re.split(pattern, protected, flags=re.IGNORECASE)
    cleaned = []
    for p in parts:
        if p and p.strip():
            restored = p.replace('_COORD_COMMA_', ', ').strip()
            cleaned.append(restored)

    return cleaned


def parse_single_intent(req: CommandParseRequest) -> CommandParseResponse:
    raw = req.prompt.strip()
    low = raw.lower()
    ctx = req.context or CommandContext()

    # 1. CONTEXTUAL FOLLOW-UP: "ADD TWO MORE", "ADD ANOTHER ONE"
    if (
        re.search(r"\badd\s+(?:two|three|four|five|2|3|4|5|another|one|more)\s*(?:more)?\b", low)
        and not ("obstacle" in low or "box" in low or "worker" in low or "people" in low)
    ):
        last_action = ctx.last_action_type or ""
        count = 2
        for w, v in WORD_TO_NUM.items():
            if w in low:
                count = v
                break
        count_match = re.search(r"\b(\d+)\b", low)
        if count_match:
            count = int(count_match.group(1))

        if "worker" in last_action:
            return CommandParseResponse(
                action="spawn_workers",
                intent=f"Spawn {count} Additional Workers",
                confidence=0.94,
                parameters=CommandParameters(count=count),
                description=f"Contextual follow-up: Injected {count} additional workers based on previous command.",
                requires_approval=True,
                impact_summary=f"Adds {count} more moving workers to the active scenario",
                proposed_changes=[f"Spawn {count} more articulated workers across aisles"],
                parser_mode="deterministic_fallback",
            )
        elif "obstacle" in last_action:
            return CommandParseResponse(
                action="spawn_obstacle",
                intent=f"Spawn {count} Additional Obstacles",
                confidence=0.94,
                parameters=CommandParameters(count=count, objectType="cube"),
                description=f"Contextual follow-up: Injected {count} additional cargo obstacles.",
                requires_approval=True,
                impact_summary=f"Adds {count} more obstacle colliders",
                proposed_changes=[f"Place {count} additional dynamic cargo boxes in warehouse aisles"],
                parser_mode="deterministic_fallback",
            )
        else:
            return CommandParseResponse(
                action="clarification_needed",
                intent="Clarify Follow-Up Request",
                confidence=0.85,
                parameters=CommandParameters(),
                description="The follow-up reference is ambiguous without preceding context.",
                requires_approval=False,
                impact_summary="No simulation changes",
                proposed_changes=[],
                clarification_question="Would you like to add more workers or cargo crate obstacles?",
                direct_response="Would you like to add more moving workers or cargo crate obstacles?",
                parser_mode="deterministic_fallback",
            )

    # 2. CONTEXTUAL FOLLOW-UP: "REMOVE THAT OBSTACLE" / "DELETE IT"
    if (
        (low.startswith("remove that") or low.startswith("delete that") or low == "remove the obstacle" or low == "delete it")
        and not ("all" in low or "aisle" in low or "barrier" in low)
    ):
        target_id = ctx.last_spawned_obstacle_id
        return CommandParseResponse(
            action="remove_target_obstacle",
            intent="Remove Targeted Obstacle",
            confidence=0.94,
            parameters=CommandParameters(targetObstacleId=target_id),
            description="Remove the most recently placed obstacle from the physics and navigation grids.",
            requires_approval=True,
            impact_summary="Deletes targeted obstacle and restores corridor clearance",
            proposed_changes=[
                f"Remove active collider for obstacle '{target_id or 'most recently placed'}'",
                "Clear obstacle footprint in A* GridMap",
                "Trigger route re-evaluation if navigation is active",
            ],
            direct_response="Prepared removal of the targeted obstacle. Awaiting operator confirmation.",
            parser_mode="deterministic_fallback",
        )

    # 3. CONTEXTUAL FOLLOW-UP: "TRY ANOTHER ROUTE" / "FIND ANOTHER ROUTE"
    if (
        "try another route" in low or "find another route" in low or "find an alternative path" in low or
        "take another route" in low or "detour around" in low
    ):
        return CommandParseResponse(
            action="replan_route",
            intent="Replan Route (Alternative Corridor)",
            confidence=0.95,
            parameters=CommandParameters(navigationPreference="alternative_route"),
            description="Recalculate route to destination using an alternative safe corridor.",
            requires_approval=False,
            impact_summary="AMR recalculates route seeking alternative open aisle",
            proposed_changes=[
                "Force A* pathfinder to evaluate alternative transit corridors",
                "Update planned waypoint ribbon",
            ],
            direct_response="Replanning route via alternative corridor.",
            parser_mode="deterministic_fallback",
        )

    # 4. CONTEXTUAL FOLLOW-UP: "RUN THE SAME TEST AGAIN" / "RETRY MISSION"
    if "run the same test again" in low or "retry the test" in low or "repeat the test" in low or "rerun mission" in low:
        return CommandParseResponse(
            action="start_mission",
            intent="Rerun Simulation Test",
            confidence=0.95,
            parameters=CommandParameters(destinationId="bay-4"),
            description="Reset AMR pose and re-execute the autonomous mission from baseline.",
            requires_approval=True,
            impact_summary="Resets AMR to start position and re-executes mission",
            proposed_changes=[
                "Reset AMR position to charging dock",
                "Recalculate A* path to Bay 4",
                "Engage autonomous driving controller",
            ],
            direct_response="Ready to rerun test from baseline pose. Awaiting operator confirmation.",
            parser_mode="deterministic_fallback",
        )

    # 5. EXPLAIN WHY ROBOT STOPPED / WHAT HAPPENED
    if (
        ("why" in low and ("stop" in low or "halt" in low or "stuck" in low or "not moving" in low or "paused" in low))
        or ("explain" in low and ("stop" in low or "halt" in low or "stuck" in low or "status" in low or "happened" in low or "failure" in low))
        or ("what happened" in low or "why did it halt" in low or "diagnose" in low)
    ):
        explanation = generate_telemetry_explanation(ctx)
        return CommandParseResponse(
            action="query_explanation",
            intent="Explain Robot Stoppage",
            confidence=0.98,
            parameters=CommandParameters(),
            description="Analyze real-time simulation telemetry to diagnose robot stoppage reason.",
            requires_approval=False,
            impact_summary="Telemetry query (Read-Only)",
            proposed_changes=[],
            direct_response=explanation,
            parser_mode="deterministic_fallback",
        )

    # 6. SHOW LATEST COLLISION AND SAFETY EVENTS
    if (
        ("event" in low or "collision" in low or "log" in low or "incident" in low or "near miss" in low)
        and ("show" in low or "latest" in low or "list" in low or "get" in low or "what" in low or "view" in low)
    ):
        response_text = generate_events_summary(ctx)
        return CommandParseResponse(
            action="query_events",
            intent="Query Safety & Collision Events",
            confidence=0.96,
            parameters=CommandParameters(),
            description="Retrieve recent collision metrics and chronological safety event logs.",
            requires_approval=False,
            impact_summary="Telemetry query (Read-Only)",
            proposed_changes=[],
            direct_response=response_text,
            parser_mode="deterministic_fallback",
        )

    # 7. EMERGENCY STOP (Immediate Execution, Highest Safety Priority)
    # Examples: "Emergency stop.", "Stop immediately.", "Halt immediately.", "E-stop.", "Stop right now."
    if (
        "emergency stop" in low
        or "e-stop" in low
        or "estop" in low
        or re.search(r"\b(?:stop|halt)\s+(?:immediately|now|right\s+now|at\s+once)\b", low)
        or re.search(r"\b(?:emergency\s+brake|emergency\s+halt)\b", low)
    ):
        return CommandParseResponse(
            action="emergency_stop",
            intent="Emergency Stop",
            confidence=0.99,
            parameters=CommandParameters(emergencyStopActive=True),
            description="Engage physical emergency brake (18.0 m/s²) and halt robot immediately.",
            requires_approval=False,
            impact_summary="Safety critical: Emergency Stop ENGAGED",
            proposed_changes=["Engage emergency braking mechanism (18.0 m/s²)", "Halt AMR immediately at current position"],
            direct_response="Emergency Stop ENGAGED. Maximum deceleration applied. Robot halted immediately.",
            parser_mode="deterministic_fallback",
        )

    # 8. PAUSE THE SIMULATION (Clock & Physics Frozen)
    # Examples: "Pause the simulation.", "Freeze the simulation.", "Pause sim.", "Freeze sim."
    if (
        re.search(r"\b(?:pause|freeze|suspend)\s+(?:the\s+)?(?:simulation|sim|clock|world)\b", low)
        or low.strip() in ["pause", "freeze", "pause sim", "freeze sim", "pause simulation", "freeze simulation"]
    ):
        return CommandParseResponse(
            action="set_simulation_state",
            intent="Pause Simulation",
            confidence=0.99,
            parameters=CommandParameters(simulationRunning=False),
            description="Pause the simulation clock and freeze all dynamic motion.",
            requires_approval=False,
            impact_summary="Simulation state change: PAUSED",
            proposed_changes=["Set simulation clock to PAUSED", "Hold AMR and dynamic actors in place"],
            direct_response="Simulation clock paused. All robot and dynamic entity movement suspended.",
            parser_mode="deterministic_fallback",
        )

    # 9. PAUSE THE ROBOT (Preserving Route, Destination & Pose)
    # Examples: "Pause the robot.", "Stop the robot temporarily.", "Hold position.", "Pause navigation.", "Hold the robot."
    if (
        re.search(r"\b(?:pause|stop)\s+(?:the\s+)?(?:robot|amr|navigation|mission)\b", low)
        or re.search(r"\bstop\s+(?:the\s+)?(?:robot|amr)\s+temporarily\b", low)
        or re.search(r"\bhold\s+(?:position|the\s+robot|here)\b", low)
        or "pause the robot" in low
        or "stop the robot temporarily" in low
        or "hold position" in low
    ):
        return CommandParseResponse(
            action="pause_mission",
            intent="Pause Robot Navigation",
            confidence=0.98,
            parameters=CommandParameters(),
            description="Temporarily stop robot movement while preserving mission, route, and destination.",
            requires_approval=False,
            impact_summary="Robot state: STOPPED (Route & destination preserved)",
            proposed_changes=["Set robot navigation state to STOPPED", "Hold robot in place without erasing route"],
            direct_response="Robot paused and holding position. Active route and destination preserved.",
            parser_mode="deterministic_fallback",
        )

    # 10. RESUME THE SIMULATION (Clock & Physics Active)
    # Examples: "Resume the simulation.", "Unfreeze the simulation.", "Resume sim.", "Restart the clock."
    if (
        re.search(r"\b(?:resume|unpause|unfreeze)\s+(?:the\s+)?(?:simulation|sim|clock)\b", low)
        or low.strip() in ["resume", "unpause", "unfreeze", "resume sim", "resume simulation"]
    ):
        return CommandParseResponse(
            action="set_simulation_state",
            intent="Resume Simulation",
            confidence=0.99,
            parameters=CommandParameters(simulationRunning=True),
            description="Resume the simulation clock and active robot execution.",
            requires_approval=False,
            impact_summary="Simulation state change: RUNNING",
            proposed_changes=["Set simulation clock to RUNNING", "Resume AMR kinematics and mission execution"],
            direct_response="Simulation clock resumed. Navigation and physics active.",
            parser_mode="deterministic_fallback",
        )

    # 11. RESUME ROBOT NAVIGATION (Continue Active Mission)
    # Examples: "Resume the robot.", "Continue the mission.", "Continue moving.", "Restart navigation.", "Resume navigation."
    if (
        re.search(r"\b(?:continue|resume)\s+(?:the\s+)?(?:mission|robot|navigation|moving|journey|drive)\b", low)
        or re.search(r"\brestart\s+(?:navigation|mission)\b", low)
        or "continue moving" in low
        or "resume the robot" in low
        or "continue the mission" in low
        or "restart navigation" in low
    ):
        return CommandParseResponse(
            action="resume_mission",
            intent="Resume Robot Navigation",
            confidence=0.98,
            parameters=CommandParameters(),
            description="Resume autonomous robot navigation along planned path.",
            requires_approval=False,
            impact_summary="Robot state: MOVING (Resuming mission)",
            proposed_changes=["Set robot navigation state to MOVING", "Continue along planned trajectory"],
            direct_response="Navigation resumed. Robot continuing mission along planned route.",
            parser_mode="deterministic_fallback",
        )

    # 12. START THE SIMULATION (Clock & Physics Active)
    # Examples: "Start the simulation.", "Run the simulation.", "Start sim."
    if re.search(r"\b(?:start|run|launch)\s+(?:the\s+)?(?:simulation|sim)\b", low):
        return CommandParseResponse(
            action="set_simulation_state",
            intent="Start Simulation",
            confidence=0.99,
            parameters=CommandParameters(simulationRunning=True),
            description="Start the simulation clock and physics engine.",
            requires_approval=False,
            impact_summary="Simulation state change: RUNNING",
            proposed_changes=["Set simulation clock to RUNNING", "Enable active physics and sensor perception"],
            direct_response="Simulation started. Clock and physics engine active.",
            parser_mode="deterministic_fallback",
        )

    # 13. SET DIFFICULTY (Flexible Synonyms & Contextual Hardening)
    # Examples: "Make it tough.", "Increase the difficulty.", "Give the robot a really challenging mission.", "Put it in extreme mode.", "Make the warehouse extreme.", "Make it harder."
    if (
        re.search(r"\b(?:tough|challenging|extreme|impossible|stress\s+test|harder|difficulty|hard\s+mode)\b", low)
        or (("make" in low or "set" in low or "put" in low or "increase" in low) and ("hard" in low or "tough" in low or "extreme" in low or "difficult" in low or "challenging" in low or "difficulty" in low))
    ):
        level = "extreme"
        if "extreme" in low or "impossible" in low or "tough" in low or "challenging" in low or "stress" in low or "increase" in low:
            level = "extreme"
        elif "harder" in low:
            curr = ctx.current_difficulty or "normal"
            level = "extreme" if curr == "hard" else "hard"
        elif "hard" in low or "difficult" in low:
            level = "hard"
        elif "normal" in low or "easy" in low or "standard" in low:
            level = "normal"

        return CommandParseResponse(
            action="set_difficulty",
            intent=f"Set Simulation Difficulty to {level.upper()}",
            confidence=0.96,
            parameters=CommandParameters(difficulty=level),
            description=f"Configure simulation for {level.upper()} testing stress conditions.",
            requires_approval=True,
            impact_summary=f"Injects multiple moving hazards and closes critical transit corridors ({level.upper()})",
            proposed_changes=[
                f"Set scenario difficulty profile to {level.upper()}",
                "Spawn moving workers along primary aisles",
                "Place cargo hazards along central cross-transit arterial",
                "Close Aisle 2 center crossing to stress route replanning",
            ],
            direct_response=f"Configured {level.upper()} difficulty scenario. Awaiting operator confirmation.",
            parser_mode="deterministic_fallback",
        )

    # 14. START AUTONOMOUS MISSION & NAVIGATION PREFERENCES
    # Examples: "Start the robot.", "Start autonomous navigation.", "Begin the mission.", "Launch the autonomous robot.", "Take the shortest path."
    if (
        (re.search(r"\b(?:start|begin|launch|engage|drive|navigate|go|run)\b", low) and re.search(r"\b(?:robot|mission|navigation|autonomous|amr|course|path|route)\b", low))
        or re.search(r"\b(?:take\s+it\s+through|use\s+the|find\s+the)\s+(?:shortest|quickest|fastest|safe)\s+(?:path|route)\b", low)
        or re.search(r"\bshortest\s+(?:safe\s+)?(?:path|route)\b", low)
    ):
        pref = "default"
        if "shortest" in low or "quickest" in low or "fastest" in low or "direct" in low:
            pref = "shortest_safe_path"
        elif "avoid" in low or "alternative" in low:
            pref = "alternative_route"

        pref_label = " (Shortest Safe Route)" if pref == "shortest_safe_path" else (" (Alternative Route)" if pref == "alternative_route" else "")
        return CommandParseResponse(
            action="start_mission",
            intent=f"Start Autonomous Mission{pref_label}",
            confidence=0.96,
            parameters=CommandParameters(navigationPreference=pref),
            description=f"Initiate A* pathfinding and autonomous waypoint pursuit to Bay 4 Delivery Drop-off using {pref.replace('_', ' ')}.",
            requires_approval=False,
            impact_summary=f"AMR will compute A* route and begin autonomous driving ({pref.replace('_', ' ')})",
            proposed_changes=[
                f"Calculate collision-free route from current pose to Bay 4 using {pref.replace('_', ' ')}",
                "Strictly adhere to 0.54m obstacle inflation safety clearance and Rapier collision boundaries",
                "Engage differential-drive steering controller and 15-beam LiDAR obstacle avoidance",
            ],
            direct_response=f"Autonomous mission started{pref_label}. Navigating to Bay 4.",
            parser_mode="deterministic_fallback",
        )

    # 11. CROWDED WAREHOUSE / MOVING WORKERS
    # Examples: "Create a crowded warehouse with five moving workers.", "Add five workers.", "Put people in the aisles."
    if re.search(r"\b(?:workers?|pedestrians?|persons?|people|crowd(?:ed)?)\b", low):
        count = 5
        count_match = re.search(r"\b(\d+)\b", low)
        if count_match:
            count = int(count_match.group(1))
        else:
            for word, val in WORD_TO_NUM.items():
                if word in low:
                    count = val
                    break

        return CommandParseResponse(
            action="spawn_workers",
            intent=f"Spawn {count} Moving Workers",
            confidence=0.95,
            parameters=CommandParameters(count=count),
            description=f"Inject {count} autonomous warehouse workers patrolling major cross-aisles.",
            requires_approval=True,
            impact_summary=f"Adds {count} dynamic obstacles into physics and navigation grids",
            proposed_changes=[
                f"Spawn {count} articulated 3D workers with high-visibility safety vests and hardhats",
                "Register each worker in Rapier physics engine as kinematic colliders",
                "Synchronize moving coordinates into A* GridMap and LiDAR perception on every frame",
            ],
            direct_response=f"Configured scenario with {count} moving warehouse workers. Awaiting operator confirmation.",
            parser_mode="deterministic_fallback",
        )

    # 12. UNBLOCK AISLE / REOPEN AISLE
    # Examples: "Remove the aisle blockage.", "Unblock aisle two.", "Reopen aisle 2.", "Clear the barrier in aisle 2."
    if (
        re.search(r"\b(?:unblock(?:ed|ing)?|reopen(?:ed|ing)?|clear(?:ed|ing)?|remove(?:d|ing)?)\b", low)
        and re.search(r"\b(?:aisles?|corridors?|lanes?|barricades?|blockages?|barriers?)\b", low)
        and not (re.search(r"\b(?:all|dynamic)\b", low) and "obstacle" in low)
    ):
        aisle_id, aisle_name = extract_aisle(low)
        return CommandParseResponse(
            action="unblock_aisle",
            intent=f"Unblock {aisle_name}",
            confidence=0.95,
            parameters=CommandParameters(aisleId=aisle_id, aisleName=aisle_name),
            description=f"Remove barricade from {aisle_name} and reopen transit corridor.",
            requires_approval=True,
            impact_summary=f"Restores passage through {aisle_name}",
            proposed_changes=[
                f"Remove physical barricade collider from {aisle_name}",
                "Clear barrier cells from GridMap occupancy grid",
                "Allow AMR to utilize direct corridor for optimal pathfinding",
            ],
            direct_response=f"Prepared removal of barricade from {aisle_name}. Awaiting operator confirmation.",
            parser_mode="deterministic_fallback",
        )

    # 13. BLOCK AISLE
    # Examples: "Block the second aisle.", "Close aisle two.", "Make aisle two inaccessible.", "Barricade aisle 2."
    if (
        not re.search(r"\b(?:unblock|reopen|clear|remove)\b", low)
        and re.search(r"\b(?:blocks?|blocking|close[sd]?|closing|barricades?|barricading|shuts?|shutting|seals?|sealing|inaccessible)\b", low)
        and re.search(r"\b(?:aisles?|corridors?|lanes?)\b", low)
    ):
        # Ambiguity check: did the user mention which aisle?
        has_specific_aisle = False
        for k in AISLE_MAP.keys():
            if k in low:
                has_specific_aisle = True
                break
        if not has_specific_aisle:
            return CommandParseResponse(
                action="clarification_needed",
                intent="Clarify Aisle Selection",
                confidence=0.88,
                parameters=CommandParameters(),
                description="The operator requested blocking an aisle without specifying which one.",
                requires_approval=False,
                impact_summary="No simulation changes",
                proposed_changes=[],
                clarification_question="Which aisle would you like to block? You can specify Aisle 1, Aisle 2, Aisle 3, West Transit Arterial, or East Transit Arterial.",
                direct_response="Which aisle would you like to block? You can specify Aisle 1, Aisle 2, Aisle 3, West Transit Arterial, or East Transit Arterial.",
                parser_mode="deterministic_fallback",
            )

        aisle_id, aisle_name = extract_aisle(low)
        return CommandParseResponse(
            action="block_aisle",
            intent=f"Block {aisle_name}",
            confidence=0.96,
            parameters=CommandParameters(aisleId=aisle_id, aisleName=aisle_name),
            description=f"Erect heavy industrial barricade across {aisle_name}.",
            requires_approval=True,
            impact_summary=f"Seals corridor {aisle_id} and forces autonomous rerouting",
            proposed_changes=[
                f"Spawn physical Rapier barricade collider across {aisle_name}",
                "Render yellow/black hazard chevrons and flashing amber beacons",
                "Mark aisle cells as impassable in GridMap and trigger instant A* replan",
            ],
            direct_response=f"Prepared barricade across {aisle_name}. Awaiting operator confirmation.",
            parser_mode="deterministic_fallback",
        )

    # 14. CLEAR ALL DYNAMIC OBSTACLES
    # Examples: "Clear all obstacles.", "Remove dynamic objects.", "Clean up crates.", "Reset obstacles."
    if (
        re.search(r"\b(?:clear|remove|delete|reset|clean\s+up)\b", low)
        and re.search(r"\b(?:obstacles?|boxes|crates?|spheres?|objects?|hazards?)\b", low)
        and not re.search(r"\b(?:aisles?|barriers?|barricades?)\b", low)
    ):
        return CommandParseResponse(
            action="clear_obstacles",
            intent="Clear All Dynamic Obstacles",
            confidence=0.97,
            parameters=CommandParameters(),
            description="Remove all dynamically placed crates, spheres, and workers from the warehouse.",
            requires_approval=True,
            impact_summary="Deletes all user-spawned obstacles from physics and navigation",
            proposed_changes=[
                "Remove all placed dynamic bodies from Rapier physics world",
                "Clear dynamic cells from A* GridMap",
                "Reopen previously obstructed corridors",
            ],
            direct_response="Prepared to clear all dynamic test obstacles. Awaiting operator confirmation.",
            parser_mode="deterministic_fallback",
        )

    # 15. AMBIGUOUS ACTION DETECTION
    # Catch ambiguous phrases before fuzzy placement rules
    clean_stripped = low.rstrip('.!?').strip()
    if (
        clean_stripped in ["drop it", "drop something", "do something", "change speed", "change something", "block it", "make it different", "put it"]
        or re.search(r"^\s*(?:drop|place|put)\s+(?:something|it)\s*[\.!\?]?\s*$", low)
    ):
        return CommandParseResponse(
            action="clarification_needed",
            intent="Ambiguous Instruction",
            confidence=0.75,
            parameters=CommandParameters(),
            description="The instruction is too ambiguous to determine the exact simulation action.",
            requires_approval=False,
            impact_summary="No simulation changes",
            proposed_changes=[],
            clarification_question="Could you please specify what action you would like to perform? For example: 'Place a box 3m ahead', 'Block aisle 2', or 'Set difficulty to extreme'.",
            direct_response=f"I need a little more detail to execute '{raw}'. Would you like to spawn an obstacle ahead, block a specific aisle, or start an autonomous navigation mission?",
            parser_mode="deterministic_fallback",
        )

    # 16. PLACE OBSTACLE / BOX / SPHERE (Flexible natural language)
    # Examples: "Put a box in front of the robot.", "Drop something three metres ahead.", "Create an obstacle in its path.", "Place a box 3m ahead."
    if (
        re.search(r"\b(?:places?|placing|drops?|dropping|spawns?|spawning|puts?|putting|creates?|creating|adds?|adding)\b", low)
        and re.search(r"\b(?:box(?:es)?|crates?|obstacles?|spheres?|balls?|cubes?|hazards?|something|barriers?)\b", low)
        and not re.search(r"\b(?:aisles?|workers?|pedestrians?|people)\b", low)
    ):
        obj_type = "sphere" if ("sphere" in low or "ball" in low) else "cube"

        # Check explicit coordinates: e.g. "at coordinates X 5, Z 8" or "x: 5, z: 8"
        coord_match = re.search(r"[xX]\s*[:=]?\s*(-?\d+\.?\d*)\s*,?\s*[zZ]\s*[:=]?\s*(-?\d+\.?\d*)", raw)
        if coord_match:
            x_val = float(coord_match.group(1))
            z_val = float(coord_match.group(2))

            # Validate against warehouse bounds
            if (
                x_val < WAREHOUSE_BOUNDS["min_x"]
                or x_val > WAREHOUSE_BOUNDS["max_x"]
                or z_val < WAREHOUSE_BOUNDS["min_z"]
                or z_val > WAREHOUSE_BOUNDS["max_z"]
            ):
                return CommandParseResponse(
                    action="clarification_needed",
                    intent="Out of Bounds Coordinates",
                    confidence=0.90,
                    parameters=CommandParameters(position=[x_val, 0.4, z_val]),
                    description="Requested obstacle coordinates fall outside warehouse boundaries.",
                    requires_approval=False,
                    impact_summary="No simulation changes",
                    proposed_changes=[],
                    clarification_question=f"Coordinates [{x_val:.1f}, {z_val:.1f}] are outside warehouse boundaries ({WAREHOUSE_BOUNDS['min_x']} to {WAREHOUSE_BOUNDS['max_x']} on X, {WAREHOUSE_BOUNDS['min_z']} to {WAREHOUSE_BOUNDS['max_z']} on Z). Please specify coordinates within the warehouse.",
                    direct_response=f"Coordinates [{x_val:.1f}, {z_val:.1f}] are outside the warehouse floor boundaries. Please select coordinates within [{WAREHOUSE_BOUNDS['min_x']}m, {WAREHOUSE_BOUNDS['max_x']}m] for X and [{WAREHOUSE_BOUNDS['min_z']}m, {WAREHOUSE_BOUNDS['max_z']}m] for Z.",
                    parser_mode="deterministic_fallback",
                )

            pos = [x_val, 0.4 if obj_type == "cube" else 0.5, z_val]
            return CommandParseResponse(
                action="spawn_obstacle",
                intent=f"Place {obj_type.capitalize()} at [{x_val:.1f}, {z_val:.1f}]",
                confidence=0.96,
                parameters=CommandParameters(
                    objectType=obj_type,
                    position=pos,
                ),
                description=f"Place a physical {obj_type} at coordinates [{x_val:.1f}, {z_val:.1f}].",
                requires_approval=True,
                impact_summary=f"Spawns {obj_type} with active collision and navigation inflation",
                proposed_changes=[
                    f"Create dynamic {obj_type} at world coordinates [{x_val:.1f}, 0.4, {z_val:.1f}]",
                    "Add rigid body collider in Rapier physics",
                    "Inflate obstacle radius in GridMap occupancy grid",
                ],
                direct_response=f"Configured {obj_type} placement at [{x_val:.1f}, {z_val:.1f}]. Awaiting operator confirmation.",
                parser_mode="deterministic_fallback",
            )

        # Check relative distance ahead
        # e.g., "three metres ahead", "3m in front", "in front of the robot", "in its path"
        dist_ahead = 3.0
        dist_match = re.search(r"(\d+\.?\d*)\s*(?:m|meter|metre)", low)
        if dist_match:
            dist_ahead = float(dist_match.group(1))
        else:
            for word, val in WORD_TO_NUM.items():
                if f"{word} metre" in low or f"{word} meter" in low or f"{word} m " in low or f"{word} meters" in low:
                    dist_ahead = float(val)
                    break

        # Compute position ahead based on robot position and yaw
        pos = None
        if ctx.robot_position and len(ctx.robot_position) >= 3:
            rx, ry, rz = ctx.robot_position[0], ctx.robot_position[1], ctx.robot_position[2]
            yaw = ctx.robot_yaw or 0.0
            tx = rx + math.sin(yaw) * dist_ahead
            tz = rz + math.cos(yaw) * dist_ahead
            pos = [round(tx, 2), 0.4 if obj_type == "cube" else 0.5, round(tz, 2)]

        return CommandParseResponse(
            action="spawn_obstacle",
            intent=f"Place {obj_type.capitalize()} {dist_ahead:.1f}m Ahead of Robot",
            confidence=0.96,
            parameters=CommandParameters(
                objectType=obj_type,
                position=pos,
                relativeToRobot={"distanceAhead": dist_ahead},
            ),
            description=f"Place a {obj_type} {dist_ahead:.1f} meters directly in the AMR forward path.",
            requires_approval=True,
            impact_summary=f"Tests predictive braking and dynamic obstacle avoidance at {dist_ahead:.1f}m",
            proposed_changes=[
                f"Calculate coordinate {dist_ahead:.1f}m along robot heading vector" + (f" -> [{pos[0]}, {pos[2]}]" if pos else ""),
                f"Spawn physical {obj_type} with Rapier collision geometry",
                "LiDAR sensor will detect obstacle and trigger reactive replanning/braking",
            ],
            direct_response=f"Configured {obj_type} placement {dist_ahead:.1f}m ahead of the robot. Awaiting operator confirmation.",
            parser_mode="deterministic_fallback",
        )

    # 17. DEFAULT UNRECOGNIZED FALLBACK
    return CommandParseResponse(
        action="unknown",
        intent="Unrecognized Instruction",
        confidence=0.15,
        parameters=CommandParameters(),
        description="The command could not be matched to a supported simulation action.",
        requires_approval=False,
        impact_summary="No simulation changes",
        proposed_changes=[],
        direct_response=(
            f"I did not recognize the command '{raw}'. Supported actions include:\n"
            "- 'Place a box three metres ahead of the robot' (or 'Put a box in front')\n"
            "- 'Block the second aisle' (or 'Close aisle 2')\n"
            "- 'Make it tough and take it through the shortest path'\n"
            "- 'Create a crowded warehouse with five moving workers'\n"
            "- 'Make the simulation extremely difficult'\n"
            "- 'Take the shortest path' / 'Start the autonomous mission'\n"
            "- 'Pause the robot' / 'Resume the simulation'\n"
            "- 'Explain why the robot stopped'\n"
            "- 'Show me the latest collision and safety events'"
        ),
        parser_mode="deterministic_fallback",
    )


def extract_aisle(text: str) -> Tuple[str, str]:
    for key, (aid, aname) in AISLE_MAP.items():
        if f"aisle {key}" in text or f"aisle #{key}" in text or f"aisle-{key}" in text or f"lane {key}" in text:
            return aid, aname
        if f"second aisle" in text or "2nd aisle" in text:
            return "aisle-2", "Aisle 2 (Rack Bay B-C)"
        if f"first aisle" in text or "1st aisle" in text:
            return "aisle-1", "Aisle 1 (Rack Bay A-B)"
        if f"third aisle" in text or "3rd aisle" in text:
            return "aisle-3", "Aisle 3 (Rack Bay C-D)"
    # Default to aisle-2 if aisle referenced generally
    return "aisle-2", "Aisle 2 (Rack Bay B-C)"


def generate_telemetry_explanation(ctx: CommandContext) -> str:
    lines = []
    lines.append("🤖 **ROBOT TELEMETRY ROOT-CAUSE ANALYSIS:**")

    if ctx.is_running is False:
        lines.append("• **Simulation State**: The simulation clock is currently **PAUSED** by the operator.")
        return "\n".join(lines)

    if ctx.is_e_stopped:
        lines.append("• **Safety Stop**: Emergency Stop (E-Stop) is currently **ENGAGED**.")
        return "\n".join(lines)

    if ctx.nav_state == "COMPLETED":
        lines.append("• **Mission Status**: Destination reached! The AMR successfully arrived at its target destination.")
        return "\n".join(lines)

    if ctx.nav_state == "IDLE":
        lines.append("• **Mission Status**: AMR is in **STANDBY (IDLE)** mode. No active mission path is being pursued.")
        return "\n".join(lines)

    if ctx.nav_state == "FAILED":
        reason = ctx.failure_explanation or "All available warehouse corridors to the destination are obstructed."
        lines.append(f"• **Navigation Failure**: {reason}")
        return "\n".join(lines)

    if ctx.closest_obstacle:
        dist_str = f"{ctx.forward_clearance:.2f}m" if ctx.forward_clearance is not None else "close range"
        coords_str = (
            f"[{ctx.obstacle_position[0]:.1f}, {ctx.obstacle_position[1]:.1f}]"
            if ctx.obstacle_position and len(ctx.obstacle_position) >= 2
            else "directly ahead"
        )
        stop_dist_str = f"{ctx.stopping_distance:.2f}m" if ctx.stopping_distance is not None else "N/A"
        risk = ctx.risk_level or "caution"
        braking = ctx.braking_status or "controlled_braking"

        lines.append(f"• **Detected Threat**: '{ctx.closest_obstacle}' detected at {coords_str}.")
        lines.append(f"• **Distance to Obstacle**: Forward clearance is **{dist_str}**.")
        lines.append(f"• **Braking Horizon**: Calculated safe stopping distance ($d=v^2/2a$) is **{stop_dist_str}**.")
        lines.append(f"• **Risk Classification**: **{risk.upper()}** (Braking status: {braking.replace('_', ' ').upper()}).")

        if risk == "critical" or braking == "emergency_braking":
            lines.append("• **Safety Action**: Critical clearance encroached! Emergency brake engaged ($18.0\\text{ m/s}^2$) to prevent physical contact.")
        else:
            lines.append("• **Safety Action**: AMR is actively decelerating and executing an A* replan detour around the obstruction.")
    else:
        lines.append("• **Perception**: Forward LiDAR path is clear. Current motion status: Stopped/Holding.")

    if ctx.route_validity == "blocked":
        lines.append("• **Corridor State**: Planned corridor is blocked by obstacles. The autonomous replanner is evaluating alternative aisles.")

    return "\n".join(lines)


def generate_events_summary(ctx: CommandContext) -> str:
    lines = []
    lines.append("📊 **LATEST COLLISION & SAFETY EVENT REPORT:**")
    collisions = ctx.collision_count if ctx.collision_count is not None else 0
    force = ctx.last_collision_force if ctx.last_collision_force is not None else 0.0

    lines.append(f"• **Physical Collisions Recorded**: **{collisions}**")
    if collisions > 0:
        lines.append(f"• **Last Impact Force**: {force:.1f} N")

    if ctx.recent_events and len(ctx.recent_events) > 0:
        lines.append("\n**Recent Chronological Event Log:**")
        for ev in ctx.recent_events[:6]:
            lines.append(f"  - {ev}")
    else:
        lines.append("• **Event Stream**: No recent safety anomalies or collision events recorded.")

    return "\n".join(lines)


def call_llm_parser(req: CommandParseRequest, api_key: str) -> Optional[CommandParseResponse]:
    """
    Optional LLM integration when GEMINI_API_KEY is available.
    Enforces strict structured JSON matching CommandParseResponse.
    """
    import httpx
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
    system_prompt = (
        "You are an industrial robotics AI command parser. Parse natural language instructions into structured JSON "
        "whitelisted actions: spawn_obstacle, spawn_workers, block_aisle, unblock_aisle, clear_obstacles, "
        "set_simulation_state, start_mission, set_difficulty, query_explanation, query_events. "
        "Return pure JSON conforming to CommandParseResponse schema."
    )
    payload = {
        "contents": [{"parts": [{"text": f"{system_prompt}\n\nCommand: {req.prompt}"}]}],
        "generationConfig": {"response_mime_type": "application/json"}
    }
    with httpx.Client(timeout=4.0) as client:
        resp = client.post(url, json=payload)
        if resp.status_code == 200:
            content = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
            parsed_json = json.loads(content)
            parsed_json["parser_mode"] = "gemini_llm"
            return CommandParseResponse(**parsed_json)
    return None
