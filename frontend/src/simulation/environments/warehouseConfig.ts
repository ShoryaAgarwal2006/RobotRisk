export interface AisleDef {
  id: string;
  name: string;
  start: [number, number];
  end: [number, number];
  width: number;
}

export interface ZoneDef {
  id: string;
  name: string;
  type: 'charging' | 'loading' | 'delivery' | 'storage' | 'inspection';
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  center: [number, number, number];
  color: string;
}

export interface WarehouseLayout {
  width: number; // X axis total span
  length: number; // Z axis total span
  wallHeight: number;
  robotSpawn: {
    position: [number, number, number];
    rotation: number; // yaw in radians
  };
  deliveryDestination: {
    position: [number, number, number];
    radius: number;
    name: string;
  };
  chargingStation: {
    position: [number, number, number];
    dockHeading: number;
  };
  aisles: AisleDef[];
  zones: ZoneDef[];
}

export const WAREHOUSE_CONFIG: WarehouseLayout = {
  width: 40,  // -20 to +20 on X
  length: 32, // -16 to +16 on Z
  wallHeight: 5.5,

  robotSpawn: {
    position: [-14.5, 0.22, -10.5],
    rotation: 0, // Facing +Z down main artery
  },

  chargingStation: {
    position: [-15.5, 0.0, -11.5],
    dockHeading: 0,
  },

  deliveryDestination: {
    position: [14.0, 0.0, 10.5],
    radius: 2.2,
    name: 'BAY 4 DELIVERY DROP-OFF',
  },

  aisles: [
    {
      id: 'aisle-main-west',
      name: 'West Transit Arterial',
      start: [-14.5, -12],
      end: [-14.5, 12],
      width: 3.2,
    },
    {
      id: 'aisle-main-east',
      name: 'East Transit Arterial',
      start: [14.0, -12],
      end: [14.0, 12],
      width: 3.2,
    },
    {
      id: 'aisle-north-cross',
      name: 'North Cross Aisle',
      start: [-14.5, -10.5],
      end: [14.0, -10.5],
      width: 3.0,
    },
    {
      id: 'aisle-south-cross',
      name: 'South Cross Aisle',
      start: [-14.5, 10.5],
      end: [14.0, 10.5],
      width: 3.0,
    },
    {
      id: 'aisle-1',
      name: 'Aisle 1 (Rack Bay A-B)',
      start: [-6.5, -9],
      end: [-6.5, 9],
      width: 2.8,
    },
    {
      id: 'aisle-2',
      name: 'Aisle 2 (Rack Bay B-C)',
      start: [0.0, -9],
      end: [0.0, 9],
      width: 2.8,
    },
    {
      id: 'aisle-3',
      name: 'Aisle 3 (Rack Bay C-D)',
      start: [6.5, -9],
      end: [6.5, 9],
      width: 2.8,
    },
  ],

  zones: [
    {
      id: 'zone-charging',
      name: 'Automated Charging Dock 01',
      type: 'charging',
      bounds: { minX: -18, maxX: -13, minZ: -14, maxZ: -9 },
      center: [-15.5, 0, -11.5],
      color: '#00f0ff',
    },
    {
      id: 'zone-loading',
      name: 'Inbound Freight Staging',
      type: 'loading',
      bounds: { minX: -18, maxX: -10, minZ: 0, maxZ: 8 },
      center: [-14.0, 0, 4.0],
      color: '#ffaa00',
    },
    {
      id: 'zone-delivery',
      name: 'Outbound Bay 4 Express',
      type: 'delivery',
      bounds: { minX: 11, maxX: 17, minZ: 8, maxZ: 14 },
      center: [14.0, 0, 10.5],
      color: '#00ff88',
    },
    {
      id: 'zone-storage-central',
      name: 'High-Density Rack Storage',
      type: 'storage',
      bounds: { minX: -10, maxX: 10, minZ: -9, maxZ: 9 },
      center: [0, 0, 0],
      color: '#3b82f6',
    },
  ],
};
