import { useState, useEffect, Suspense, lazy, useMemo, useRef } from "react";
import { format } from "date-fns";
import CheckInForm from "@/components/CheckInForm";
import CheckInList from "@/components/CheckInList";
import ConflictConfirmationDialog from "@/components/ConflictConfirmationDialog";
import LocationToggle from "@/components/LocationToggle";

// Lazy load MapView component (includes heavy map libraries)
const MapView = lazy(() => import("@/components/MapView"));
import { CheckIn, CheckInFormData, SupabaseCheckIn } from "@/types/checkin";
import {
  calculateEndDateTime,
  combineDateAndTime,
  extractTimeFromTimestamp,
  calculateTimeDifference,
  isCheckInInPast,
  DEFAULT_START_TIME,
  normalizeDateTime,
  buildNightlifeTimeOptionsForSlider,
  getDynamicStartTime,
} from "@/lib/timeUtils";
import {
  findConflictingCheckIns,
  calculateAdjustments,
  adjustCheckInTimes,
} from "@/lib/conflictUtils";
import { checkInService } from "@/lib/supabaseClient";
import { OHIO_STATE_VENUES } from "@/data/venues";
import {
  addUserCheckInId,
  getUserCheckInIds,
  removeUserCheckInId,
} from "@/lib/userCheckIns";

export default function Home() {
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]); // All check-ins (for map)
  const [userCheckIns, setUserCheckIns] = useState<CheckIn[]>([]); // User's own check-ins (for list)
  const [pendingCheckIn, setPendingCheckIn] = useState<CheckIn | null>(null);
  const [conflictingCheckIns, setConflictingCheckIns] = useState<CheckIn[]>([]);
  const [adjustments, setAdjustments] = useState<
    { original: CheckIn; adjusted: CheckIn }[]
  >([]);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [formResetKey, setFormResetKey] = useState(0);
  const [mapSelectedDate, setMapSelectedDate] = useState<string>(() =>
    format(new Date(), "yyyy-MM-dd")
  );
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const mapTimeSliderAnchorRef = useRef<string | undefined>(undefined);
  if (mapTimeSliderAnchorRef.current === undefined) {
    mapTimeSliderAnchorRef.current = getDynamicStartTime();
  }
  const [mapSelectedTime, setMapSelectedTime] = useState(
    () => mapTimeSliderAnchorRef.current!
  );
  const nightlifeTimeOptions = useMemo(
    () =>
      buildNightlifeTimeOptionsForSlider(mapTimeSliderAnchorRef.current!),
    [mapSelectedDate]
  );

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
    const result = await checkInService.insertCheckIn({
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
        await checkInService.updateMultipleCheckIns(
          normalizedAdjusted.map((item) => ({
            id: item.id,
            start_time: item.startDateTime,
            end_time: item.endDateTime,
            date: item.date,
          }))
        );
      } catch (error) {
        console.error(
          "Failed to update conflicting check-ins in Supabase:",
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

  // Function to load check-ins from Supabase
  const loadCheckIns = async () => {
    try {
      const supabaseData = await checkInService.fetchCheckIns();

      const convertedCheckIns: CheckIn[] = supabaseData.map(
        (supabaseCheckIn: SupabaseCheckIn) => {
          const startFallbackTime =
            extractTimeFromTimestamp(
              supabaseCheckIn.start_time ?? supabaseCheckIn.created_at
            ) || DEFAULT_START_TIME;

          const normalizedStart = normalizeDateTime({
            raw: supabaseCheckIn.start_time,
            date: supabaseCheckIn.date,
            fallbackTime: startFallbackTime,
          });

          const normalizedEnd = normalizeDateTime({
            raw: supabaseCheckIn.end_time,
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
            !supabaseCheckIn.end_time ||
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
            (v) => v.name === supabaseCheckIn.venue
          );

          return {
            id: supabaseCheckIn.id,
            venue: supabaseCheckIn.venue,
            venueArea: venue?.area,
            date: eventDate,
            startTime,
            durationMinutes,
            endTime,
            startDateTime,
            endDateTime,
            timestamp: new Date(supabaseCheckIn.created_at),
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
    } catch (error) {
      console.error("Error loading check-ins from Supabase:", error);
    }
  };

  // Fetch check-ins from Supabase on page load
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
      await checkInService.deleteCheckIn(id);
      removeUserCheckInId(id);
      setCheckIns((prev) => prev.filter((checkIn) => checkIn.id !== id));
    } catch (error) {
      console.error("Failed to delete check-in:", error);
    }
  };

  const handleMapDateChange = (date: string) => {
    setMapSelectedDate(date);
    const now = getDynamicStartTime();
    mapTimeSliderAnchorRef.current = now;
    setMapSelectedTime(now);
  };

  const handleMapTimeChange = (time: string) => {
    setMapSelectedTime(time);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Location Tracking Toggle */}
      <div className="mb-4 flex justify-end">
        <LocationToggle onLocationUpdate={setUserLocation} />
      </div>

      {/* Map Section */}
      <div className="mb-8">
        <Suspense
          fallback={
            <div className="flex h-96 items-center justify-center rounded-xl border border-gray-200 bg-gray-50">
              <div className="text-center">
                <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]"></div>
                <p className="text-sm text-gray-600">Loading map...</p>
              </div>
            </div>
          }
        >
          <MapView
            checkIns={checkIns}
            selectedDate={mapSelectedDate}
            selectedTime={mapSelectedTime}
            onSelectDate={handleMapDateChange}
            onSelectTime={handleMapTimeChange}
            timeOptions={nightlifeTimeOptions}
            userLocation={userLocation}
          />
        </Suspense>
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
