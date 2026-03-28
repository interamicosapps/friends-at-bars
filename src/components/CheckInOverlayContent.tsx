import { useState, useEffect } from "react";
import CheckInForm from "@/components/CheckInForm";
import CheckInList from "@/components/CheckInList";
import ConflictConfirmationDialog from "@/components/ConflictConfirmationDialog";
import { CheckIn, CheckInFormData } from "@/types/checkin";
import {
  calculateEndDateTime,
  combineDateAndTime,
  calculateTimeDifference,
  isCheckInInPast,
} from "@/lib/timeUtils";
import {
  findConflictingCheckIns,
  calculateAdjustments,
  adjustCheckInTimes,
} from "@/lib/conflictUtils";
import { checkInService } from "@/lib/supabaseClient";
import { testDataService } from "@/lib/testDataService";
import { useTestMode } from "@/contexts/TestModeContext";
import { OHIO_STATE_VENUES } from "@/data/venues";
import {
  addUserCheckInId,
  getUserCheckInIds,
  removeUserCheckInId,
} from "@/lib/userCheckIns";

interface CheckInOverlayContentProps {
  checkIns: CheckIn[];
  onCheckInsUpdated: () => void;
  onClose: () => void;
}

export default function CheckInOverlayContent({
  checkIns,
  onCheckInsUpdated,
  onClose,
}: CheckInOverlayContentProps) {
  const { useMockCheckIns } = useTestMode();
  const checkInApi = useMockCheckIns ? testDataService : checkInService;
  const [userCheckIns, setUserCheckIns] = useState<CheckIn[]>([]);
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
    const result = await checkInApi.insertCheckIn({
      venue: checkIn.venue,
      start_time: checkIn.startDateTime,
      end_time: checkIn.endDateTime,
      date: checkIn.date,
    });

    if (!result?.id) {
      throw new Error("Failed to save check-in.");
    }

    addUserCheckInId(result.id);

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
        await checkInApi.updateMultipleCheckIns(
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

    setFormResetKey(Date.now());
    onCheckInsUpdated();
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

  useEffect(() => {
    setUserCheckIns(getCurrentUserCheckIns());
  }, [checkIns]);

  const handleCheckInSubmit = async (
    formData: CheckInFormData
  ): Promise<"success" | "conflict"> => {
    const draftCheckIn = buildCheckInFromForm(formData);

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
      await checkInApi.deleteCheckIn(id);
      removeUserCheckInId(id);
      onCheckInsUpdated();
    } catch (error) {
      console.error("Failed to delete check-in:", error);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-3 py-2">
        <h2 className="text-lg font-semibold text-foreground">Check-In</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-200 bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-200"
          aria-label="Close"
        >
          Close
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4">
        <div className="mb-6">
          <CheckInForm
            onSubmit={handleCheckInSubmit}
            resetTrigger={formResetKey}
          />
        </div>
        <div>
          <CheckInList checkIns={userCheckIns} onDelete={handleDeleteCheckIn} />
        </div>
      </div>
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
