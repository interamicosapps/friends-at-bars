import { CheckIn } from "@/types/checkin";
import {
  calculateEndDateTime,
  calculateTimeDifference,
  combineDateAndTime,
} from "@/lib/timeUtils";

// Example usage:
// If user has check-in: "Bar A" from 7:30 PM to 9:30 PM
// And then checks in: "Bar B" from 6:30 PM to 8:00 PM
// The system will:
// 1. Detect overlap between 6:30-8:00 and 7:30-9:30
// 2. Adjust "Bar A" to 8:00 PM to 9:30 PM
// 3. Keep "Bar B" as 6:30 PM to 8:00 PM

// Convert time string to minutes from midnight
export const timeToMinutes = (timeString: string): number => {
  const [hours, minutes] = timeString.split(":").map(Number);
  return hours * 60 + minutes;
};

// Convert minutes from midnight to time string
export const minutesToTime = (minutes: number): string => {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins
    .toString()
    .padStart(2, "0")}`;
};

const syncDerivedFields = (checkIn: CheckIn): CheckIn => {
  const { endTime, endDateTime } = calculateEndDateTime(
    checkIn.date,
    checkIn.startTime,
    checkIn.durationMinutes
  );

  return {
    ...checkIn,
    startDateTime: combineDateAndTime(checkIn.date, checkIn.startTime),
    endTime,
    endDateTime,
    durationMinutes: calculateTimeDifference(checkIn.startTime, endTime),
  };
};

// Check if two time ranges overlap
export const checkTimeOverlap = (
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean => {
  const start1Min = timeToMinutes(start1);
  const end1Min = timeToMinutes(end1);
  const start2Min = timeToMinutes(start2);
  const end2Min = timeToMinutes(end2);

  // Check for overlap: start1 < end2 && start2 < end1
  return start1Min < end2Min && start2Min < end1Min;
};

// Find conflicting check-ins
export const findConflictingCheckIns = (
  newCheckIn: CheckIn,
  existingCheckIns: CheckIn[]
): CheckIn[] => {
  return existingCheckIns.filter((existing) => {
    if (existing.date !== newCheckIn.date || existing.id === newCheckIn.id) {
      return false;
    }

    return checkTimeOverlap(
      newCheckIn.startTime,
      newCheckIn.endTime,
      existing.startTime,
      existing.endTime
    );
  });
};

// Adjust check-in times to resolve conflicts
export const adjustCheckInTimes = (
  newCheckIn: CheckIn,
  conflictingCheckIns: CheckIn[]
): { adjustedCheckIns: CheckIn[]; newCheckIn: CheckIn } => {
  const adjustedCheckIns = conflictingCheckIns.map((checkIn) => ({ ...checkIn }));
  let adjustedNewCheckIn = { ...newCheckIn };

  // Sort conflicting check-ins by start time
  adjustedCheckIns.sort(
    (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime)
  );

  // Process each conflict
  for (let i = 0; i < adjustedCheckIns.length; i++) {
    const conflicting = adjustedCheckIns[i];
    const newStart = timeToMinutes(adjustedNewCheckIn.startTime);
    const newEnd = timeToMinutes(adjustedNewCheckIn.endTime);
    const conflictStart = timeToMinutes(conflicting.startTime);
    const conflictEnd = timeToMinutes(conflicting.endTime);

    // If new check-in starts before conflicting one
    if (newStart < conflictStart) {
      // Adjust conflicting check-in to start when new one ends
      if (newEnd > conflictStart) {
        conflicting.startTime = minutesToTime(newEnd);
        conflicting.durationMinutes = calculateTimeDifference(
          conflicting.startTime,
          conflicting.endTime
        );
      }
    }
    // If new check-in starts after conflicting one
    else if (newStart > conflictStart) {
      // Adjust conflicting check-in to end when new one starts
      if (newStart < conflictEnd) {
        conflicting.endTime = minutesToTime(newStart);
        conflicting.durationMinutes = calculateTimeDifference(
          conflicting.startTime,
          conflicting.endTime
        );
      }
    }
    // If they start at the same time, adjust conflicting one to end when new one ends
    else {
      conflicting.endTime = minutesToTime(newEnd);
      conflicting.durationMinutes = calculateTimeDifference(
        conflicting.startTime,
        conflicting.endTime
      );
    }

    adjustedCheckIns[i] = syncDerivedFields(conflicting);
  }

  adjustedNewCheckIn = syncDerivedFields(adjustedNewCheckIn);

  return {
    adjustedCheckIns,
    newCheckIn: adjustedNewCheckIn,
  };
};

// Calculate what the adjusted times would be for display
export const calculateAdjustments = (
  newCheckIn: CheckIn,
  conflictingCheckIns: CheckIn[]
): { original: CheckIn; adjusted: CheckIn }[] => {
  const { adjustedCheckIns } = adjustCheckInTimes(
    newCheckIn,
    conflictingCheckIns
  );

  return conflictingCheckIns.map((original, index) => ({
    original,
    adjusted: adjustedCheckIns[index],
  }));
};
