"""
Authoritative Warehouse Geometry Contract
ROBOTRISK AI — PHASE 5.5C

This module defines the single authoritative contract for warehouse physical bounds,
static obstacle AABBs (racks, walls, staging pallets, charging dock), aisles,
and delivery destinations.
It mirrors frontend/src/simulation/environments/warehouseConfig.ts and GridMap.ts
with sub-centimetre precision.
"""

from dataclasses import dataclass, field
from typing import List, Tuple, Dict, Any, Optional

@dataclass(frozen=True)
class Bounds2D:
    min_x: float
    max_x: float
    min_z: float
    max_z: float

@dataclass(frozen=True)
class StaticObstacleAABB:
    id: str
    name: str
    min_x: float
    max_x: float
    min_z: float
    max_z: float
    category: str = "rack"  # "wall" | "rack" | "dock" | "pallet_stack"

@dataclass(frozen=True)
class AisleDefinition:
    id: str
    name: str
    start: Tuple[float, float]
    end: Tuple[float, float]
    width: float

@dataclass(frozen=True)
class DestinationDefinition:
    id: str
    name: str
    position: Tuple[float, float, float]
    radius: float

# 1. Total Warehouse Floor & Navigable Outer Boundaries
WAREHOUSE_TOTAL_BOUNDS = Bounds2D(min_x=-20.0, max_x=20.0, min_z=-16.0, max_z=16.0)
# Navigable inner boundary accounting for perimeter wall structural depth
WAREHOUSE_NAVIGABLE_BOUNDS = Bounds2D(min_x=-19.0, max_x=19.0, min_z=-15.0, max_z=15.0)

# Default Robot Starting Pose
DEFAULT_ROBOT_SPAWN: Tuple[float, float, float] = (-14.5, 0.22, -10.5)
DEFAULT_ROBOT_ROTATION: float = 0.0

# 2. Static Physical Obstacles (Matches GridMap.ts and warehouse visual models)
STATIC_OBSTACLES: List[StaticObstacleAABB] = [
    # Perimeter Walls
    StaticObstacleAABB("wall-north", "North Perimeter Wall", -20.0, 20.0, -16.5, -15.2, "wall"),
    StaticObstacleAABB("wall-south", "South Perimeter Wall", -20.0, 20.0, 15.2, 16.5, "wall"),
    StaticObstacleAABB("wall-west", "West Perimeter Wall", -20.5, -19.2, -16.0, 16.0, "wall"),
    StaticObstacleAABB("wall-east", "East Perimeter Wall", 19.2, 20.5, -16.0, 16.0, "wall"),

    # Storage Racks (4 Double-Bay Rows: Row D, Row A, Row B, Row C)
    # Row D: X = -9.75 +/- 0.70 -> [-10.45, -9.05]
    StaticObstacleAABB("rack-d-north", "Row D North Storage Rack", -10.45, -9.05, -7.75, -1.25, "rack"),
    StaticObstacleAABB("rack-d-south", "Row D South Storage Rack", -10.45, -9.05, 1.25, 7.75, "rack"),

    # Row A: X = -3.25 +/- 0.70 -> [-3.95, -2.55]
    StaticObstacleAABB("rack-a-north", "Row A North Storage Rack", -3.95, -2.55, -7.75, -1.25, "rack"),
    StaticObstacleAABB("rack-a-south", "Row A South Storage Rack", -3.95, -2.55, 1.25, 7.75, "rack"),

    # Row B: X = 3.25 +/- 0.70 -> [2.55, 3.95]
    StaticObstacleAABB("rack-b-north", "Row B North Storage Rack", 2.55, 3.95, -7.75, -1.25, "rack"),
    StaticObstacleAABB("rack-b-south", "Row B South Storage Rack", 2.55, 3.95, 1.25, 7.75, "rack"),

    # Row C: X = 9.75 +/- 0.70 -> [9.05, 10.45]
    StaticObstacleAABB("rack-c-north", "Row C North Storage Rack", 9.05, 10.45, -7.75, -1.25, "rack"),
    StaticObstacleAABB("rack-c-south", "Row C South Storage Rack", 9.05, 10.45, 1.25, 7.75, "rack"),

    # Charging Dock Backstop
    StaticObstacleAABB("dock-backstop", "Charging Dock Backstop", -16.2, -14.8, -12.4, -11.6, "dock"),

    # Staging Pallet Stacks
    StaticObstacleAABB("pallet-west", "West Staging Pallets", -18.0, -16.4, 1.2, 6.8, "pallet_stack"),
    StaticObstacleAABB("pallet-east", "East Staging Pallets", 16.4, 18.0, -5.8, -2.2, "pallet_stack"),
    StaticObstacleAABB("pallet-north-a", "North Pallet Bay A", -3.9, -2.6, -14.2, -12.8, "pallet_stack"),
    StaticObstacleAABB("pallet-north-b", "North Pallet Bay B", 2.6, 3.9, -14.2, -12.8, "pallet_stack"),
]

# 3. Warehouse Aisles (Matches WAREHOUSE_CONFIG.aisles)
AISLES: Dict[str, AisleDefinition] = {
    "aisle-main-west": AisleDefinition("aisle-main-west", "West Transit Arterial", (-14.5, -12.0), (-14.5, 12.0), 3.2),
    "aisle-main-east": AisleDefinition("aisle-main-east", "East Transit Arterial", (14.0, -12.0), (14.0, 12.0), 3.2),
    "aisle-north-cross": AisleDefinition("aisle-north-cross", "North Cross Aisle", (-14.5, -10.5), (14.0, -10.5), 3.0),
    "aisle-south-cross": AisleDefinition("aisle-south-cross", "South Cross Aisle", (-14.5, 10.5), (14.0, 10.5), 3.0),
    "aisle-1": AisleDefinition("aisle-1", "Aisle 1 (Rack Bay A-B)", (-6.5, -9.0), (-6.5, 9.0), 2.8),
    "aisle-2": AisleDefinition("aisle-2", "Aisle 2 (Rack Bay B-C)", (0.0, -9.0), (0.0, 9.0), 2.8),
    "aisle-3": AisleDefinition("aisle-3", "Aisle 3 (Rack Bay C-D)", (6.5, -9.0), (6.5, 9.0), 2.8),
}

# 4. Standard Warehouse Destinations
DESTINATIONS: Dict[str, DestinationDefinition] = {
    "bay-4": DestinationDefinition("bay-4", "BAY 4 DELIVERY DROP-OFF", (14.0, 0.0, 10.5), 2.2),
    "dock": DestinationDefinition("dock", "Automated Charging Dock 01", (-14.5, 0.22, -10.5), 1.5),
    "aisle-1-north": DestinationDefinition("aisle-1-north", "Aisle 1 North Head", (-6.5, 0.0, -9.0), 1.5),
    "aisle-2-center": DestinationDefinition("aisle-2-center", "Aisle 2 Center Crossing", (0.0, 0.0, 0.0), 1.5),
}
