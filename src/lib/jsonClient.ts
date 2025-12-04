import { SupabaseCheckIn, SupabaseCheckInInsert } from "@/types/checkin";

// In-memory storage for check-ins (replaces Supabase)
let checkInsData: (SupabaseCheckIn & { user_number?: number })[] = [];

// JSON service that mirrors checkInService API
export const jsonService = {
  // Fetch all check-ins from JSON file
  async fetchCheckIns(): Promise<SupabaseCheckIn[]> {
    try {
      const response = await fetch("/test-data.json");
      if (!response.ok) {
        throw new Error(`Failed to load test data: ${response.statusText}`);
      }
      const data = await response.json();
      checkInsData = data;
      // Return without user_number field for compatibility
      return checkInsData.map(({ user_number, ...rest }) => rest);
    } catch (error) {
      console.error("Error loading check-ins from JSON:", error);
      // Return empty array if file doesn't exist or fails to load
      return [];
    }
  },

  // Insert a new check-in
  async insertCheckIn(data: SupabaseCheckInInsert): Promise<SupabaseCheckIn> {
    const newCheckIn: SupabaseCheckIn = {
      id: typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Date.now().toString(),
      venue: data.venue,
      start_time: data.start_time,
      end_time: data.end_time,
      date: data.date ?? null,
      created_at: new Date().toISOString(),
    };

    checkInsData.push(newCheckIn);
    return newCheckIn;
  },

  // Update the start/end time for a single check-in
  async updateCheckInTimes(
    id: string,
    updates: { start_time?: string; end_time?: string; date?: string | null }
  ): Promise<SupabaseCheckIn> {
    const index = checkInsData.findIndex((ci) => ci.id === id);
    if (index === -1) {
      throw new Error(`Check-in with id ${id} not found`);
    }

    checkInsData[index] = {
      ...checkInsData[index],
      ...updates,
    };

    const { user_number, ...rest } = checkInsData[index];
    return rest;
  },

  // Update multiple check-ins in parallel
  async updateMultipleCheckIns(
    updates: {
      id: string;
      start_time?: string;
      end_time?: string;
      date?: string | null;
    }[]
  ): Promise<SupabaseCheckIn[]> {
    return Promise.all(
      updates.map(({ id, start_time, end_time, date }) =>
        jsonService.updateCheckInTimes(id, { start_time, end_time, date })
      )
    );
  },

  // Delete a check-in by ID
  async deleteCheckIn(id: string): Promise<void> {
    const index = checkInsData.findIndex((ci) => ci.id === id);
    if (index === -1) {
      throw new Error(`Check-in with id ${id} not found`);
    }
    checkInsData.splice(index, 1);
  },

  // Download current data as JSON file
  downloadJSON(): void {
    const dataStr = JSON.stringify(checkInsData, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "test-data.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  // Upload and replace data with uploaded JSON file
  async uploadJSON(file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const data = JSON.parse(text);
          if (Array.isArray(data)) {
            checkInsData = data;
            resolve();
          } else {
            reject(new Error("Invalid JSON format: expected an array"));
          }
        } catch (error) {
          reject(new Error(`Failed to parse JSON: ${error}`));
        }
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });
  },

  // Get current data (for internal use)
  getCurrentData(): (SupabaseCheckIn & { user_number?: number })[] {
    return checkInsData;
  },

  // Set data directly (for internal use)
  setData(data: (SupabaseCheckIn & { user_number?: number })[]): void {
    checkInsData = data;
  },
};

