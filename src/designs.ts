// The "picture on the box": real models a build assembles, and how a book's
// bags map onto their parts. Shared by the server (validation) and the UI.
// Units: x and y in studs; z and h in plates (a brick is three plates).

export const MODEL_IDS = ["house", "rocket", "castle", "weather", "lighthouse", "robot", "shop", "bridge"] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export const MODEL_NAMES: Record<ModelId, string> = {
  house: "Cottage",
  rocket: "Rocket on its launch pad",
  castle: "Castle keep",
  weather: "Weather station",
  lighthouse: "Lighthouse",
  robot: "Robot",
  shop: "Corner shop",
  bridge: "Suspension bridge",
};

/** What each model suits, for the planning agent choosing one. */
export const MODEL_HINTS: Record<ModelId, string> = {
  house: "apps, pages, UI and product features",
  rocket: "deploys, releases, CI, infrastructure and performance",
  castle: "auth, permissions, security and hardening",
  weather: "dashboards, metrics, monitoring, sensors and weather",
  lighthouse: "search, alerts, logging, tracing and notifications",
  robot: "AI, ML, agents, bots and automation",
  shop: "payments, billing, checkout, carts and stores",
  bridge: "integrations, sync, migrations, webhooks and data pipelines",
};

export type SlopeDir = "+x" | "-x" | "+y" | "-y";

export interface DesignBrick {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: string;
  /** Box (default) or a roof slope falling towards `dir`. */
  slope?: SlopeDir;
  /** Tiles and slopes have no studs. */
  studs: boolean;
}

export interface DesignSection {
  name: string;
  bricks: DesignBrick[];
}

export interface Design {
  /** A built-in model, or "custom" for one compiled from the agent's blueprint. */
  id: ModelId | "custom";
  name: string;
  plate: { w: number; d: number; color: string };
  /** Bottom-up build order: earlier sections go to bags attached earlier. */
  sections: DesignSection[];
}

const C = {
  white: "#F4F4F4",
  lightGray: "#A0A5A9",
  darkGray: "#6C6E68",
  black: "#2B2D2F",
  red: "#C91A09",
  brickRed: "#9C2A1B",
  tan: "#E4CD9E",
  brown: "#7C503A",
  green: "#237841",
  brightGreen: "#58AB41",
  yellow: "#F2CD37",
  orange: "#FE8A18",
  glass: "#9BD3F0",
  blue: "#1E6FD0",
};

const B = 3; // plates per brick

function box(x: number, y: number, z: number, w: number, d: number, h: number, color: string, studs = true): DesignBrick {
  return { x, y, z, w, d, h, color, studs };
}
function tile(x: number, y: number, z: number, w: number, d: number, color: string): DesignBrick {
  return box(x, y, z, w, d, 1, color, false);
}
function slope(x: number, y: number, z: number, w: number, d: number, h: number, color: string, dir: SlopeDir): DesignBrick {
  return { x, y, z, w, d, h, color, slope: dir, studs: false };
}

const HOUSE: Design = {
  id: "house",
  name: MODEL_NAMES.house,
  plate: { w: 14, d: 12, color: "#3F9B3A" },
  sections: [
    {
      name: "Foundation",
      bricks: [
        box(2, 2, 0, 5, 8, 1, C.lightGray),
        box(7, 2, 0, 5, 8, 1, C.lightGray),
        tile(6, 9, 1, 2, 1, C.tan),
        tile(6, 10, 0, 2, 2, C.tan),
      ],
    },
    {
      name: "Garden",
      bricks: [
        box(3, 11, 0, 1, 1, 1, C.red),
        box(4, 11, 0, 1, 1, 1, C.yellow),
        box(10, 11, 0, 1, 1, 1, C.yellow),
        box(11, 11, 0, 1, 1, 1, C.red),
        box(12, 3, 0, 1, 1, 2 * B, C.brown),
        box(11, 2, 2 * B, 3, 3, B, C.brightGreen),
        box(12, 3, 3 * B, 1, 1, B, C.brightGreen),
      ],
    },
    {
      name: "Ground floor",
      bricks: [
        box(3, 8, 1, 3, 1, B, C.white),
        box(8, 8, 1, 3, 1, B, C.white),
        box(6, 8, 1, 2, 1, 2 * B, C.brown),
        box(3, 3, 1, 8, 1, B, C.white),
        box(3, 4, 1, 1, 4, B, C.white),
        box(10, 4, 1, 1, 4, B, C.white),
      ],
    },
    {
      name: "Windows",
      bricks: [
        box(3, 8, 4, 1, 1, B, C.white),
        box(4, 8, 4, 2, 1, B, C.glass),
        box(8, 8, 4, 1, 1, B, C.white),
        box(9, 8, 4, 1, 1, B, C.glass),
        box(10, 8, 4, 1, 1, B, C.white),
        box(3, 3, 4, 8, 1, B, C.white),
        box(3, 4, 4, 1, 4, B, C.white),
        box(10, 4, 4, 1, 1, B, C.white),
        box(10, 5, 4, 1, 2, B, C.glass),
        box(10, 7, 4, 1, 1, B, C.white),
      ],
    },
    {
      name: "Top course",
      bricks: [
        box(3, 8, 7, 8, 1, B, C.white),
        box(3, 3, 7, 8, 1, B, C.white),
        box(3, 4, 7, 1, 4, B, C.white),
        box(10, 4, 7, 1, 4, B, C.white),
      ],
    },
    {
      name: "Roof",
      bricks: [
        slope(2, 2, 10, 10, 2, B, C.red, "-y"),
        box(3, 4, 10, 8, 4, B, C.white),
        slope(2, 8, 10, 10, 2, B, C.red, "+y"),
        slope(2, 4, 13, 10, 1, B, C.red, "-y"),
        box(3, 5, 13, 5, 2, B, C.white),
        box(10, 5, 13, 1, 2, B, C.white),
        slope(2, 7, 13, 10, 1, B, C.red, "+y"),
        slope(2, 5, 16, 6, 1, B, C.red, "-y"),
        slope(10, 5, 16, 2, 1, B, C.red, "-y"),
        slope(2, 6, 16, 6, 1, B, C.red, "+y"),
        slope(10, 6, 16, 2, 1, B, C.red, "+y"),
      ],
    },
    {
      name: "Chimney",
      bricks: [
        box(8, 5, 13, 2, 2, B, C.brickRed),
        box(8, 5, 16, 2, 2, B, C.brickRed),
        box(8, 5, 19, 2, 2, B, C.brickRed),
        box(8, 5, 22, 2, 2, 1, C.darkGray),
      ],
    },
  ],
};

const ROCKET: Design = {
  id: "rocket",
  name: MODEL_NAMES.rocket,
  plate: { w: 12, d: 12, color: "#7D8487" },
  sections: [
    {
      name: "Launch pad",
      bricks: [
        box(2, 2, 0, 8, 4, 1, C.darkGray),
        box(2, 6, 0, 8, 4, 1, C.darkGray),
        tile(2, 10, 0, 2, 1, C.yellow),
        tile(4, 10, 0, 2, 1, C.black),
        tile(6, 10, 0, 2, 1, C.yellow),
        tile(8, 10, 0, 2, 1, C.black),
        tile(10, 2, 0, 1, 2, C.yellow),
        tile(10, 4, 0, 1, 2, C.black),
        tile(10, 6, 0, 1, 2, C.yellow),
        tile(10, 8, 0, 1, 2, C.black),
      ],
    },
    {
      name: "Engine and fins",
      bricks: [
        box(4, 4, 1, 4, 4, B, C.darkGray),
        slope(3, 5, 1, 1, 2, 2 * B, C.red, "-x"),
        slope(5, 3, 1, 2, 1, 2 * B, C.red, "-y"),
        slope(8, 5, 1, 1, 2, 2 * B, C.red, "+x"),
        slope(5, 8, 1, 2, 1, 2 * B, C.red, "+y"),
      ],
    },
    {
      name: "Lower body",
      bricks: [
        box(4, 4, 4, 2, 2, B, C.white),
        box(6, 4, 4, 2, 2, B, C.white),
        box(4, 6, 4, 2, 2, B, C.white),
        box(6, 6, 4, 2, 2, B, C.white),
        box(4, 4, 7, 2, 2, B, C.white),
        box(6, 4, 7, 2, 2, B, C.white),
        box(4, 6, 7, 2, 2, B, C.white),
        box(6, 6, 7, 2, 2, B, C.white),
      ],
    },
    {
      name: "Stripe and window",
      bricks: [
        box(4, 4, 10, 4, 4, 1, C.red),
        box(4, 4, 11, 2, 2, B, C.white),
        box(6, 4, 11, 2, 2, B, C.white),
        box(4, 6, 11, 2, 2, B, C.white),
        box(6, 6, 11, 2, 2, B, C.glass),
      ],
    },
    {
      name: "Upper body",
      bricks: [
        box(4, 4, 14, 2, 2, B, C.white),
        box(6, 4, 14, 2, 2, B, C.white),
        box(4, 6, 14, 2, 2, B, C.white),
        box(6, 6, 14, 2, 2, B, C.white),
        box(4, 4, 17, 2, 2, B, C.white),
        box(6, 4, 17, 2, 2, B, C.white),
        box(4, 6, 17, 2, 2, B, C.white),
        box(6, 6, 17, 2, 2, B, C.blue),
      ],
    },
    {
      name: "Nose cone",
      bricks: [
        slope(4, 4, 20, 3, 1, B, C.red, "-y"),
        slope(4, 5, 20, 1, 2, B, C.red, "-x"),
        box(5, 5, 20, 2, 2, B, C.red, false),
        slope(7, 4, 20, 1, 3, B, C.red, "+x"),
        slope(4, 7, 20, 4, 1, B, C.red, "+y"),
        slope(5, 5, 23, 2, 1, B, C.red, "-y"),
        slope(5, 6, 23, 2, 1, B, C.red, "+y"),
      ],
    },
    {
      name: "Gantry",
      bricks: [
        box(9, 3, 1, 1, 1, B, C.yellow),
        box(9, 3, 4, 1, 1, B, C.yellow),
        box(9, 3, 7, 1, 1, B, C.yellow),
        box(9, 3, 10, 1, 1, B, C.yellow),
        box(9, 3, 13, 1, 1, B, C.yellow),
        box(9, 3, 16, 1, 1, B, C.yellow),
        box(8, 4, 16, 1, 1, 1, C.lightGray),
        box(9, 3, 19, 1, 1, 1, C.red),
      ],
    },
  ],
};

const CASTLE: Design = {
  id: "castle",
  name: MODEL_NAMES.castle,
  plate: { w: 14, d: 14, color: "#3F9B3A" },
  sections: [
    {
      name: "Moat and grounds",
      bricks: [
        tile(2, 11, 0, 4, 1, C.blue),
        tile(8, 11, 0, 4, 1, C.blue),
        tile(11, 3, 0, 1, 8, C.blue),
        tile(6, 11, 0, 2, 2, C.brown),
        box(12, 12, 0, 2, 2, B, C.brightGreen),
        box(12, 1, 0, 2, 2, B, C.brightGreen),
      ],
    },
    {
      name: "Foundation",
      bricks: [box(3, 3, 0, 4, 8, 1, C.lightGray), box(7, 3, 0, 4, 8, 1, C.lightGray)],
    },
    {
      name: "Gate and walls",
      bricks: [
        box(4, 9, 1, 2, 1, B, C.lightGray),
        box(6, 9, 1, 2, 1, 2 * B, C.brown),
        box(8, 9, 1, 2, 1, B, C.lightGray),
        box(4, 4, 1, 6, 1, B, C.lightGray),
        box(4, 5, 1, 1, 4, B, C.lightGray),
        box(9, 5, 1, 1, 4, B, C.lightGray),
      ],
    },
    {
      name: "Arrow slits",
      bricks: [
        box(4, 9, 4, 2, 1, B, C.darkGray),
        box(8, 9, 4, 2, 1, B, C.darkGray),
        box(4, 4, 4, 6, 1, B, C.darkGray),
        box(4, 5, 4, 1, 4, B, C.darkGray),
        box(9, 5, 4, 1, 1, B, C.darkGray),
        box(9, 6, 4, 1, 1, B, C.black),
        box(9, 7, 4, 1, 2, B, C.darkGray),
      ],
    },
    {
      name: "Upper walls",
      bricks: [
        box(4, 9, 7, 2, 1, B, C.lightGray),
        box(6, 9, 7, 1, 1, B, C.black),
        box(7, 9, 7, 3, 1, B, C.lightGray),
        box(4, 4, 7, 6, 1, B, C.lightGray),
        box(4, 5, 7, 1, 4, B, C.lightGray),
        box(9, 5, 7, 1, 4, B, C.lightGray),
      ],
    },
    {
      name: "Battlements",
      bricks: [
        box(4, 9, 10, 1, 1, B, C.lightGray),
        box(6, 9, 10, 1, 1, B, C.lightGray),
        box(8, 9, 10, 2, 1, B, C.lightGray),
        box(9, 7, 10, 1, 1, B, C.lightGray),
        box(9, 5, 10, 1, 1, B, C.lightGray),
        box(9, 4, 10, 1, 1, B, C.lightGray),
        box(7, 4, 10, 1, 1, B, C.lightGray),
        box(5, 4, 10, 1, 1, B, C.lightGray),
        box(4, 4, 10, 1, 1, B, C.lightGray),
        box(4, 6, 10, 1, 1, B, C.lightGray),
      ],
    },
    {
      name: "Turret",
      bricks: [
        box(5, 5, 10, 4, 4, 1, C.darkGray),
        box(6, 6, 11, 2, 2, B, C.lightGray),
        box(6, 6, 14, 2, 2, B, C.lightGray),
        slope(6, 6, 17, 2, 1, B, C.red, "-y"),
        slope(6, 7, 17, 2, 1, B, C.red, "+y"),
      ],
    },
  ],
};


const WEATHER: Design = {
  id: "weather",
  name: MODEL_NAMES.weather,
  plate: { w: 14, d: 12, color: "#3F9B3A" },
  sections: [
    {
      name: "Concrete pad",
      bricks: [box(2, 2, 0, 6, 8, 1, C.lightGray), box(8, 2, 0, 4, 8, 1, C.lightGray), tile(4, 10, 0, 2, 2, C.tan)],
    },
    {
      name: "Instrument hut",
      bricks: [
        box(3, 7, 1, 1, 1, B, C.white),
        box(4, 7, 1, 2, 1, 2 * B, C.blue),
        box(6, 7, 1, 1, 1, B, C.white),
        box(3, 4, 1, 4, 1, B, C.white),
        box(3, 5, 1, 1, 2, B, C.white),
        box(6, 5, 1, 1, 2, B, C.white),
      ],
    },
    {
      name: "Hut window",
      bricks: [
        box(3, 7, 4, 1, 1, B, C.white),
        box(6, 7, 4, 1, 1, B, C.white),
        box(3, 4, 4, 4, 1, B, C.white),
        box(3, 5, 4, 1, 2, B, C.white),
        box(6, 5, 4, 1, 2, B, C.glass),
      ],
    },
    { name: "Hut roof", bricks: [box(2, 3, 7, 6, 6, 1, C.darkGray), tile(3, 4, 8, 4, 4, C.white)] },
    {
      name: "Weather mast",
      bricks: [1, 4, 7, 10, 13, 16].map((z) => box(9, 5, z, 1, 1, B, C.lightGray)),
    },
    {
      name: "Anemometer and vane",
      bricks: [
        box(9, 5, 19, 1, 1, 1, C.darkGray),
        box(8, 5, 20, 3, 1, 1, C.lightGray),
        box(8, 5, 21, 1, 1, 1, C.red),
        box(10, 5, 21, 1, 1, 1, C.red),
        box(9, 4, 21, 1, 3, 1, C.lightGray),
        box(9, 4, 22, 1, 1, 1, C.red),
        box(9, 6, 22, 1, 1, 1, C.red),
        box(9, 5, 22, 1, 1, B, C.darkGray),
        box(8, 5, 25, 3, 1, 1, C.yellow),
      ],
    },
    {
      name: "Radar dish",
      bricks: [
        box(10, 7, 1, 2, 2, B, C.lightGray),
        slope(10, 7, 4, 2, 1, B, C.white, "+y"),
        slope(10, 8, 4, 2, 1, B, C.white, "-y"),
      ],
    },
    {
      name: "Solar panel and rain gauge",
      bricks: [
        box(8, 9, 1, 1, 1, B, C.darkGray),
        slope(7, 8, 4, 2, 2, B, C.blue, "+y"),
        box(11, 3, 1, 1, 1, B, C.white),
        box(11, 3, 4, 1, 1, 1, C.blue),
      ],
    },
  ],
};

const LIGHTHOUSE: Design = {
  id: "lighthouse",
  name: MODEL_NAMES.lighthouse,
  plate: { w: 12, d: 12, color: "#2E78C7" },
  sections: [
    {
      name: "Island",
      bricks: [
        box(2, 2, 0, 4, 8, 1, C.darkGray),
        box(6, 2, 0, 4, 8, 1, C.darkGray),
        tile(3, 10, 0, 4, 1, C.tan),
        box(10, 4, 0, 1, 2, B, C.darkGray),
        box(1, 6, 0, 1, 2, B, C.darkGray),
      ],
    },
    {
      name: "Tower base",
      bricks: [box(4, 4, 1, 2, 2, B, C.white), box(6, 4, 1, 2, 2, B, C.white), box(4, 6, 1, 2, 2, B, C.brown), box(6, 6, 1, 2, 2, B, C.white)],
    },
    { name: "First stripe", bricks: [box(4, 4, 4, 2, 2, B, C.red), box(6, 4, 4, 2, 2, B, C.red), box(4, 6, 4, 2, 2, B, C.red), box(6, 6, 4, 2, 2, B, C.red)] },
    { name: "White course", bricks: [box(4, 4, 7, 2, 2, B, C.white), box(6, 4, 7, 2, 2, B, C.white), box(4, 6, 7, 2, 2, B, C.white), box(6, 6, 7, 2, 2, B, C.white)] },
    { name: "Second stripe", bricks: [box(4, 4, 10, 2, 2, B, C.red), box(6, 4, 10, 2, 2, B, C.red), box(4, 6, 10, 2, 2, B, C.red), box(6, 6, 10, 2, 2, B, C.red)] },
    { name: "Upper course", bricks: [box(4, 4, 13, 2, 2, B, C.white), box(6, 4, 13, 2, 2, B, C.white), box(4, 6, 13, 2, 2, B, C.white), box(6, 6, 13, 2, 2, B, C.white)] },
    { name: "Top stripe", bricks: [box(4, 4, 16, 2, 2, B, C.red), box(6, 4, 16, 2, 2, B, C.red), box(4, 6, 16, 2, 2, B, C.red), box(6, 6, 16, 2, 2, B, C.red)] },
    {
      name: "Lamp room",
      bricks: [
        box(4, 4, 19, 4, 4, 1, C.black),
        box(5, 5, 20, 2, 2, B, C.yellow),
        slope(5, 5, 23, 2, 1, B, C.red, "-y"),
        slope(5, 6, 23, 2, 1, B, C.red, "+y"),
      ],
    },
    {
      name: "Harbour",
      bricks: [box(9, 10, 0, 2, 1, 1, C.red), slope(9, 10, 1, 1, 1, B, C.white, "+x"), box(1, 1, 0, 1, 1, 1, C.red)],
    },
  ],
};

const ROBOT: Design = {
  id: "robot",
  name: MODEL_NAMES.robot,
  plate: { w: 12, d: 12, color: "#8A8F93" },
  sections: [
    {
      name: "Base and feet",
      bricks: [box(2, 3, 0, 8, 6, 1, C.darkGray), box(3, 5, 1, 2, 3, B, C.black), box(7, 5, 1, 2, 3, B, C.black)],
    },
    {
      name: "Legs",
      bricks: [
        box(3, 5, 4, 2, 2, B, C.lightGray),
        box(7, 5, 4, 2, 2, B, C.lightGray),
        box(3, 5, 7, 2, 2, B, C.lightGray),
        box(7, 5, 7, 2, 2, B, C.lightGray),
      ],
    },
    { name: "Hips and body", bricks: [box(3, 5, 10, 6, 2, 1, C.darkGray), box(3, 4, 11, 6, 3, B, C.blue)] },
    {
      name: "Chest panel",
      bricks: [box(3, 4, 14, 2, 3, B, C.blue), box(5, 4, 14, 2, 3, B, C.yellow), box(7, 4, 14, 2, 3, B, C.blue)],
    },
    {
      name: "Arms",
      bricks: [
        box(9, 5, 11, 1, 2, 2 * B, C.lightGray),
        box(9, 5, 8, 1, 2, B, C.darkGray),
        box(2, 5, 11, 1, 2, 2 * B, C.lightGray),
        box(2, 5, 8, 1, 2, B, C.darkGray),
      ],
    },
    {
      name: "Head",
      bricks: [
        box(5, 5, 17, 2, 1, 1, C.darkGray),
        box(4, 4, 18, 4, 3, B, C.lightGray),
        box(4, 4, 21, 4, 2, B, C.lightGray),
        box(4, 6, 21, 1, 1, B, C.lightGray),
        box(5, 6, 21, 1, 1, B, C.glass),
        box(6, 6, 21, 1, 1, B, C.glass),
        box(7, 6, 21, 1, 1, B, C.lightGray),
      ],
    },
    { name: "Antenna", bricks: [box(5, 5, 24, 1, 1, B, C.darkGray), box(5, 5, 27, 1, 1, 1, C.red)] },
  ],
};

const SHOP: Design = {
  id: "shop",
  name: MODEL_NAMES.shop,
  plate: { w: 14, d: 12, color: "#9BA19D" },
  sections: [
    { name: "Floor and sidewalk", bricks: [box(3, 3, 0, 8, 6, 1, C.darkGray), tile(2, 9, 0, 10, 3, C.lightGray)] },
    {
      name: "Shop front",
      bricks: [
        box(3, 8, 1, 1, 1, B, C.white),
        box(4, 8, 1, 2, 1, 2 * B, C.glass),
        box(6, 8, 1, 4, 1, B, C.glass),
        box(10, 8, 1, 1, 1, B, C.white),
        box(3, 3, 1, 8, 1, B, C.white),
        box(3, 4, 1, 1, 4, B, C.white),
        box(10, 4, 1, 1, 4, B, C.white),
      ],
    },
    {
      name: "Display window",
      bricks: [
        box(3, 8, 4, 1, 1, B, C.white),
        box(6, 8, 4, 4, 1, B, C.glass),
        box(10, 8, 4, 1, 1, B, C.white),
        box(3, 3, 4, 8, 1, B, C.white),
        box(3, 4, 4, 1, 4, B, C.white),
        box(10, 4, 4, 1, 4, B, C.white),
      ],
    },
    {
      name: "Sign band",
      bricks: [box(3, 8, 7, 8, 1, B, C.red), box(3, 3, 7, 8, 1, B, C.white), box(3, 4, 7, 1, 4, B, C.white), box(10, 4, 7, 1, 4, B, C.white)],
    },
    {
      name: "Awning",
      bricks: [
        slope(3, 9, 5, 2, 1, 2, C.red, "+y"),
        slope(5, 9, 5, 2, 1, 2, C.white, "+y"),
        slope(7, 9, 5, 2, 1, 2, C.red, "+y"),
        slope(9, 9, 5, 2, 1, 2, C.white, "+y"),
      ],
    },
    { name: "Roof and sign", bricks: [box(3, 3, 10, 8, 6, 1, C.lightGray), box(5, 8, 11, 4, 1, B, C.yellow)] },
    {
      name: "Street",
      bricks: [
        box(12, 10, 0, 1, 1, 2 * B, C.darkGray),
        box(12, 10, 6, 1, 1, 1, C.yellow),
        box(1, 10, 0, 1, 1, B, C.brown),
        box(1, 10, 3, 1, 1, B, C.brightGreen),
      ],
    },
  ],
};

const BRIDGE: Design = {
  id: "bridge",
  name: MODEL_NAMES.bridge,
  plate: { w: 16, d: 10, color: "#3F9B3A" },
  sections: [
    {
      name: "River and roads",
      bricks: [tile(6, 0, 0, 4, 10, C.blue), tile(0, 4, 0, 3, 2, C.darkGray), tile(13, 4, 0, 3, 2, C.darkGray)],
    },
    {
      name: "Ramps and abutments",
      bricks: [
        slope(3, 4, 0, 1, 2, 4, C.darkGray, "-x"),
        box(4, 3, 0, 2, 4, 4, C.lightGray),
        box(10, 3, 0, 2, 4, 4, C.lightGray),
        slope(12, 4, 0, 1, 2, 4, C.darkGray, "+x"),
      ],
    },
    { name: "Pier and deck", bricks: [box(7, 4, 1, 2, 2, 3, C.lightGray), box(4, 3, 4, 8, 4, 1, C.darkGray)] },
    {
      name: "Towers",
      bricks: [
        box(6, 3, 5, 1, 1, 9, C.red),
        box(6, 6, 5, 1, 1, 9, C.red),
        box(6, 3, 14, 1, 4, 1, C.red),
        box(9, 3, 5, 1, 1, 9, C.red),
        box(9, 6, 5, 1, 1, 9, C.red),
        box(9, 3, 14, 1, 4, 1, C.red),
      ],
    },
    {
      name: "Cables",
      bricks: [3, 6].flatMap((y) => [
        slope(4, y, 5, 2, 1, 9, C.lightGray, "-x"),
        slope(7, y, 5, 1, 1, 9, C.lightGray, "+x"),
        slope(8, y, 5, 1, 1, 9, C.lightGray, "-x"),
        slope(10, y, 5, 2, 1, 9, C.lightGray, "+x"),
      ]),
    },
    {
      name: "Traffic and trees",
      bricks: [
        box(7, 4, 5, 2, 1, 2, C.blue),
        box(7, 4, 7, 2, 1, 1, C.glass),
        box(1, 1, 0, 2, 2, B, C.brightGreen),
        box(13, 7, 0, 2, 2, B, C.brightGreen),
      ],
    },
  ],
};

export const DESIGNS: Record<ModelId, Design> = {
  house: HOUSE,
  rocket: ROCKET,
  castle: CASTLE,
  weather: WEATHER,
  lighthouse: LIGHTHOUSE,
  robot: ROBOT,
  shop: SHOP,
  bridge: BRIDGE,
};

/** Words that suggest a model, matched against a book's title and task. */
const MODEL_WORDS: Record<ModelId, string[]> = {
  weather: ["weather", "forecast", "climate", "temperature", "sensor", "metric", "metrics", "dashboard", "telemetry", "chart", "analytics"],
  lighthouse: ["search", "alert", "alerts", "observability", "monitoring", "log", "logs", "logging", "trace", "tracing", "notification", "notifications", "incident"],
  robot: ["ai", "ml", "llm", "agent", "agents", "bot", "chatbot", "automation", "automate", "classifier", "embedding", "embeddings", "prompt"],
  shop: ["shop", "store", "cart", "checkout", "payment", "payments", "billing", "invoice", "invoices", "pricing", "subscription", "stripe", "ecommerce", "order", "orders"],
  bridge: ["integration", "integrate", "sync", "migration", "migrate", "connector", "webhook", "webhooks", "import", "export", "etl", "pipeline", "adapter", "gateway", "bridge"],
  rocket: ["deploy", "deployment", "launch", "release", "ci", "cd", "infra", "infrastructure", "kubernetes", "docker", "terraform", "performance", "scaling", "ship"],
  castle: ["auth", "authentication", "login", "security", "permission", "permissions", "role", "roles", "oauth", "sso", "encrypt", "encryption", "secret", "secrets", "harden", "hardening", "access"],
  house: ["app", "page", "pages", "ui", "frontend", "feature", "component", "components", "website", "landing", "form", "settings", "profile", "onboarding"],
};

/** The model whose words best match the task, or null when nothing matches. */
export function pickModel(text: string): ModelId | null {
  const words = text.toLowerCase().match(/[a-z]+/gu) ?? [];
  let best: ModelId | null = null;
  let bestScore = 0;
  for (const id of MODEL_IDS) {
    const vocabulary = new Set(MODEL_WORDS[id]);
    const score = words.reduce((total, word) => total + (vocabulary.has(word) ? 1 : 0), 0);
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

/** The book's own blueprint design, its chosen built-in model, or one picked stably from its id. */
export function designFor(book: { id: string; model?: string | null; design?: Design | null; title?: string }): Design {
  if (book.design) return book.design;
  // Books from before models existed: match one from the title, as new books do.
  if (!book.model && book.title) {
    const matched = pickModel(book.title);
    if (matched) return DESIGNS[matched];
  }
  if (book.model && (MODEL_IDS as readonly string[]).includes(book.model)) return DESIGNS[book.model as ModelId];
  let hash = 0;
  for (const char of book.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return DESIGNS[MODEL_IDS[hash % MODEL_IDS.length] ?? "house"];
}

// ---------------------------------------------------------------- layout

export interface PlacedBrick {
  /** Index in the design's flattened build order. */
  index: number;
  brick: DesignBrick;
  bagId: string;
  /** The bag step whose completion places this brick (0-based). */
  step: number;
}

export interface Bounds {
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
}

export interface ModelLayout {
  design: Design;
  /** Every brick, in back-to-front drawing order. */
  bricks: PlacedBrick[];
  byBag: Map<string, { bricks: PlacedBrick[]; bounds: Bounds }>;
}

interface BagShape {
  id: string;
  steps: unknown[];
}
interface AttachShape {
  steps: Array<{ attaches: string[] }>;
}

/** Bags in the order the Master Builder attaches them. */
export function attachOrder(bags: BagShape[], master: AttachShape): string[] {
  const order: string[] = [];
  for (const step of master.steps) {
    for (const id of step.attaches) if (!order.includes(id) && bags.some((bag) => bag.id === id)) order.push(id);
  }
  for (const bag of bags) if (!order.includes(bag.id)) order.push(bag.id);
  return order;
}

/** Split section sizes into `n` contiguous groups with the smallest largest group. */
function groupSections(sizes: number[], n: number): number[][] {
  const count = sizes.length;
  const prefix = [0];
  for (const size of sizes) prefix.push((prefix[prefix.length - 1] ?? 0) + size);
  const sum = (from: number, to: number) => (prefix[to] ?? 0) - (prefix[from] ?? 0);
  // best[k][i]: smallest possible largest group splitting the first i sections into k groups.
  const best: number[][] = Array.from({ length: n + 1 }, () => Array<number>(count + 1).fill(Infinity));
  const cut: number[][] = Array.from({ length: n + 1 }, () => Array<number>(count + 1).fill(0));
  best[0]![0] = 0;
  for (let k = 1; k <= n; k += 1) {
    for (let i = k; i <= count; i += 1) {
      for (let j = k - 1; j < i; j += 1) {
        const value = Math.max(best[k - 1]![j]!, sum(j, i));
        if (value < best[k]![i]!) {
          best[k]![i] = value;
          cut[k]![i] = j;
        }
      }
    }
  }
  const groups: number[][] = [];
  let end = count;
  for (let k = n; k >= 1; k -= 1) {
    const start = cut[k]![end]!;
    groups.unshift(Array.from({ length: end - start }, (_, offset) => start + offset));
    end = start;
  }
  return groups;
}

/** Brick-index chunks, one per bag, in attach order. */
function chunkDesign(design: Design, n: number): number[][] {
  const sectionBricks: number[][] = [];
  let next = 0;
  for (const section of design.sections) {
    sectionBricks.push(section.bricks.map(() => next++));
  }
  let chunks: number[][];
  if (n <= sectionBricks.length) {
    chunks = groupSections(
      sectionBricks.map((bricks) => bricks.length),
      n,
    ).map((group) => group.flatMap((section) => sectionBricks[section] ?? []));
  } else {
    chunks = sectionBricks.map((bricks) => [...bricks]);
    while (chunks.length < n) {
      let largest = 0;
      chunks.forEach((chunk, index) => {
        if (chunk.length > (chunks[largest]?.length ?? 0)) largest = index;
      });
      const chunk = chunks[largest] ?? [];
      if (chunk.length < 2) break;
      const half = Math.ceil(chunk.length / 2);
      chunks.splice(largest, 1, chunk.slice(0, half), chunk.slice(half));
    }
  }
  return chunks;
}

function boundsOf(bricks: DesignBrick[]): Bounds {
  return {
    x1: Math.min(...bricks.map((brick) => brick.x)),
    y1: Math.min(...bricks.map((brick) => brick.y)),
    z1: Math.min(...bricks.map((brick) => brick.z)),
    x2: Math.max(...bricks.map((brick) => brick.x + brick.w)),
    y2: Math.max(...bricks.map((brick) => brick.y + brick.d)),
    z2: Math.max(...bricks.map((brick) => brick.z + brick.h)),
  };
}

/** Plates to stud-equivalents along the view axis (brick height / 3 / stud pitch). */
const PLATE_RATIO = 0.92 / 3;

function screenBox(brick: DesignBrick) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const x of [brick.x, brick.x + brick.w]) {
    for (const y of [brick.y, brick.y + brick.d]) {
      for (const z of [brick.z, brick.z + brick.h]) {
        xs.push((x - y) * 0.866);
        ys.push((x + y) * 0.5 - z * PLATE_RATIO);
      }
    }
  }
  return { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) };
}

/** True when `a` must be painted before `b` (it is behind or below it). */
function behind(a: DesignBrick, b: DesignBrick): boolean {
  return a.x + a.w <= b.x || a.y + a.d <= b.y || a.z + a.h <= b.z;
}

/** Painter's order for non-overlapping boxes: a topological sort of "is behind". */
export function paintOrder(bricks: DesignBrick[]): number[] {
  const n = bricks.length;
  const screens = bricks.map(screenBox);
  const after: number[][] = Array.from({ length: n }, () => []);
  const incoming = Array<number>(n).fill(0);
  const depth = (brick: DesignBrick) => brick.x + brick.w / 2 + brick.y + brick.d / 2 + (brick.z + brick.h / 2) * PLATE_RATIO;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = screens[i]!;
      const b = screens[j]!;
      if (a.x2 <= b.x1 || b.x2 <= a.x1 || a.y2 <= b.y1 || b.y2 <= a.y1) continue;
      const ab = behind(bricks[i]!, bricks[j]!);
      const ba = behind(bricks[j]!, bricks[i]!);
      let first: number;
      if (ab && !ba) first = i;
      else if (ba && !ab) first = j;
      else first = depth(bricks[i]!) <= depth(bricks[j]!) ? i : j;
      const second = first === i ? j : i;
      after[first]!.push(second);
      incoming[second]! += 1;
    }
  }
  const order: number[] = [];
  const done = Array<boolean>(n).fill(false);
  while (order.length < n) {
    let pick = -1;
    for (let i = 0; i < n; i += 1) {
      if (done[i] || incoming[i]! > 0) continue;
      if (pick === -1 || depth(bricks[i]!) < depth(bricks[pick]!)) pick = i;
    }
    // A cycle (rare with mixed sizes): break it at the shallowest brick.
    if (pick === -1) {
      for (let i = 0; i < n; i += 1) {
        if (!done[i] && (pick === -1 || depth(bricks[i]!) < depth(bricks[pick]!))) pick = i;
      }
    }
    done[pick] = true;
    order.push(pick);
    for (const next of after[pick]!) incoming[next]! -= 1;
  }
  return order;
}

const ORDER_CACHE = new Map<string, number[]>();

function designPaintOrder(design: Design): number[] {
  // Built-in models are shared; custom designs are keyed by their content.
  const key = design.id === "custom" ? JSON.stringify(design.sections) : design.id;
  const cached = ORDER_CACHE.get(key);
  if (cached) return cached;
  const order = paintOrder(design.sections.flatMap((section) => section.bricks));
  if (ORDER_CACHE.size > 32) ORDER_CACHE.clear();
  ORDER_CACHE.set(key, order);
  return order;
}

/** Which bricks each bag builds, which step places each brick, and the draw order. */
export function layoutModel(book: {
  id: string;
  title?: string;
  model?: string | null;
  design?: Design | null;
  bags: BagShape[];
  master: AttachShape;
}): ModelLayout {
  const design = designFor(book);
  const all = design.sections.flatMap((section) => section.bricks);
  const order = attachOrder(book.bags, book.master);
  const chunks = chunkDesign(design, order.length);
  const owner = new Map<number, { bagId: string; step: number }>();
  order.forEach((bagId, bagIndex) => {
    const chunk = chunks[bagIndex] ?? [];
    const steps = Math.max(1, book.bags.find((bag) => bag.id === bagId)?.steps.length ?? 1);
    chunk.forEach((brickIndex, position) => {
      // Spread bricks over the steps so each step places its share.
      const step = Math.min(steps - 1, Math.ceil(((position + 1) * steps) / chunk.length) - 1);
      owner.set(brickIndex, { bagId, step });
    });
  });
  const bricks: PlacedBrick[] = designPaintOrder(design)
    .filter((index) => owner.has(index))
    .map((index) => ({ index, brick: all[index]!, ...owner.get(index)! }));
  const byBag = new Map<string, { bricks: PlacedBrick[]; bounds: Bounds }>();
  for (const bagId of order) {
    const own = bricks.filter((placed) => placed.bagId === bagId);
    if (own.length > 0) byBag.set(bagId, { bricks: own, bounds: boundsOf(own.map((placed) => placed.brick)) });
  }
  return { design, bricks, byBag };
}

/** Whether two bricks share any volume (used to validate designs). */
export function overlaps(a: DesignBrick, b: DesignBrick): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d && a.z < b.z + b.h && b.z < a.z + a.h;
}
