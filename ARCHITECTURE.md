# ARCHITECTURE SPECIFICATION: ROBOTRISK AI

## 1. System Overview

ROBOTRISK AI is built on a unified simulation architecture where **Game Mode**, **Autonomous Lab**, and the **AI Command Center** run simultaneously on a single Three.js Canvas and Rapier 3D physics pipeline. There are no duplicate scenes, bifurcated worlds, or fake overlays.

```
                                    +-----------------------------------------+
                                    |         User Interface (React)          |
                                    +----+-----------------+------------------+
                                         |                 |                  
                   +---------------------+                 +------------------+
                   |                                                          |
        [Mode: Game / Manual]               [Mode: Autonomous Lab]      [Mode: AI Command]
        - Keyboard / WASD                   - A* Global Planner         - Natural Language Prompt
        - Direct Velocity/Torque            - Local Hazard Detection    - Scenario Triggering
        - Manual Override                   - Dynamic Path Replanner    - Failure Analysis
                   |                                  |                       |
                   +------------------+---------------+-----------------------+
                                      |
                                      v
                        +---------------------------+
                        |  Unified Zustand Store    |
                        |  - Simulation State       |
                        |  - Robot Pose & Status    |
                        |  - Navigation & Sensors   |
                        |  - Active Scenario Events |
                        |  - Telemetry Stream       |
                        +-------------+-------------+
                                      |
                        +-------------+-------------+
                        |                           |
                        v                           v
     +-----------------------------------+   +------------------------------------+
     |    R3F Scene & Rapier 3D Engine   |   |        FastAPI AI Safety Engine    |
     | - Procedural 3D Environment       |   | - Pydantic Scenario Validation     |
     | - Robot Kinematics / Colliders    |   | - Deterministic Safe Fallbacks     |
     | - Dynamic Hazards & Rigidbody     |   | - Failure Root Cause Analyzer      |
     | - Real-time Raycasting / LiDAR    |   | - Human-Approved Parameter Tuner   |
     +-----------------------------------+   +------------------------------------+
```

---

## 2. Core Architectural Principles

1. **Single Source of Truth**:
   The entire simulation state (robot position, velocity, active obstacles, health, mission progress, sensory ray hits, and mode) lives in a central Zustand store (`useSimulationStore`).
2. **Determinism Wherever Possible**:
   Hazards, trajectory paths, and obstacle movements are driven by seeded pseudo-randomness or strictly timed event sequences, ensuring benchmark reruns are directly comparable.
3. **Safety Through Sandboxing**:
   The AI Command Center never executes arbitrary code in the browser or on the server. AI output is parsed into strictly validated Pydantic (backend) and TypeScript (frontend) schemas.
4. **Human-in-the-Loop Optimization**:
   AI recommendations to tune robot configuration (e.g., maximum speed, braking distance, lookahead margin) require explicit user approval before mutating the robot's active configuration profile.
5. **Zero Fake Telemetry**:
   All metrics (collisions, near misses, path deviation, time-to-goal) are computed directly from Rapier contact events and continuous distance-to-obstacle queries.

---

## 3. Implemented Subsystems

### 3.1 Autonomous Navigation & Two-Layer Pathfinding Architecture (`src/navigation/`)

The autonomous navigation system follows a hierarchical **two-layer robotics architecture**:

```
+---------------------------------------------------------------------------------+
|                       Layer A: Global Path Planner (A*)                         |
|  - Long-range corridor topological route planning across 8000-cell grid         |
|  - String-pulling line-of-sight smoothing with corridor clearances              |
|  - Nearest-walkable start relaxation (prevents false failures near obstacles)   |
|  - Re-invoked only on macro corridor blockages or aisle-wide barricades         |
+----------------------------------------+----------------------------------------+
                                         | Target Waypoints
                                         v
+---------------------------------------------------------------------------------+
|                    Layer B: Dynamic Local Trajectory Planner                    |
|  - Dynamic Window Approach (DWA) forward arc simulation (3.6m spatial horizon)  |
|  - Evaluates candidate (v, omega) velocity pairs over 24 discrete steps         |
|  - Footprint collision checks against static racks, boxes, spheres, workers     |
|  - Composite multi-objective cost function:                                     |
|    Score = 3.0*Progress + 2.0*Heading + 3.5*Clearance + 1.5*Velocity - 1.2*Path |
|  - Generates smooth lateral bypass arcs without stopping                        |
|  - Real-time neon emerald trajectory ribbon visualization                       |
+----------------------------------------+----------------------------------------+
                                         | Steer & Velocity Commands
                                         v
+---------------------------------------------------------------------------------+
|                         Differential-Drive Robot AMR                            |
|  - Rapier continuous dynamic rigid body velocity integration                    |
|  - Predictive stopping distance safety governor: d = v² / (2a)                  |
|  - Controlled predictive deceleration and emergency brake fallback              |
+---------------------------------------------------------------------------------+
```

- **Spatial Occupancy Grid (`GridMap.ts`)**:
  - $40\text{ m} \times 32\text{ m}$ bounded grid at $0.4\text{ m}$ resolution ($100 \times 80 = 8000$ cells).
  - Ingests static colliders from `WAREHOUSE_CONFIG` (walls, 4 double-bay storage rack rows, columns, charging dock, staging areas).
  - Enforces robot clearance buffer ($r_{robot} = 0.34\text{ m} + r_{safety} = 0.20\text{ m} \implies 0.54\text{ m}$ obstacle inflation).
  - Dynamically registers moving interactive obstacles and patrolling workers in real time.
  - Implements fast Bresenham/raycast line-of-sight checking (`hasLineOfSight`).

- **Optimal Global Path Planner (`AStarFinder.ts`)**:
  - 8-directional A* graph search with diagonal corner-cutting prevention.
  - Octile distance heuristic for sub-millisecond route generation.
  - Line-of-sight string-pulling smoothing: eliminates jagged discrete grid steps to produce natural, smooth piecewise-linear navigation paths.
  - Concentric nearest-walkable relaxation on start position: if the AMR stops close to a dynamic obstacle, finds the nearest walkable grid cell rather than falsely failing.

- **Dynamic Local Trajectory Planner (`LocalTrajectoryPlanner.ts`)**:
  - High-rate dynamic window trajectory generator forward-simulating $3.6\text{ m}$ lookahead arcs ($24$ steps).
  - Generates lateral bypass curves with maximum turn angle limits ($1.05\text{ rad} \approx 60^\circ$) to avoid circular spinning.
  - Multi-objective scoring balancing goal progress, heading alignment, obstacle clearance, velocity, and global path adherence.
  - Identifies full-corridor blockages and declares non-feasibility, handing off to Layer A for alternative aisle rerouting.

- **Navigation Controller (`NavigationController.ts`)**:
  - Coordinates Layer A global waypoints and Layer B local trajectory execution.
  - Waypoint progression with intermediate corner threshold ($1.10\text{ m}$), segment progress projection ($s \ge 0.95$), and corner lookahead steering blending within $1.4\text{ m}$.
  - Differential drive in-place rotation ($\omega = \Delta\theta \cdot K_p, v = 0$) when stopped before an obstacle, allowing the AMR to pivot toward replanned detour paths without creeping forward.
  - Active bypass corridor tracking with directional hysteresis (+1.8 persistence bonus, -2.5 reversal penalty) to prevent directional oscillation.
  - Predictive stopping distance calculation: $d_{\text{stop}}(v) = \frac{v^2}{2a}$.
  - Seamless state machine transitions: `CRUISING`, `CONTROLLED_BRAKING`, `AVOIDING`, `REPLANNING`, `EMERGENCY_BRAKING`, `COMPLETED`, `FAILED`.

- **LiDAR Sensor Perception (`sensorUtils.ts` & `SensorVisualizer.tsx`)**:
  - 15 simulated raycasts spanning $170^\circ$ up to $6.0\text{ m}$, plus forward envelope projection check ensuring zero blindspots.
  - Swept corridor spatial filtering: converts all ray and object hits into robot-local coordinates ($x_{\text{local}} = d\sin\theta, z_{\text{local}} = d\cos\theta$). Only hits with $|x_{\text{local}}| \le r_{\text{robot}} + 0.12\text{ m}$ ($0.46\text{ m}$) are classified as forward obstructions; lateral shelf hits update side clearance (`leftDist` / `rightDist`), eliminating false forward alarms down warehouse aisles.
  - Real-time ray-marching against static obstacles, dynamic objects, and moving workers.
  - Three-tier threat classification:
    - `CLEAR`: forward distance $> 2.8\text{ m}$ (nominal cruise speed).
    - `CAUTION`: forward distance $1.0\text{ m} - 2.8\text{ m}$ (triggers Layer B local avoidance or controlled braking).
    - `CRITICAL`: forward distance $< 1.0\text{ m}$ (emergency braking if no lateral bypass exists).
  - 3D visual projection with colored laser lines (cyan &rarr; amber &rarr; red) and contact spheres.

- **Path & Trajectory Visualization (`PathVisualizer.tsx`)**:
  - 3D cyan navigation ribbon with discrete waypoint rings on the floor slab.
  - 3D neon emerald avoidance arc ribbon (`#10b981`) illustrating the real-time evaluated local bypass trajectory.
  - Pulsing amber vertical beacon cylinder highlighting the active target waypoint.
  - Purple breadcrumb trajectory trail displaying the robot's actual driven path history.

### 3.2 Warehouse Environment & Spatial Layout (`src/simulation/environments/`)

- $40\text{ m} \times 32\text{ m} \times 5.5\text{ m}$ high-bay industrial facility.
- 5 longitudinal aisles (West arterial, Aisles 1, 2, 3, East arterial) and 3 cross-aisles (North, Mid, South) ensuring full loop traversability.
- Blue/orange storage rack banks with solid ground decking matching physical colliders.
- Relocated perimeter pallet stacks and automated charging dock.
- Bay 4 delivery zone with pulsing green holographic beacon cylinder and floor target rings.

### 3.3 Robot Model & Kinematics (`src/simulation/robot/`)

- Cylindrical AMR hull collider ($radius = 0.34\text{ m}$, $friction = 0.05$) preventing square-corner catching against vertical uprights.
- True continuous velocity integration preventing tunneling or mesh clipping.
- Spacebar Emergency Braking ($18.0\text{ m/s}^2$) operational across both Manual and Autonomous modes.

### 3.4 Camera System (`src/simulation/CameraRig.tsx`)

- Damped OrbitControls enabled across all modes (`follow`, `orbit`, `top_down`).
- Relative delta tracking in `follow` mode preserving user orbital orientation during motion.
- Clamped vertical rotation ($0.05\text{ rad} \le \theta \le \pi/2 - 0.05\text{ rad}$).
- Dedicated `RESET CAM` button and camera mode indicator.

### 3.5 Responsive UI Layout Architecture & Z-Index Hierarchy

The user interface uses a three-tier spatial layout to prevent panel collisions, occlusions, and viewport overflow across different screen resolutions ($1536 \times 1024$, $1366 \times 768$, $1280 \times 720$, and smaller displays):

1. **Left Observer & Telemetry Deck**:
   - Anchored at `absolute top-20 left-6 z-20 w-72 sm:w-80`.
   - Groups `RobotHUD` (AMR kinematics, battery, coordinates, heading) and `DiagnosticsPanel` (Core Rapier 3D telemetry, rigid body counts, backend connectivity, live event stream).
   - Constrained with `max-h-[calc(100vh-14rem)] overflow-y-auto` so it never collides with bottom simulation controls.

2. **Bottom Simulation Controls**:
   - Anchored at `absolute bottom-6 left-6 z-20`.
   - Constrained with `max-w-[calc(100vw-30rem)]` and `flex flex-wrap gap-1.5` so controls wrap gracefully on narrower screens without encroaching on the right mission panel.

3. **Right Mission & AI Command Deck**:
   - Anchored at `absolute top-20 bottom-6 right-6 z-20 w-[420px] max-w-[calc(100vw-2rem)]`.
   - Dedicated exclusively to the active mode panel: `AutonomousLabPanel` in Autonomous Lab mode, `AICommandCenterPanel` in AI Command mode.
   - Pinned composer input bar with `shrink-0 sticky bottom-0 z-10`, ensuring the text field and Send button are 100% visible and clickable at all times.
   - Independent scroll container on chat message history (`flex-1 min-h-0 overflow-y-auto`).

4. **Z-Index Hierarchy**:
   - `z-0`: 3D Rapier Physics Canvas & Three.js Viewport.
   - `z-20`: Left Observer Deck, Bottom Simulation Controls, Right Mission Deck.
   - `z-30`: Global Header and Top-Center Mode Switcher Bar.
   - `z-40`: Interactive placement dropdowns, aisle barrier menus, and modal dialogs.
