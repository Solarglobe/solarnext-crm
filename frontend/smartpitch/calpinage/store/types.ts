export type Point = {
  x: number;
  y: number;
};

export type Polygon = Point[];

export interface CalpinageMeta {
  version: "v1";
  createdAt: string;
  updatedAt: string;
  leadId?: string | null;
  projectId?: string | null;
}

export interface Roof {
  image: string;
  scale?: number;
  north?: number;
  referencePoints?: Point[];
}

export interface Plane {
  id: string;
  polygon: Polygon;
  azimuthDeg: number;
  tiltDeg: number;
}

export interface Keepout {
  id: string;
  polygon: Polygon;
  type: string;
}

export interface PVModuleLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface PV {
  module: string;
  layout: PVModuleLayout[];
}

export interface ObstacleRoof {
  id: string;
  polygon: Polygon;
  heightRelM: number;
}

export interface ObstacleFar {
  id: string;
  point: Point;
  heightM: number;
  kind: string;
}

export interface CalpinageProject {
  meta: CalpinageMeta;
  roof: Roof;
  planes: Plane[];
  keepouts: Keepout[];
  pv: PV;
  obstaclesRoof: ObstacleRoof[];
  obstaclesFar: ObstacleFar[];
}
