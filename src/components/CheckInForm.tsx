import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { CheckInFormData } from "@/types/checkin";
import { OHIO_STATE_VENUES, CAMPUS_AREAS } from "@/data/venues";
import {
  generateStartTimeOptions,
  generateDurationOptions,
  calculateEndTime,
  formatTimeDisplay,
} from "@/lib/timeUtils";
import DropdownSelect, { DropdownOption } from "@/components/ui/DropdownSelect";

interface CheckInFormProps {
  onSubmit: (checkIn: CheckInFormData) => Promise<"success" | "conflict">;
  resetTrigger?: number;
}

export default function CheckInForm({ onSubmit, resetTrigger }: CheckInFormProps) {
  const [venue, setVenue] = useState("");
  const [startTime, setStartTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [endTime, setEndTime] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const startTimeOptions = generateStartTimeOptions();
  const durationOptions = generateDurationOptions(startTime);

  // Build dropdown options
  const venueOptions: DropdownOption[] = CAMPUS_AREAS.flatMap((area) =>
    OHIO_STATE_VENUES.filter((v) => v.area === area).map((v) => ({
      label: v.name,
      value: v.name,
      group: area,
    }))
  );
  const startTimeDropdown: DropdownOption[] = startTimeOptions.map((t) => ({
    label: formatTimeDisplay(t),
    value: t,
  }));

  // Calculate end time whenever start time or duration changes
  useEffect(() => {
    if (startTime && durationMinutes) {
      const calculatedEndTime = calculateEndTime(
        startTime,
        parseInt(durationMinutes)
      );
      setEndTime(calculatedEndTime);
    } else {
      setEndTime("");
    }
  }, [startTime, durationMinutes]);

  // Reset duration when start time changes
  useEffect(() => {
    setDurationMinutes("");
    setEndTime("");
  }, [startTime]);

  // Allow parent to trigger a reset (e.g., after conflict resolution)
  useEffect(() => {
    if (resetTrigger) {
      setVenue("");
      setStartTime("");
      setDurationMinutes("");
      setEndTime("");
      setSubmitError("");
    }
  }, [resetTrigger]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError("");

    if (!venue || !startTime || !durationMinutes) {
      setSubmitError("Please fill in all fields");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await onSubmit({
        venue,
        startTime,
        durationMinutes: parseInt(durationMinutes),
      });

      if (result === "success") {
        setVenue("");
        setStartTime("");
        setDurationMinutes("");
        setEndTime("");
      }
    } catch (error) {
      console.error("Error saving check-in:", error);
      setSubmitError("Failed to save check-in. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>Plan Your Night</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="venue">Venue</Label>
            <DropdownSelect
              value={venue}
              onChange={setVenue}
              options={venueOptions}
              placeholder="Select a venue..."
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="startTime">Start Time</Label>
            <DropdownSelect
              value={startTime}
              onChange={setStartTime}
              options={startTimeDropdown}
              placeholder="Select start time..."
              disabled={!venue || isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="duration">Duration</Label>
            <DropdownSelect
              value={durationMinutes}
              onChange={setDurationMinutes}
              options={durationOptions.map((option) => ({
                label: option.endTime
                  ? `${option.label} - ${formatTimeDisplay(option.endTime)}`
                  : option.label,
                value: option.value,
              }))}
              placeholder={
                startTime ? "Select duration..." : "Select start time first..."
              }
              disabled={!startTime || isSubmitting}
            />
          </div>

          {endTime && (
            <div className="rounded-lg bg-muted p-3">
              <p className="text-sm text-muted-foreground">
                <strong>End Time:</strong> {formatTimeDisplay(endTime)}
              </p>
            </div>
          )}

          {submitError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-600">{submitError}</p>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Submit Check-in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
