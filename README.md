# ROBOTRISK AI

> **Break it in simulation. Learn from failure. Make it safer in reality.**

ROBOTRISK AI is an interactive, browser-based, 3D intelligent robotics simulation, stress-testing, and safety validation platform. It empowers roboticists, safety engineers, and developers to push autonomous mobile robots (AMRs) to their physical and algorithmic limits in challenging simulated environments before physical deployment.

---

## 🚀 Key Features

### 1. Three Unified Simulation Modes
All modes operate seamlessly on the **same deterministic 3D physics engine and unified Zustand state**:
- 🎮 **Game / Manual Mode (Operational)**: Full manual teleoperation using WASD/Arrow keys, differential-drive kinematics, acceleration/deceleration damping, collision feedback, simulated battery drain, emergency braking, and a third-person chase camera with orbital drag.
- 🔬 **Autonomous Lab (Milestone 4 & Safety Repairs - Operational)**:
  - Global A* navigation pathfinding across 8000-cell warehouse occupancy grid ($0.4\text{ m}$ resolution).
  - Corridor-aware line-of-sight path smoothing with safety inflation margins.
  - Multi-destination mission planner (Bay 4 Delivery, Charging Station, Inbound Staging, Storage Aisles 1–3).
  - Pure-pursuit differential-drive waypoint steering with turn-speed regulation.
  - Simulated 9-beam forward and lateral LiDAR proximity sensor array ($5.5\text{ m}$ range) measuring actual physical surfaces.
  - Anti-loop replanning with configurable cooldown ($1.2\text{ s}$), progress stall detection, and intelligent obstruction rerouting.
  - Clear diagnosis and safe halting when all destination corridors are impassable.
  - Real-time 3D navigation route ribbon, pulsing target waypoint beacon, and actual trajectory history trail.
  - Genuine simulation metrics tracking (mission duration, physical displacement distance, obstacles seen, replan counts, collisions, stop times).
- 📦 **Interactive Obstacle Placement & Corridor Blocking**:
  - Precision ground-plane raycast placement for dynamic cargo boxes and safety spheres.
  - Real-time translucent 3D preview with obstacle validation (green = valid floor, red = obstructed).
  - Pre-placement yaw rotation via `R` key, left-click to confirm, right-click/`Escape` to cancel.
  - Interactive selection and deletion of placed obstacles with Rapier rigid body synchronization.
  - Dedicated **BLOCK AISLE** tool deploying full-width physical barricades with hazard striping, amber flashing strobe beacons, and instant A* alternative rerouting.
- 🤖 **AI Command Center (Operational - Phase 3 Orchestration & Phase 4 Controls)**:
  - Direct natural-language simulation clock and navigation controls (e.g. *"Start the simulation."*, *"Start autonomous navigation."*, *"Pause the simulation."*, *"Resume the simulation."*, *"Stop immediately."*, *"Pause the robot."*, *"Resume the robot."*).
  - Strict preservation of active route, destination, and AMR pose during simulation pauses and robot holding actions.
  - Distinct immediate execution of physical emergency stop ($18.0\text{ m/s}^2$ deceleration).
  - Conversational synonym invariance (e.g. *"Make it tough."*, *"Increase the difficulty."*, *"Put a box in front of the robot."*, *"Close aisle two."*).
  - Multi-intent compound sentence decomposition and sequential orchestration (e.g. *"Make it tough and take it through the shortest path."*, *"Create a crowded warehouse, block aisle two and start the robot."*).
  - Shortest safe route navigation optimization respecting $0.54\text{ m}$ obstacle safety clearance.
  - Procedural moving warehouse workers, dynamic obstacle injection, grounded telemetry root-cause failure analysis (RCA), and strict human-in-the-loop approval gates.
  - Contextual follow-up memory (*"Add two more"*, *"Remove that obstacle"*, *"Try another route"*, *"Explain what happened"*).
  - Active ambiguity detection and clarification questioning (*"Block the aisle"* $\to$ prompts which aisle).

### 2. Multi-Environment Support
- **Industrial Warehouse (Operational)**:
  - $40\text{ m} \times 32\text{ m}$ high-bay industrial warehouse with epoxy-coated concrete floor and safety lane striping.
  - Multi-tier blue & safety orange storage rack banks loaded with procedural cargo cartons and plastic tote containers.
  - Inbound freight staging bay with wooden Euro-pallets and cargo stacks.
  - Automated AMR Charging Dock Station at spawn location with dock guide bumpers and LED terminal.
  - Prominent delivery destination zone at Bay 4 with animated pulsing holographic beacon and floor target rings.
  - Full perimeter walls with roll-up bay doors, structural steel columns, and yellow impact bumpers.
  - 100% collision-enabled via merged static Rapier colliders for optimal 60 FPS performance.
- **University Campus** *(Milestone 8)*: Pedestrian walkways, intersections, dynamic cyclist/pedestrian paths.
- **Hospital Corridor** *(Milestone 8)*: Restricted emergency zones, moving stretchers, tight door clearances.
- **Custom Floor Plan Ingestion** *(Advanced)*: Upload top-down floor plans with interactive scale calibration and obstacle extrusion.

### 3. Dynamic Scenario & Stress Testing Engine
- **Hazards**: Dynamic pedestrians, falling payload boxes, blocked corridors, erratic peer robots, reduced sensor visibility (smoke/lighting failure), and hazardous spill zones.
- **Difficulty Profiles**: Normal, Hard, and Extreme (*Impossible Mission*).
- **Deterministic Replay**: Re-run identical scenario seeds to benchmark baseline vs. optimized robot parameters.

### 4. AI Intelligence & Safety Advisor
- Structured JSON schema validation for all scenario plans (no arbitrary code execution).
- Offline deterministic fallback generator if LLM service is disconnected.
- Root Cause Failure Analysis (RCA) explaining why a collision occurred.
- Dual-tier recommendations:
  - **Software Tuning** (e.g., lookahead distance, velocity governor, brake deceleration curve) with explicit human approval gates.
  - **Hardware Advisory** (e.g., sensor blindspot detection, recommended sensor suite additions).

### 5. Multi-Device Collaborative Simulation (Operational - Phase 5)
- **Authoritative Multi-Device Synchronization**:
  - Two users on separate devices or browser windows interact with the exact same live simulation in real time.
  - Sub-10ms WebSocket communication with automatic reconnection, heartbeat keep-alives, and authoritative server snapshots.
  - Zero-dependency pure TypeScript SVG QR code generation for instant mobile joining.
  - 1-click room code creation and direct link sharing (`?session=RR-XXXX&role=controller`).
- **Role A — Robot Operator (Authoritative Host)**:
  - Runs authoritative Rapier physics and kinematics.
  - Exclusive teleoperation driving authority (WASD / Arrows).
  - Controls autonomous mission starts, destination selection, simulation clock, and emergency braking ($18.0\text{ m/s}^2$).
  - Streams 20 Hz synchronized telemetry and LiDAR readings to all peers.
- **Role B — Scenario Controller (Stress Tester)**:
  - Real-time hazard injection: Spawns cargo boxes, safety spheres, moving workers, and physical aisle barricades.
  - Predefined Challenge Library: 1-click instant triggers for 9 incident scenarios (Sudden pedestrian crossing, falling box, barricades, errant trolleys, and Impossible Mission presets).
  - Dispatches natural-language commands to the operator via AI scenario generation.
  - Strictly prevented from overriding robot driving or emergency stop.

### 6. Telemetry & Analytics Suite
- Mission KPIs: Speed (m/s & km/h), real-time heading & compass bearing, coordinates (X, Y, Z), collision count, battery drainage rate, and near misses.
- Live decision logs & sensor state stream.
- Side-by-side performance benchmarking (Original vs. Tuned).

---

## 🕹️ Controls & Navigation

| Input | Action |
| :--- | :--- |
| **W / Up Arrow** | Accelerate Forward (Manual Mode) |
| **S / Down Arrow** | Reverse Drive (Manual Mode) |
| **A / Left Arrow** | Steer Left (counter-clockwise yaw) |
| **D / Right Arrow** | Steer Right (clockwise yaw) |
| **Space** | Toggle Emergency Braking (E-STOP) across all modes |
| **P** | Pause / Resume Simulation Clock |
| **R** | Reset Robot Pose to Charging Station Dock |
| **Left Click + Drag** | Orbit Camera around robot or warehouse |
| **Right Click + Drag** | Pan Camera |
| **Scroll Wheel** | Zoom In / Out |

---

## 🛠️ Tech Stack

- **Frontend & Rendering**: React 18 / Vite / TypeScript, Three.js, React Three Fiber (`@react-three/fiber`), `@react-three/drei`.
- **Physics**: Rapier 3D physics engine (`@react-three/rapier`).
- **State Architecture**: Zustand unified simulation store (`useSimulationStore`).
- **Data Visualization**: Recharts, Lucide React icons, Tailwind CSS.
- **Backend API**: Python 3 / FastAPI with Pydantic validation schemas.
- **Testing**: Vitest for frontend kinematics, spatial config, A* navigation, and store tests; Pytest for backend API/schema tests.

---

## 🚦 Getting Started

### Prerequisites
- Node.js (v18+)
- Python (v3.10+)

### 1. Backend Setup & Run
```bash
# Navigate to backend directory
cd backend

# Create & activate virtual environment (if not already created)
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run backend API server on port 8000
uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```
API Documentation: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)  
Health Check: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)

### 2. Frontend Setup & Run
```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Run Vite dev server
npm run dev
```
Open your browser at: [http://127.0.0.1:5173](http://127.0.0.1:5173)

### 3. Running Automated Tests
```bash
# Frontend Unit Tests (Kinematics, Warehouse Config, A* Navigation, Store & Predictive Braking Avoidance)
cd frontend
npm test

# Frontend Lint & Typecheck
npm run lint

# Frontend Production Build
npm run build

# Backend API Tests
cd backend
source venv/bin/activate
PYTHONPATH=.. pytest tests
```
