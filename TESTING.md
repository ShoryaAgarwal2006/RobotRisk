# TESTING STRATEGY & TEST SUITE: ROBOTRISK AI

## 1. Overview & Verification Strategy

To guarantee a reliable, deterministic, and glitch-free hackathon demonstration, ROBOTRISK AI follows a multi-tier testing strategy:

1. **Unit & Algorithm Tests**: Pathfinding (A*), grid mapping, differential-drive kinematics, warehouse spatial layout clearances, camera triggers, telemetry math, collision distance estimation, and scenario scheduler timing.
2. **Schema & API Validation Tests**: Pydantic schema validation for AI scenario generation, parameter ranges, and error handling.
3. **Integration & Physics Tests**: Rapier physics stability, static collider containment, dynamic rigid body collision responses, teleoperation kinematics, and waypoint following convergence.
4. **Deterministic Rerun Verification**: Verifying that identical seeds produce identical hazard behaviors and measuring delta improvements after parameter optimization.

---

## 2. Test Cases Matrix

| Test ID | Category | Description | Success Criteria | Status |
| :--- | :--- | :--- | :--- | :--- |
| **TC-01** | Frontend Core | Vite build and TypeScript compilation | No compilation errors; clean type check (`tsc --noEmit`); clean production build. | ✅ **PASSED** |
| **TC-02** | Physics Loop | Rapier physics canvas initialization | Canvas renders at 60 FPS; ground collider prevents falling; dynamic bodies bounce and collide. | ✅ **PASSED** |
| **TC-03** | Teleoperation | Manual WASD / Arrow key robot control | Robot moves linearly and turns smoothly; halts on key release; adheres to differential kinematics. | ✅ **PASSED** |
| **TC-04** | Collision Detection | Robot collides with warehouse racks & walls | Rapier registers contact; impact logged in telemetry; no mesh clipping or wall tunneling; glides smoothly along racks. | ✅ **PASSED** |
| **TC-05** | Pathfinding | A* grid shortest path computation | Returns non-colliding waypoint path between arbitrary open points. | ✅ **PASSED** |
| **TC-06** | Reactive Avoidance | Obstacle placed directly in active path | Sensor detects obstacle within lookahead range; triggers replan or stop. | ✅ **PASSED** |
| **TC-07** | Scenario Engine | Scheduled hazard triggers at exact time | Falling box / pedestrian spawns and executes trajectory at $t_{trigger}$. | ⏳ Pending (M5) |
| **TC-08** | Schema Validation | Invalid scenario JSON submitted to backend | Backend rejects with HTTP 422 and descriptive error; no crash. | ⏳ Pending (M6) |
| **TC-09** | Deterministic Fallback | NL scenario request without backend / LLM key | Deterministic rule engine produces valid scenario successfully. | ⏳ Pending (M6) |
| **TC-10** | Human Approval Gate | AI recommends parameter modifications | Parameters do NOT apply until user clicks "Approve"; reverts cleanly on reject. | ⏳ Pending (M6) |
| **TC-11** | Telemetry Accuracy | Collision & near-miss counter during run | Telemetry metrics match ground-truth physical contact count. | ⏳ Pending (M7) |
| **TC-12** | Benchmarking Comparison | Same scenario rerun with tuned parameters | Original vs Tuned metrics displayed side-by-side in Recharts. | ⏳ Pending (M7) |

---

## 3. Automated Test Execution Commands

```bash
# Frontend Unit Tests (Vitest)
cd frontend
npm test

# Frontend Type Check & Linter
cd frontend
npm run lint

# Frontend Production Bundle Build
cd frontend
npm run build

# Backend Tests & Schema Validation (Pytest)
cd ../backend
source venv/bin/activate
PYTHONPATH=.. pytest tests
```

---

## 4. Test Execution Log

### Milestone 1 Execution (2026-11-03)
- **Frontend Typecheck (`npm run lint`)**: Passed cleanly with 0 errors.
- **Frontend Bundle Build (`npm run build`)**: Vite built production bundle in 3.05s without errors.
- **Frontend Unit Tests (`npm test`)**: 5 passed, duration 345ms.
- **Backend API Tests (`pytest backend/tests`)**: 2 passed, duration 0.20s.

### Milestone 2 Execution (2026-11-03)
- **Frontend Kinematics & Store Tests (`npm test`)**: 11 passed across 2 test files in 362ms.
- **Frontend Typecheck & Production Build**: Passed with 0 errors.

### Milestone 3 Execution & Bug Fix Verification (2026-11-03)
- **Warehouse Config & Spatial Tests (`warehouseConfig.test.ts`)**: 6 passed (validates $40\times 32\text{ m}$ bounds, robot spawn safety margin, delivery target position, charging station separation, aisle clearances $\ge 2.5\text{ m}$, and 4 operational zones).
- **Store & Camera Trigger Tests (`simulationStore.test.ts`)**: 8 passed (includes pose updates, cross-mode pose preservation, E-Stop toggle, battery drain, reset pose, collision recording, and camera reset trigger verification).
- **Kinematics Tests (`kinematics.test.ts`)**: 4 passed.
- **Total Frontend Tests (`npm test`)**: **18 passed across 3 test suites in 365ms**.
- **Frontend Typecheck (`npm run lint` &rarr; `tsc --noEmit`)**: Clean typecheck with 0 errors.
- **Frontend Production Bundle Build (`npm run build`)**: Built in 3.15s with 0 errors.
- **Physical Collision & Movement Verification**:
  - Cylindrical AMR hull ($radius = 0.34\text{ m}$, $friction = 0.05$) verified: AMR glides along rack faces and turns past shelf corners without wedging or sticking.
  - Pallet stacks relocated out of active aisle corridors (`aisle-1`, `aisle-3`, East transit) to perimeter staging areas.
  - Camera orbiting verified: Left-drag rotates, right-drag pans, mouse wheel zooms in `follow`, `orbit`, and `top_down` modes without flipping or being overwritten by follow logic.

### Milestone 4 Execution: Autonomous Lab & Reactive Navigation (2026-11-03)
- **Pathfinding & Navigation Unit Tests (`navigation.test.ts`)**: 12 passed:
  - World-to-grid and grid-to-world coordinate transformations with warehouse origin offsets.
  - Obstacle inflation safety buffer verification (marking cells within $0.54\text{ m}$ radius as occupied).
  - Dynamic obstacle registration, collision check, and clearance.
  - Raycast line-of-sight clearance validation through open aisles.
  - A* path generation from Charging Station to Bay 4 Delivery Zone.
  - String-pulling path smoothing (eliminating unnecessary zig-zag waypoints along straight corridors).
  - Out-of-bounds start/goal coordinate rejection.
  - Path failure detection when destination is fully enclosed/blocked.
  - Multi-beam LiDAR sensor raycasting and nearest-obstacle distance estimation.
  - Threat level classification (`clear` $\ge 3.0\text{ m}$, `caution` between $1.2\text{ m}$ and $3.0\text{ m}$, `critical` $< 1.2\text{ m}$).
  - Lateral proximity detection for left/right flank clearance.
- **Full Test Suite Status (`npm test`)**: **30 passed across 4 test files in 397ms**.
- **Frontend Typecheck (`npm run lint` &rarr; `tsc --noEmit`)**: Clean typecheck with 0 errors.
- **Frontend Production Bundle Build (`npm run build`)**: Vite built in 3.20s with 0 errors.
- **Backend API Tests (`pytest backend/tests`)**: 2 passed in 0.20s.

### Autonomous Navigation & Interactive Obstacle Placement Repair Execution (2026-11-03)
- **Repair Test Suite (`obstacleAndReplanning.test.ts`)**: 8 passed:
  - **A. Normal Autonomous Navigation**: Clean collision-free trajectory from Charging Dock to Bay 4.
  - **B. Interactive Box Placement**: Placing box on active path triggers critical LiDAR threat detection ($1.08\text{ m}$ surface distance), flags route as blocked (`isPathBlocked === true`).
  - **C. Interactive Sphere Placement**: Sphere placed at $[0.0, -3.0]$ marks cell as unwalkable and matches robot forward LiDAR coordinates $[0.0, -3.0]$.
  - **D. Aisle Barricade & Detour**: Blocking Aisle 2 center crossing forces A* to find a genuinely different alternative detour (`pathsDiffer === true`).
  - **E. Complete Obstruction & Safe Stop**: When all approach corridors to Bay 4 are blocked by barriers, A* returns `null` and controller safely halts robot with clear failure diagnosis.
  - **F. Obstacle Removal**: Removing a barrier instantly restores path and enables robot to navigate again.
  - **G. Physical vs Inflated Grid**: Verifies that physical obstacle boundaries do not leak into aisle traversable space while navigation grid maintains safety inflation buffer.
  - **H. Anti-Loop Replanning & Cooldown**: Verifies that blocked robot does NOT spam replans on every frame, enforcing minimum cooldown ($1.2\text{ s}$).
- **Automated Test Summary (`npm test`)**: **38 passed across 5 test suites in 478ms**.
- **TypeScript Static Analysis (`npm run lint` &rarr; `tsc --noEmit`)**: **0 errors**.
- **Production Bundle Build (`npm run build`)**: Vite production bundle compiled in **3.32s** with 0 errors.
- **Backend Health Check (`pytest backend/tests`)**: **2 passed in 0.21s**.

### Dynamic Obstacle Avoidance & Predictive Braking Execution (2026-11-04)
- **New Test Suite (`dynamicObstacleAvoidance.test.ts`)**: 8 passed:
  - **Scenario A1: Predictive Stopping-Distance Deceleration**: Verifies $d_{\text{stop}}(v) = \frac{v^2}{2a}$ calculation ($0.52\text{ m}$ at $2.5\text{ m/s}$) and controlled deceleration before replanning.
  - **Scenario A2: Proactive Detour Replanning**: Robot dynamically discovers an alternative detour route around a placed box without collision.
  - **Scenario B: Moving Robot Sphere Detection**: Verified exact coordinates $[x, z]$ reporting and surface distance calculation.
  - **Scenario C1: Emergency Braking Engagement**: When obstacle appears within critical boundary ($< 1.01\text{ m}$ at $2.5\text{ m/s}$), motor velocity cuts to 0 and emergency braking flag triggers.
  - **Scenario C2: High-Rate Braking Deceleration ($18.0\text{ m/s}^2$)**: Halts high-speed robot within $\le 0.14\text{ s}$ and $< 0.20\text{ m}$ displacement.
  - **Scenario D: Rear-Placed Obstacle Rejection**: Obstacles placed behind moving robot ($z_{\text{local}} \le 0$) do not trigger emergency braking or false stops.
  - **Scenario E: Obstacle Removal Restores Direct Path**: Removing obstacle reopens the corridor and original direct route is restored.
  - **Scenario F: Rapid Dynamic Placements Stability**: 15 rapid dynamic obstacle placements process cleanly with zero duplicate colliders or memory leaks.
- **Automated Test Summary (`npm test`)**: **46 passed across 6 test suites in 502ms**.
- **TypeScript Static Analysis (`npm run lint` &rarr; `tsc --noEmit`)**: **0 errors**.
- **Production Bundle Build (`npm run build`)**: Vite production bundle compiled in **3.29s** with 0 errors.
- **Backend Health Check (`pytest backend/tests`)**: **2 passed in 0.15s**.

### Phase 2: AI Command Center Execution (2026-11-04)
- **AI Command Center Suite (`aiCommandCenter.test.ts`)**: 12 passed.
- **Backend Commands Suite (`backend/tests/test_command.py`)**: 7 passed.
- **Backend Health Suite (`backend/tests/test_health.py`)**: 2 passed.
- **Total Passing Tests**: 58 frontend, 9 backend.

### Phase 3: Intelligent Autonomous Obstacle Avoidance Execution (2026-11-04)
- **New Test Suite (`intelligentAvoidance.test.ts`)**: 8 passed:
  - **Test 1.1 (Box Bypass)**: Evaluates dynamic window candidate trajectories, verifies lateral curvature steering with linear velocity $> 0.5\text{ m/s}$, angular velocity $> 0.2\text{ rad/s}$, and min clearance $> 0.2\text{ m}$.
  - **Test 1.2 (Sphere Bypass)**: Verified smooth continuous S-curve steering around spherical obstacle.
  - **Test 1.3 (Full Barricade Infeasibility)**: Correctly identifies full-span barrier as impassable and returns `isFeasible: false, bypassDirection: 'none'`.
  - **Test 2.1 (Two-Layer Integration)**: Executes Layer B local avoidance smoothly when obstacle warning is triggered without halting to zero.
  - **Test 2.2 (Barricade Safety Braking)**: Controlled predictive braking reduces velocity and halts robot when corridor is completely blocked by full-span barrier.
  - **Test 3 (Moving Worker Crossing Path)**: Local planner avoids or yields while worker crosses, and resumes full cruising speed ($> 2.5\text{ m/s}$) once the worker moves along their patrol path.
  - **Test 4 (Multi-Obstacle Slalom / Extreme Difficulty)**: Navigates multi-obstacle field without permanent stall, verifying clearance margins across all waypoints.
  - **Test 5 (Corridor Reopening & Autonomous Resumption)**: When blocked corridor reopens (barrier deleted or cleared), system detects reopened route and automatically resumes mission.

### Critical Bug Fix: Robot Stuck During Turns & Turning Regression Suite (2026-11-04)
- **Root Cause Verified**:
  - `sensorUtils.ts` sector classification treated rays at $\pm 18^\circ$ and $\pm 28^\circ$ as forward obstacles, triggering false clearance warnings against lateral storage racks $1.0\text{ m}$ away.
  - `NavigationController.ts` clamped `targetAngularVel: 0` during predictive braking, locking steering and preventing the AMR from turning toward active waypoints.
  - Side clearance warnings halted the robot while passing alongside obstacles during bypasses.
  - Zero-speed state lacked in-place pivot capability ($\omega \ne 0, v = 0$) to align with replanned detour routes.
- **Regression Suite Execution (`turningBehavior.test.ts`)**: 9 passed in 308ms:
  - **Test A (Obstacle-Free Straight Line)**: Completes navigation at full 3.0 m/s cruise speed with 0 replans.
  - **Test B (Obstacle-Free 90° Left Turn)**: Rounds $90^\circ$ corner smoothly into cross-aisle without clipping racks or stalling.
  - **Test C (Obstacle-Free 90° Right Turn)**: Clean $90^\circ$ right turn execution into open corridor with smooth deceleration/acceleration profile.
  - **Test D (Multiple Consecutive 90° Turns)**: Navigates S-bend corridor through 3 consecutive $90^\circ$ turns with continuous motion.
  - **Test E (U-Shaped Route)**: Executes $180^\circ$ turnaround through connecting cross-aisle without wedging.
  - **Test F (One Box Ahead)**: Safely bypasses single box with $>0.20\text{ m}$ clearance without collision or stall.
  - **Test G (Avoidance Followed by Rejoining Path)**: Bypasses obstacle and smoothly re-aligns with global path, completing mission at destination.
  - **Test H (Extreme Difficulty / Multi-Obstacle Field)**: Slalom navigation through multiple staggered obstacles without colliding.
  - **Test I (Fully Blocked Corridor Safe Stop)**: Decelerates and halts safely before full-span barricade with $>0.20\text{ m}$ clearance, reporting blocked corridor.
- **Automated Test Summary (`npm test`)**: **75 passed across 9 test suites in 772ms**.
- **TypeScript Static Analysis (`npm run lint` &rarr; `tsc --noEmit`)**: **0 errors**.
- **Production Bundle Build (`npm run build`)**: Vite production bundle compiled in **3.43s** with 0 errors.
- **Backend Test Suite (`pytest backend/tests`)**: **9 passed in 0.22s**.

### UI Fix: AI Command Prompt Box Visibility Execution (2026-11-04)
- **UI Layout Test Suite (`uiLayoutVisibility.test.tsx`)**: 6 passed:
  - **Test 1**: AICommandCenterPanel renders with pinned input bar (`shrink-0 sticky bottom-0 z-10`), independent scrollable history (`flex-1 min-h-0 overflow-y-auto`), and anchored bounds (`top-20 bottom-6 right-6`).
  - **Test 2**: AICommandCenterPanel does not render in non-AI modes.
  - **Test 3**: AutonomousLabPanel renders with bounded height (`max-h-[calc(100vh-6.5rem)]`) and scrollable content body (`flex-1 min-h-0 overflow-y-auto`).
  - **Test 4**: DiagnosticsPanel renders with Core Telemetry header, Rapier 3D status, and collapsible body.
  - **Test 5**: RobotHUD renders AMR Telemetry.
  - **Test 6**: SimControls renders with responsive wrapping (`flex-wrap gap-1.5`) and max-width (`max-w-[calc(100vw-30rem)]`), ensuring bottom simulation controls never overlap the chat prompt box.
- **Automated Frontend Test Summary (`npm test`)**: **81 passed across 10 test suites in 890ms**.
- **TypeScript Static Analysis (`npm run lint` &rarr; `tsc --noEmit`)**: **0 errors**.
- **Production Bundle Build (`npm run build`)**: Vite production bundle compiled in **3.38s** with 0 errors.
- **Backend Test Suite (`pytest backend/tests`)**: **9 passed in 0.23s**.

---

## 5. Manual Browser Verification Protocol

| Test Procedure | Action in Browser | Expected UI / Simulation Behavior | Verification Status |
| :--- | :--- | :--- | :--- |
| **Test A: Normal Autonomous Run** | Click "Autonomous Lab", select "Bay 4 Delivery", click "START AUTONOMOUS MISSION". | Robot accelerates from charging station, navigates along aisles, rounds corners without wedging, and halts at Bay 4. | Automated Unit Test & Browser Ready |
| **Test B: Interactive Crate Placement** | Click "+ BOX", move cursor to open aisle, press "R" to rotate, left-click. | Translucent box preview follows mouse, validates green, spawns physical crate upon click; AMR detects via LiDAR, brakes or replans around it. | Automated Unit Test & Browser Ready |
| **Test C: Interactive Sphere Placement** | Click "+ SPHERE", hover over floor, left-click. | Sphere spawns at exact world coordinates; LiDAR detects spherical surface. | Automated Unit Test & Browser Ready |
| **Test D: Block Aisle** | Click "BLOCK AISLE", select Aisle 2. | Barricade with yellow/black hazard striping and twin flashing amber beacons appears; Rapier collider blocks aisle; AMR detects blockage and detours via Aisle 1 or 3. | Automated Unit Test & Browser Ready |
| **Test E: All Routes Blocked** | Block remaining open aisles. | Robot safely decelerates to 0 m/s, status changes to "PATH UNREACHABLE", HUD displays explanation: "All corridors to destination obstructed". | Automated Unit Test & Browser Ready |
| **Test F: Barrier Removal** | Click barricade in 3D or click "UNBLOCK" in Aisle menu. | Barricade disappears; Rapier collider and grid obstacle are cleared; AMR automatically replans through restored aisle. | Automated Unit Test & Browser Ready |
