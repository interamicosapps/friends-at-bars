import { Venue } from "@/types/checkin";

export const OHIO_STATE_VENUES: Venue[] = [
  // North Campus
  {
    name: "Out-R-Inn",
    area: "North Campus",
    coordinates: [40.0051, -83.00845],
  }, // 40°00'18"N 83°00'30"W
  { name: "Horseshoe", area: "North Campus", coordinates: [40.0064, -83.0095] }, // 40°00'22"N 83°00'34"W
  {
    name: "Little Bar",
    area: "North Campus",
    coordinates: [40.0068, -83.0097], // 40°00'24"N 83°00'35"W
  },
  { name: "Library", area: "North Campus", coordinates: [40.0066, -83.0095] }, // 40°00'23"N 83°00'34"W
  { name: "Three's", area: "North Campus", coordinates: [40.0072, -83.0097] }, // 40°00'25"N 83°00'34"W
  { name: "Five's", area: "North Campus", coordinates: [40.0106, -83.0105] }, // 40°00'38"N 83°00'37"W

  // South Campus
  {
    name: "Ethyl & Tank",
    area: "South Campus",
    coordinates: [39.9975, -83.0069], // 39°59'51"N 83°00'25"W
  },
  { name: "Midway", area: "South Campus", coordinates: [39.9975, -83.00735] }, // 39°59'51"N 83°00'26"W
  {
    name: "Big Bar / Sky Bar",
    area: "South Campus",
    coordinates: [39.9972, -83.0073], // 39°59'50"N 83°00'26"W
  },
  {
    name: "Ugly Tuna 2",
    area: "South Campus",
    coordinates: [39.9953, -83.0018], // 39°59'43"N 83°00'06"W
  },
  { name: "Euporia", area: "South Campus", coordinates: [39.99416, -83.0062] }, // 39°59'38"N 83°00'22"W
  { name: "Leo's", area: "South Campus", coordinates: [39.9956, -83.00654] }, // 39°59'44"N 83°00'23"W

  // Short North
  { name: "Standard", area: "Short North", coordinates: [39.9848, -83.0048] }, // 39°59'05"N 83°00'17"W
  { name: "Brother's", area: "Short North", coordinates: [39.9717, -83.0051] }, // 39°58'18"N 83°00'18"W
  { name: "TownHall", area: "Short North", coordinates: [39.9788, -83.0035] }, // 39°58'43"N 83°00'12"W
  {
    name: "Good Night John Boy",
    area: "Short North",
    coordinates: [39.98103, -83.00403], // 39°58'51"N 83°00'14"W
  },
  {
    name: "Pint House",
    area: "Short North",
    coordinates: [39.9782, -83.00347],
  }, // 39°58'42"N 83°00'12"W
  {
    name: "Draft Kings",
    area: "Short North",
    coordinates: [39.9794, -83.00375],
  }, // 39°58'46"N 83°00'13"W
  {
    name: "The Go Go",
    area: "Short North",
    coordinates: [39.98314, -82.9994],
  }, // 39°58'59"N 82°59'57"W
  {
    name: "Axis",
    area: "Short North",
    coordinates: [39.97805, -83.00443],
  }, // 39°58'40"N 83°00'15"W
  {
    name: "Galla Park",
    area: "Short North",
    coordinates: [39.98065, -83.00397],
  }, // 39°58'50"N 83°00'14"W
];

export const CAMPUS_AREAS = [
  "North Campus",
  "South Campus",
  "Short North",
] as const;
