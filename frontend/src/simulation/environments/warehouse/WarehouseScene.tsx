import React from 'react';
import { WarehouseFloor } from './WarehouseFloor';
import { WarehouseWalls } from './WarehouseWalls';
import { StorageRack } from './StorageRack';
import { PalletStack } from './PalletStack';
import { ChargingStation } from './ChargingStation';
import { DeliveryZone } from './DeliveryZone';
import { SpatialRiskOverlay3D } from './SpatialRiskOverlay3D';
import { WAREHOUSE_CONFIG } from '../warehouseConfig';

export const WarehouseScene: React.FC = () => {
  const { width, length, wallHeight, chargingStation, deliveryDestination } = WAREHOUSE_CONFIG;

  return (
    <group>
      {/* 1. Floor & Perimeter Infrastructure */}
      <WarehouseFloor width={width} length={length} />
      <WarehouseWalls width={width} length={length} height={wallHeight} />

      {/* 1b. Spatial Risk Heatmap 3D Floor Projection (Phase 5.3D) */}
      <SpatialRiskOverlay3D />

      {/* 2. Primary Charging Dock Station (Spawn Location) */}
      <ChargingStation
        position={chargingStation.position}
        rotation={[0, chargingStation.dockHeading, 0]}
      />

      {/* 3. Delivery Destination Zone (Bay 4) */}
      <DeliveryZone
        position={deliveryDestination.position}
        radius={deliveryDestination.radius}
      />

      {/* 4. Industrial Storage Racks (4 Parallel Double-Bay Rows with Clear 2.8m - 3.2m Aisles) */}
      {/* Row D (West Racks, X = -9.75) */}
      <StorageRack
        position={[-9.75, 0, -4.5]}
        length={6.5}
        depth={1.4}
        height={4.2}
        shelves={3}
        seed={101}
      />
      <StorageRack
        position={[-9.75, 0, 4.5]}
        length={6.5}
        depth={1.4}
        height={4.2}
        shelves={3}
        seed={102}
      />

      {/* Row A (X = -3.25) */}
      <StorageRack
        position={[-3.25, 0, -4.5]}
        length={6.5}
        depth={1.4}
        height={4.2}
        shelves={3}
        seed={201}
      />
      <StorageRack
        position={[-3.25, 0, 4.5]}
        length={6.5}
        depth={1.4}
        height={4.2}
        shelves={3}
        seed={202}
      />

      {/* Row B (X = 3.25) */}
      <StorageRack
        position={[3.25, 0, -4.5]}
        length={6.5}
        depth={1.4}
        height={4.2}
        shelves={3}
        seed={301}
      />
      <StorageRack
        position={[3.25, 0, 4.5]}
        length={6.5}
        depth={1.4}
        height={4.2}
        shelves={3}
        seed={302}
      />

      {/* Row C (East Racks, X = 9.75) */}
      <StorageRack
        position={[9.75, 0, -4.5]}
        length={6.5}
        depth={1.4}
        height={4.2}
        shelves={3}
        seed={401}
      />
      <StorageRack
        position={[9.75, 0, 4.5]}
        length={6.5}
        depth={1.4}
        height={4.2}
        shelves={3}
        seed={402}
      />

      {/* 5. Inbound Freight Staging Pallet Stacks (Safely stored against West wall in freight staging area) */}
      <PalletStack position={[-17.2, 0, 2.0]} tierCount={2} boxColor="#b45309" />
      <PalletStack position={[-17.2, 0, 4.0]} tierCount={3} boxColor="#d97706" />
      <PalletStack position={[-17.2, 0, 6.0]} tierCount={2} boxColor="#78350f" />
      <PalletStack position={[-15.8, 0, 5.0]} tierCount={1} boxColor="#0369a1" />

      {/* Outbound staging pallets tucked along East wall (out of the East transit artery) */}
      <PalletStack position={[17.2, 0, -5.0]} tierCount={2} boxColor="#eab308" />
      <PalletStack position={[17.2, 0, -3.0]} tierCount={2} boxColor="#334155" />

      {/* North perimeter pallets tucked safely against north wall between aisles */}
      <PalletStack position={[-3.25, 0, -13.5]} tierCount={2} boxColor="#b45309" />
      <PalletStack position={[3.25, 0, -13.5]} tierCount={2} boxColor="#d97706" />

      {/* 6. High-Bay Overhead Warehouse Lighting */}
      <group position={[0, wallHeight - 0.4, 0]}>
        {/* Lights over Aisle 1 (X = -6.5) */}
        <pointLight position={[-6.5, 0, -6]} intensity={0.8} distance={14} color="#f8fafc" />
        <pointLight position={[-6.5, 0, 0]} intensity={0.8} distance={14} color="#f8fafc" />
        <pointLight position={[-6.5, 0, 6]} intensity={0.8} distance={14} color="#f8fafc" />

        {/* Lights over Center Aisle 2 (X = 0) */}
        <pointLight position={[0, 0, -6]} intensity={0.9} distance={14} color="#f8fafc" />
        <pointLight position={[0, 0, 0]} intensity={0.9} distance={14} color="#f8fafc" />
        <pointLight position={[0, 0, 6]} intensity={0.9} distance={14} color="#f8fafc" />

        {/* Lights over Aisle 3 (X = 6.5) */}
        <pointLight position={[6.5, 0, -6]} intensity={0.8} distance={14} color="#f8fafc" />
        <pointLight position={[6.5, 0, 0]} intensity={0.8} distance={14} color="#f8fafc" />
        <pointLight position={[6.5, 0, 6]} intensity={0.8} distance={14} color="#f8fafc" />

        {/* Lights over Arterial Aisles */}
        <pointLight position={[-14.5, 0, -6]} intensity={0.8} distance={14} color="#e0f2fe" />
        <pointLight position={[-14.5, 0, 4]} intensity={0.8} distance={14} color="#e0f2fe" />
        <pointLight position={[14.0, 0, -6]} intensity={0.8} distance={14} color="#e0f2fe" />
        <pointLight position={[14.0, 0, 4]} intensity={0.8} distance={14} color="#e0f2fe" />
      </group>
    </group>
  );
};
