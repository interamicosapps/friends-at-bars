import { useState, useEffect } from "react";
import CheckInForm from "@/components/CheckInForm";
import CheckInList from "@/components/CheckInList";
import MapView from "@/components/MapView";
import ConflictConfirmationDialog from "@/components/ConflictConfirmationDialog";
import { CheckIn, CheckInFormData, SupabaseCheckIn } from "@/types/checkin";
import {
  calculateEndTime,
  extractTimeFromTimestamp,
  calculateTimeDifference,
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

  const generateTempId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Date.now().toString();

  const buildCheckInFromForm = (formData: CheckInFormData): CheckIn => {
    const endTime = calculateEndTime(
      formData.startTime,
      formData.durationMinutes
    );
    const venueDetails = OHIO_STATE_VENUES.find(
      (v) => v.name === formData.venue
    );

    return {
      id: generateTempId(),
      venue: formData.venue,
      venueArea: venueDetails?.area,
      startTime: formData.startTime,
      durationMinutes: formData.durationMinutes,
      endTime,
      timestamp: new Date(),
    };
  };

  const finalizeCheckIn = async (
    checkIn: CheckIn,
    adjustedCheckIns: CheckIn[] = []
  ) => {
    const result = await checkInService.insertCheckIn({
      venue: checkIn.venue,
      start_time: checkIn.startTime,
      end_time: checkIn.endTime,
    });

    if (!result?.id) {
      throw new Error("Failed to save check-in.");
    }

    addUserCheckInId(result.id);

    const insertedCheckIn: CheckIn = {
      ...checkIn,
      id: result.id,
      timestamp: new Date(result.created_at),
      durationMinutes: calculateTimeDifference(
        checkIn.startTime,
        checkIn.endTime
      ),
    };

    const normalizedAdjusted = adjustedCheckIns.map((item) => ({
      ...item,
      durationMinutes: calculateTimeDifference(item.startTime, item.endTime),
    }));

    if (normalizedAdjusted.length > 0) {
      try {
        await checkInService.updateMultipleCheckIns(
          normalizedAdjusted.map((item) => ({
            id: item.id,
            start_time: item.startTime,
            end_time: item.endTime,
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
      return [insertedCheckIn, ...normalizedAdjusted, ...filtered];
    });

    // Trigger form reset (for both direct submissions and resolved conflicts)
    setFormResetKey(Date.now());
  };

  // Keep user's personal list in sync whenever the global check-ins change
  useEffect(() => {
    const userCheckInIds = getUserCheckInIds();
    const userOwnCheckIns = checkIns.filter((checkIn) =>
      userCheckInIds.includes(checkIn.id)
    );
    setUserCheckIns(userOwnCheckIns);
  }, [checkIns]);

  // Function to load check-ins from Supabase
  const loadCheckIns = async () => {
    try {
      const supabaseData = await checkInService.fetchCheckIns();

      // Convert Supabase check-ins to local CheckIn format
      const convertedCheckIns: CheckIn[] = supabaseData.map(
        (supabaseCheckIn: SupabaseCheckIn) => {
          // Extract time strings from timestamps (handles both timestamp and HH:MM formats)
          const startTime = extractTimeFromTimestamp(
            supabaseCheckIn.start_time
          );
          const endTime = extractTimeFromTimestamp(supabaseCheckIn.end_time);

          // Calculate duration properly (handles overnight)
          const durationMinutes = calculateTimeDifference(startTime, endTime);

          const venue = OHIO_STATE_VENUES.find(
            (v) => v.name === supabaseCheckIn.venue
          );

          return {
            id: supabaseCheckIn.id,
            venue: supabaseCheckIn.venue,
            venueArea: venue?.area,
            startTime: startTime,
            endTime: endTime,
            durationMinutes,
            timestamp: new Date(supabaseCheckIn.created_at),
          };
        }
      );

      // Set all check-ins (for map)
      setCheckIns(convertedCheckIns);
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
    const conflicts = findConflictingCheckIns(draftCheckIn, userCheckIns);

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

  return (
    <div className="min-h-screen bg-background">
      {/* Map Section */}
      <div className="mb-8">
        <MapView checkIns={checkIns} />
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
