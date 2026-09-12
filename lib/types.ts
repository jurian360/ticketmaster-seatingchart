export type SeatStatus = "available" | "sold" | "held";

/** A single seat as stored in the layout. Position is derived, never stored. */
export interface SeatDef {
  /** Printed seat number, e.g. 14 */
  n: number;
  status: SeatStatus;
  /** True when a physical aisle breaks the row directly after this seat. */
  aisleAfter?: boolean;
}

export interface RowDef {
  label: string;
  /** Horizontal shift in seat-units, used to stagger rows. */
  offset: number;
  seats: SeatDef[];
}

export interface Section {
  id: string;
  name: string;
  color: string;
  price: number;
  /** Venue-space position of the front-centre of the section. */
  x: number;
  y: number;
  /** Degrees. 0 means the section faces "up" towards the stage. */
  rotation: number;
  /** Degrees of arc swept by the front row. 0 renders a flat grid. */
  curve: number;
  seatSpacing: number;
  rowSpacing: number;
  rows: RowDef[];
}

export interface StageDef {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label: string;
}

export interface VenueRules {
  /** Smallest run of empty seats a selection is allowed to leave behind. */
  minLeftover: number;
  maxPerOrder: number;
  enforceOrphanRule: boolean;
}

export interface VenueLayout {
  id: string;
  name: string;
  eventName: string;
  eventDate: string;
  updatedAt: string;
  stage: StageDef;
  sections: Section[];
  rules: VenueRules;
}

/** A seat with its computed venue-space position, ready to render or validate. */
export interface PositionedSeat {
  id: string;
  sectionId: string;
  sectionName: string;
  rowLabel: string;
  rowIndex: number;
  /** Index within the row, 0-based. */
  index: number;
  n: number;
  status: SeatStatus;
  price: number;
  x: number;
  y: number;
  aisleAfter: boolean;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
