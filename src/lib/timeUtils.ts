// Time utility functions for check-in form

export const DEFAULT_START_TIME = "21:00";

export const generateStartTimeOptions = (): string[] => {
  const options: string[] = [];

  for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
    const hours = Math.floor(minutes / 60)
      .toString()
      .padStart(2, "0");
    const mins = (minutes % 60).toString().padStart(2, "0");
    options.push(`${hours}:${mins}`);
  }

  return options;
};

// Generate time options from 5 AM to 4:30 AM next day (for nightlife hours)
export const generateNightlifeTimeOptions = (): string[] => {
  const options: string[] = [];

  // Start at 5:00 AM (300 minutes from midnight)
  // End at 4:30 AM next day (28.5 hours = 1710 minutes from midnight)
  for (let minutes = 5 * 60; minutes <= 28.5 * 60; minutes += 30) {
    const hours = Math.floor(minutes / 60)
      .toString()
      .padStart(2, "0");
    const mins = (minutes % 60).toString().padStart(2, "0");
    options.push(`${hours}:${mins}`);
  }

  return options;
};

export const generateDurationOptions = (
  startTime?: string
): { value: string; label: string; endTime?: string }[] => {
  const options: { value: string; label: string; endTime?: string }[] = [];

  // 15-minute intervals up to 1 hour
  for (let minutes = 15; minutes <= 60; minutes += 15) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    let label = "";
    if (hours > 0) {
      label = `${hours} hour${hours > 1 ? "s" : ""}`;
      if (remainingMinutes > 0) {
        label += ` ${remainingMinutes} min`;
      }
    } else {
      label = `${minutes} min`;
    }

    // Calculate end time if start time is provided
    let endTime = undefined;
    if (startTime) {
      endTime = calculateEndTime(startTime, minutes);
    }

    options.push({
      value: minutes.toString(),
      label: label,
      endTime: endTime,
    });
  }

  // Then 1.5 hours, 2 hours, 2.5 hours, etc. up to 6 hours
  for (let hours = 1.5; hours <= 6; hours += 0.5) {
    const totalMinutes = Math.round(hours * 60);
    const wholeHours = Math.floor(hours);
    const isHalfHour = hours % 1 === 0.5;

    let label = "";
    if (isHalfHour) {
      label = `${wholeHours}.5 hours`;
    } else {
      label = `${wholeHours} hour${wholeHours > 1 ? "s" : ""}`;
    }

    // Calculate end time if start time is provided
    let endTime = undefined;
    if (startTime) {
      endTime = calculateEndTime(startTime, totalMinutes);
    }

    options.push({
      value: totalMinutes.toString(),
      label: label,
      endTime: endTime,
    });
  }

  return options;
};

export const calculateEndTime = (
  startTime: string,
  durationMinutes: number
): string => {
  const [startHour, startMinute] = startTime.split(":").map(Number);

  // Convert start time to total minutes from midnight
  let totalMinutes = startHour * 60 + startMinute;

  // Add duration
  totalMinutes += durationMinutes;

  // Handle day overflow (next day)
  const endHour = Math.floor(totalMinutes / 60) % 24;
  const endMinute = totalMinutes % 60;

  return `${endHour.toString().padStart(2, "0")}:${endMinute
    .toString()
    .padStart(2, "0")}`;
};

const pad = (value: number): string => value.toString().padStart(2, "0");

const toLocalDateString = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const toLocalTimeString = (date: Date): string =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}`;

export const calculateEndDateTime = (
  date: string,
  startTime: string,
  durationMinutes: number
): { endTime: string; endDateTime: string } => {
  const startDateTime = combineDateAndTime(date, startTime);
  const start = new Date(startDateTime);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

  const endTime = toLocalTimeString(end);

  return { endTime, endDateTime: end.toISOString() };
};

export const combineDateAndTime = (date: string, time: string): string => {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);

  // Handle times >= 24:00 (next day)
  let actualDay = day;
  let actualHours = hours;
  if (hours >= 24) {
    actualDay = day + 1;
    actualHours = hours % 24;
  }

  const combined = new Date(year, month - 1, actualDay, actualHours, minutes, 0, 0);
  return combined.toISOString();
};

export const formatTimeDisplay = (timeString: string): string => {
  const [hours, minutes] = timeString.split(":").map(Number);
  
  // Handle times >= 24:00 (next day)
  let displayHours = hours;
  if (hours >= 24) {
    displayHours = hours % 24;
  }
  
  const hour = displayHours % 12 || 12;
  const ampm = displayHours >= 12 ? "PM" : "AM";
  return `${hour}:${minutes.toString().padStart(2, "0")} ${ampm}`;
};

export const formatDateDisplay = (dateString: string): string => {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
};

// Extract time from Supabase timestamptz format
// Handles both full timestamps ("2024-01-01T10:30:00+00:00") and time strings ("10:30")
export const extractTimeFromTimestamp = (timestamp: string): string => {
  if (!timestamp) return "";

  // If it's just a time string (HH:MM), return it as is
  if (/^\d{2}:\d{2}$/.test(timestamp)) {
    return timestamp;
  }

  const parsed = new Date(timestamp);
  if (!isNaN(parsed.getTime())) {
    return toLocalTimeString(parsed);
  }

  const match = timestamp.match(/(\d{2}):(\d{2})/);
  if (match) {
    return `${match[1]}:${match[2]}`;
  }

  return timestamp; // Return original if we can't parse it
};

// Calculate time difference in minutes (handles overnight)
export const calculateTimeDifference = (
  startTime: string,
  endTime: string
): number => {
  const start = extractTimeFromTimestamp(startTime);
  const end = extractTimeFromTimestamp(endTime);

  const [startHours, startMinutes] = start.split(":").map(Number);
  const [endHours, endMinutes] = end.split(":").map(Number);

  let startTotalMinutes = startHours * 60 + startMinutes;
  let endTotalMinutes = endHours * 60 + endMinutes;

  // Handle overnight (end time is next day)
  if (endTotalMinutes < startTotalMinutes) {
    endTotalMinutes += 24 * 60; // Add 24 hours
  }

  return endTotalMinutes - startTotalMinutes;
};

export const isCheckInInPast = (endDateTime: string): boolean => {
  return new Date(endDateTime).getTime() < Date.now();
};

export const isCheckInActiveAt = (
  checkIn: { startDateTime: string; endDateTime: string },
  targetDate: string,
  targetTime: string
): boolean => {
  // Handle times >= 24:00 (next day) - adjust date and normalize time
  const [hours, minutes] = targetTime.split(":").map(Number);
  let actualTargetDate = targetDate;
  let normalizedTime = targetTime;
  
  if (hours >= 24) {
    // Add one day to the target date
    const date = new Date(targetDate + "T00:00:00");
    date.setDate(date.getDate() + 1);
    actualTargetDate = toLocalDateString(date);
    // Normalize time: 24:00 -> 00:00, 25:30 -> 01:30, etc.
    const normalizedHours = hours % 24;
    normalizedTime = `${normalizedHours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  }
  
  const targetDateTime = combineDateAndTime(actualTargetDate, normalizedTime);
  const target = new Date(targetDateTime).getTime();
  const start = new Date(checkIn.startDateTime).getTime();
  const end = new Date(checkIn.endDateTime).getTime();

  return target >= start && target <= end;
};

const ensureDateString = (value?: string | null): string => {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return toLocalDateString(new Date());
};

export const normalizeDateTime = ({
  raw,
  date,
  fallbackTime = DEFAULT_START_TIME,
}: {
  raw?: string | null;
  date?: string | null;
  fallbackTime?: string;
}): { iso: string; date: string; time: string } => {
  let resolvedDate = ensureDateString(date);

  if (raw && /^\d{2}:\d{2}$/.test(raw)) {
    return {
      iso: combineDateAndTime(resolvedDate, raw),
      date: resolvedDate,
      time: raw,
    };
  }

  if (raw) {
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) {
      return {
        iso: parsed.toISOString(),
        date: toLocalDateString(parsed),
        time: toLocalTimeString(parsed),
      };
    }
  }

  return {
    iso: combineDateAndTime(resolvedDate, fallbackTime),
    date: resolvedDate,
    time: fallbackTime,
  };
};
