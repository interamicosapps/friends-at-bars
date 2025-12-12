import { SupabaseCheckIn, SupabaseCheckInInsert } from "@/types/checkin";

// Test data structure from test-data.json
interface TestDataCheckIn {
  user_number?: number;
  id: string;
  venue: string;
  date: string;
  start_time: string;
  end_time: string;
  created_at: string;
}

// In-memory storage for test check-ins (new ones added during test session)
let testCheckIns: SupabaseCheckIn[] = [];
let initialDataLoaded = false;

// Load initial data from test-data.json
const loadInitialData = async (): Promise<SupabaseCheckIn[]> => {
  if (initialDataLoaded && testCheckIns.length > 0) {
    return testCheckIns;
  }

  try {
    const response = await fetch("/test-data.json");
    if (!response.ok) {
      throw new Error(`Failed to load test data: ${response.statusText}`);
    }

    const testData: TestDataCheckIn[] = await response.json();

    // Convert test data format to SupabaseCheckIn format
    const convertedData: SupabaseCheckIn[] = testData.map((item) => ({
      id: item.id,
      venue: item.venue,
      start_time: item.start_time,
      end_time: item.end_time,
      date: item.date || null,
      created_at: item.created_at,
    }));

    testCheckIns = convertedData;
    initialDataLoaded = true;

    // Also load any test-specific check-ins from localStorage
    const storedTestCheckIns = localStorage.getItem("testCheckIns");
    if (storedTestCheckIns) {
      try {
        const parsed = JSON.parse(storedTestCheckIns) as SupabaseCheckIn[];
        // Merge with initial data, avoiding duplicates
        const existingIds = new Set(testCheckIns.map((c) => c.id));
        const newCheckIns = parsed.filter((c) => !existingIds.has(c.id));
        testCheckIns = [...testCheckIns, ...newCheckIns];
      } catch (error) {
        console.error("Error parsing stored test check-ins:", error);
      }
    }

    return testCheckIns;
  } catch (error) {
    console.error("Error loading test data:", error);
    throw error;
  }
};

// Save test check-ins to localStorage
const saveTestCheckIns = () => {
  try {
    // Only save check-ins that aren't in the original test-data.json
    // We'll identify them by checking if they were added after initial load
    // For simplicity, we'll save all test check-ins
    localStorage.setItem("testCheckIns", JSON.stringify(testCheckIns));
  } catch (error) {
    console.error("Error saving test check-ins to localStorage:", error);
  }
};

// Test data service that mimics checkInService interface
export const testDataService = {
  // Insert a new check-in
  async insertCheckIn(data: SupabaseCheckInInsert): Promise<SupabaseCheckIn> {
    // Ensure initial data is loaded
    if (!initialDataLoaded) {
      await loadInitialData();
    }

    const newCheckIn: SupabaseCheckIn = {
      id: typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Date.now().toString(),
      venue: data.venue,
      start_time: data.start_time,
      end_time: data.end_time,
      date: data.date || null,
      created_at: new Date().toISOString(),
    };

    testCheckIns.push(newCheckIn);
    saveTestCheckIns();

    return newCheckIn;
  },

  // Fetch all check-ins
  async fetchCheckIns(): Promise<SupabaseCheckIn[]> {
    return await loadInitialData();
  },

  // Update the start/end time for a single check-in
  async updateCheckInTimes(
    id: string,
    updates: { start_time?: string; end_time?: string; date?: string | null }
  ): Promise<SupabaseCheckIn> {
    const index = testCheckIns.findIndex((checkIn) => checkIn.id === id);
    if (index === -1) {
      throw new Error(`Check-in with id ${id} not found`);
    }

    const updatedCheckIn: SupabaseCheckIn = {
      ...testCheckIns[index],
      ...updates,
    };

    testCheckIns[index] = updatedCheckIn;
    saveTestCheckIns();

    return updatedCheckIn;
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
        testDataService.updateCheckInTimes(id, { start_time, end_time, date })
      )
    );
  },

  // Delete a check-in by ID
  async deleteCheckIn(id: string): Promise<void> {
    const index = testCheckIns.findIndex((checkIn) => checkIn.id === id);
    if (index === -1) {
      throw new Error(`Check-in with id ${id} not found`);
    }

    testCheckIns.splice(index, 1);
    saveTestCheckIns();
  },
};


