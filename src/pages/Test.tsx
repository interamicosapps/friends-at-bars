import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import CheckInForm from "@/components/CheckInForm";
import CheckInList from "@/components/CheckInList";
import MapView from "@/components/MapView";
import ConflictConfirmationDialog from "@/components/ConflictConfirmationDialog";
import { CheckIn, CheckInFormData, SupabaseCheckIn } from "@/types/checkin";
import {
  calculateEndDateTime,
  combineDateAndTime,
  extractTimeFromTimestamp,
  calculateTimeDifference,
  isCheckInInPast,
  DEFAULT_START_TIME,
  normalizeDateTime,
  generateNightlifeTimeOptions,
} from "@/lib/timeUtils";
import {
  findConflictingCheckIns,
  calculateAdjustments,
  adjustCheckInTimes,
} from "@/lib/conflictUtils";
import { jsonService } from "@/lib/jsonClient";
import { OHIO_STATE_VENUES } from "@/data/venues";
import {
  addUserCheckInId,
  getUserCheckInIds,
  removeUserCheckInId,
} from "@/lib/userCheckIns";

export default function Test() {
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]); // All check-ins (for map)
  const [userCheckIns, setUserCheckIns] = useState<CheckIn[]>([]); // User's own check-ins (for list)
  const [pendingCheckIn, setPendingCheckIn] = useState<CheckIn | null>(null);
  const [conflictingCheckIns, setConflictingCheckIns] = useState<CheckIn[]>([]);
  const [adjustments, setAdjustments] = useState<
    { original: CheckIn; adjusted: CheckIn }[]
  >([]);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [formResetKey, setFormResetKey] = useState(0);
  const [mapSelectedDate, setMapSelectedDate] = useState<string>("2025-11-19");
  const [mapSelectedTime, setMapSelectedTime] = useState<string>("21:00");
  const nightlifeTimeOptions = generateNightlifeTimeOptions();
  const [jsonStatus, setJsonStatus] = useState<string>("Loaded");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const generateTempId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Date.now().toString();

  const buildCheckInFromForm = (formData: CheckInFormData): CheckIn => {
    const { endTime, endDateTime } = calculateEndDateTime(
      formData.date,
      formData.startTime,
      formData.durationMinutes
    );
    const startDateTime = combineDateAndTime(
      formData.date,
      formData.startTime
    );
    const venueDetails = OHIO_STATE_VENUES.find(
      (v) => v.name === formData.venue
    );

    return {
      id: generateTempId(),
      venue: formData.venue,
      venueArea: venueDetails?.area,
      date: formData.date,
      startTime: formData.startTime,
      durationMinutes: formData.durationMinutes,
      endTime,
      startDateTime,
      endDateTime,
      timestamp: new Date(),
    };
  };

  const finalizeCheckIn = async (
    checkIn: CheckIn,
    adjustedCheckIns: CheckIn[] = []
  ) => {
    const result = await jsonService.insertCheckIn({
      venue: checkIn.venue,
      start_time: checkIn.startDateTime,
      end_time: checkIn.endDateTime,
      date: checkIn.date,
    });

    if (!result?.id) {
      throw new Error("Failed to save check-in.");
    }

    addUserCheckInId(result.id);

    const startTimeFromResult = extractTimeFromTimestamp(
      result.start_time ?? checkIn.startDateTime
    );
    const endTimeFromResult = extractTimeFromTimestamp(
      result.end_time ?? checkIn.endDateTime
    );

    const insertedCheckIn: CheckIn = {
      ...checkIn,
      id: result.id,
      date: result.date ?? checkIn.date,
      startTime: startTimeFromResult,
      endTime: endTimeFromResult,
      startDateTime: result.start_time ?? checkIn.startDateTime,
      endDateTime: result.end_time ?? checkIn.endDateTime,
      durationMinutes: calculateTimeDifference(
        startTimeFromResult,
        endTimeFromResult
      ),
      timestamp: new Date(result.created_at),
    };

    const normalizedAdjusted = adjustedCheckIns.map((item) => {
      const startDateTime = combineDateAndTime(item.date, item.startTime);
      const { endTime, endDateTime } = calculateEndDateTime(
        item.date,
        item.startTime,
        item.durationMinutes
      );

      return {
        ...item,
        startDateTime,
        endTime,
        endDateTime,
        durationMinutes: calculateTimeDifference(item.startTime, endTime),
      };
    });

    if (normalizedAdjusted.length > 0) {
      try {
        await jsonService.updateMultipleCheckIns(
          normalizedAdjusted.map((item) => ({
            id: item.id,
            start_time: item.startDateTime,
            end_time: item.endDateTime,
            date: item.date,
          }))
        );
      } catch (error) {
        console.error(
          "Failed to update conflicting check-ins in JSON:",
          error
        );
        throw error;
      }
    }

    setCheckIns((prev) => {
      const filtered = prev.filter(
        (existing) =>
          existing.id !== checkIn.id &&
          existing.id !== result.id &&
          !normalizedAdjusted.some((adj) => adj.id === existing.id)
      );

      const updated = [insertedCheckIn, ...normalizedAdjusted, ...filtered];

      return updated.sort(
        (a, b) =>
          new Date(a.startDateTime).getTime() -
          new Date(b.startDateTime).getTime()
      );
    });

    // Trigger form reset (for both direct submissions and resolved conflicts)
    setFormResetKey(Date.now());
  };

  const getCurrentUserCheckIns = () => {
    const userCheckInIds = getUserCheckInIds();
    return checkIns
      .filter((checkIn) => userCheckInIds.includes(checkIn.id))
      .filter((checkIn) => !isCheckInInPast(checkIn.endDateTime))
      .sort(
        (a, b) =>
          new Date(a.startDateTime).getTime() -
          new Date(b.startDateTime).getTime()
      );
  };

  // Keep user's personal list in sync whenever the global check-ins change
  useEffect(() => {
    setUserCheckIns(getCurrentUserCheckIns());
  }, [checkIns]);

  // Function to load check-ins from JSON
  const loadCheckIns = async () => {
    try {
      const jsonData = await jsonService.fetchCheckIns();

      const convertedCheckIns: CheckIn[] = jsonData.map(
        (jsonCheckIn: SupabaseCheckIn) => {
          const startFallbackTime =
            extractTimeFromTimestamp(
              jsonCheckIn.start_time ?? jsonCheckIn.created_at
            ) || DEFAULT_START_TIME;

          const normalizedStart = normalizeDateTime({
            raw: jsonCheckIn.start_time,
            date: jsonCheckIn.date,
            fallbackTime: startFallbackTime,
          });

          const normalizedEnd = normalizeDateTime({
            raw: jsonCheckIn.end_time,
            date: normalizedStart.date,
            fallbackTime: normalizedStart.time,
          });

          let startDateTime = normalizedStart.iso;
          let startTime = normalizedStart.time;
          let eventDate = normalizedStart.date;

          let endDateTime = normalizedEnd.iso;
          let endTime = normalizedEnd.time;

          let durationMinutes = Math.round(
            (new Date(endDateTime).getTime() -
              new Date(startDateTime).getTime()) /
              60000
          );

          if (
            !jsonCheckIn.end_time ||
            !Number.isFinite(durationMinutes) ||
            durationMinutes <= 0
          ) {
            const fallbackDuration = calculateTimeDifference(
              startTime,
              endTime
            );
            const duration =
              fallbackDuration > 0 ? fallbackDuration : 60;
            const computed = calculateEndDateTime(
              eventDate,
              startTime,
              duration
            );
            endTime = computed.endTime;
            endDateTime = computed.endDateTime;
            durationMinutes = duration;
          }

          const venue = OHIO_STATE_VENUES.find(
            (v) => v.name === jsonCheckIn.venue
          );

          return {
            id: jsonCheckIn.id,
            venue: jsonCheckIn.venue,
            venueArea: venue?.area,
            date: eventDate,
            startTime,
            durationMinutes,
            endTime,
            startDateTime,
            endDateTime,
            timestamp: new Date(jsonCheckIn.created_at),
          };
        }
      );

      setCheckIns(
        convertedCheckIns.sort(
          (a, b) =>
            new Date(a.startDateTime).getTime() -
            new Date(b.startDateTime).getTime()
        )
      );
      setJsonStatus(`Loaded ${convertedCheckIns.length} check-ins`);
    } catch (error) {
      console.error("Error loading check-ins from JSON:", error);
      setJsonStatus("Error loading data");
    }
  };

  // Fetch check-ins from JSON on page load
  useEffect(() => {
    loadCheckIns();
  }, []);

  const handleCheckInSubmit = async (
    formData: CheckInFormData
  ): Promise<"success" | "conflict"> => {
    const draftCheckIn = buildCheckInFromForm(formData);

    // Check for conflicts only within the current user's check-ins
    const conflicts = findConflictingCheckIns(
      draftCheckIn,
      getCurrentUserCheckIns()
    );

    if (conflicts.length > 0) {
      setPendingCheckIn(draftCheckIn);
      setConflictingCheckIns(conflicts);
      setAdjustments(calculateAdjustments(draftCheckIn, conflicts));
      setShowConflictDialog(true);
      return "conflict";
    }

    await finalizeCheckIn(draftCheckIn);
    return "success";
  };

  const handleConfirmConflict = async () => {
    if (!pendingCheckIn) return;

    try {
      const { adjustedCheckIns, newCheckIn } = adjustCheckInTimes(
        pendingCheckIn,
        conflictingCheckIns
      );

      await finalizeCheckIn(newCheckIn, adjustedCheckIns);
    } catch (error) {
      console.error("Error finalizing conflicting check-in:", error);
    } finally {
      setShowConflictDialog(false);
      setPendingCheckIn(null);
      setConflictingCheckIns([]);
      setAdjustments([]);
    }
  };

  const handleCancelConflict = () => {
    setShowConflictDialog(false);
    setPendingCheckIn(null);
    setConflictingCheckIns([]);
    setAdjustments([]);
  };

  const handleDeleteCheckIn = async (id: string) => {
    try {
      await jsonService.deleteCheckIn(id);
      removeUserCheckInId(id);
      setCheckIns((prev) => prev.filter((checkIn) => checkIn.id !== id));
    } catch (error) {
      console.error("Failed to delete check-in:", error);
    }
  };

  const handleMapDateChange = (date: string) => {
    setMapSelectedDate(date);
    setMapSelectedTime("21:00"); // Reset to default time (9:00 PM)
  };

  const handleMapTimeChange = (time: string) => {
    setMapSelectedTime(time);
  };

  const handleDownloadJSON = () => {
    try {
      jsonService.downloadJSON();
      setJsonStatus("Downloaded test-data.json");
    } catch (error) {
      console.error("Failed to download JSON:", error);
      setJsonStatus("Error downloading");
    }
  };

  const handleUploadJSON = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      await jsonService.uploadJSON(file);
      setJsonStatus(`Loaded ${file.name}`);
      // Reload check-ins after upload
      await loadCheckIns();
    } catch (error) {
      console.error("Failed to upload JSON:", error);
      setJsonStatus("Error uploading file");
    } finally {
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Map Section */}
      <div className="mb-8">
        <MapView
          checkIns={checkIns}
          selectedDate={mapSelectedDate}
          selectedTime={mapSelectedTime}
          onSelectDate={handleMapDateChange}
          onSelectTime={handleMapTimeChange}
          heatMapMode={true}
          showRightPanel={true}
          timeOptions={nightlifeTimeOptions}
        />
      </div>

      {/* Check-in Form */}
      <div className="mb-8">
        <CheckInForm
          onSubmit={handleCheckInSubmit}
          resetTrigger={formResetKey}
        />
      </div>

      {/* Check-in List - Only user's own check-ins */}
      <div className="mb-8">
        <CheckInList checkIns={userCheckIns} onDelete={handleDeleteCheckIn} />
      </div>

      {/* Conflict Confirmation Dialog */}
      {showConflictDialog && pendingCheckIn && (
        <ConflictConfirmationDialog
          newCheckIn={pendingCheckIn}
          conflictingCheckIns={conflictingCheckIns}
          adjustments={adjustments}
          onConfirm={handleConfirmConflict}
          onCancel={handleCancelConflict}
        />
      )}
    </div>
  );
}

