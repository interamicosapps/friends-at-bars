export interface CheckIn {
  id: string;
  venue: string;
  venueArea?: string; // Optional area for future use
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm (24h)
  durationMinutes: number;
  endTime: string; // HH:mm (24h)
  startDateTime: string; // ISO string representing start
  endDateTime: string; // ISO string representing end
  timestamp: Date;
}

export interface CheckInFormData {
  venue: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  durationMinutes: number;
}

export interface Venue {
  name: string;
  area: string;
  coordinates: [number, number]; // [latitude, longitude]
}

// Supabase database types
export interface SupabaseCheckIn {
  id: string;
  venue: string;
  start_time: string;
  end_time: string;
  date: string | null;
  created_at: string;
}

export interface SupabaseCheckInInsert {
  venue: string;
  start_time: string;
  end_time: string;
  date?: string | null;
}
