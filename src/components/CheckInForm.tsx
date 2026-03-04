import { useState, useEffect, useRef, type FormEvent } from "react";
import { addDays, format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Calendar } from "@/components/ui/Calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { CheckInFormData } from "@/types/checkin";
import { OHIO_STATE_VENUES, CAMPUS_AREAS } from "@/data/venues";
import {
  getDynamicStartTime,
  generateStartTimeOptions,
  generateDurationOptions,
  calculateEndTime,
  formatTimeDisplay,
  formatDateDisplay,
} from "@/lib/timeUtils";
import DropdownSelect, { DropdownOption } from "@/components/ui/DropdownSelect";

interface CheckInFormProps {
  onSubmit: (checkIn: CheckInFormData) => Promise<"success" | "conflict">;
  resetTrigger?: number;
}

type DateOption = "today" | "tomorrow" | "calendar";

const formatDateValue = (date: Date) => format(date, "yyyy-MM-dd");

export default function CheckInForm({ onSubmit, resetTrigger }: CheckInFormProps) {
  const today = formatDateValue(new Date());
  const tomorrow = formatDateValue(addDays(new Date(), 1));

  const [venue, setVenue] = useState("");
  const [dateOption, setDateOption] = useState<DateOption>("today");
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [startTime, setStartTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [endTime, setEndTime] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const previousSelectedDate = useRef<string>(today);

  // Calculate dynamic start time based on current time
  const dynamicStartTime = getDynamicStartTime();
  const startTimeOptions = generateStartTimeOptions(dynamicStartTime);
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

  const handleDateOptionSelect = (option: DateOption) => {
    setDateOption(option);

    if (option === "today") {
      setSelectedDate(today);
      setIsCalendarOpen(false);
    } else if (option === "tomorrow") {
      setSelectedDate(tomorrow);
      setIsCalendarOpen(false);
    } else {
      setIsCalendarOpen(true);
    }
  };

  const handleCalendarSelect = (day?: Date) => {
    if (!day) return;
    const value = formatDateValue(day);
    setSelectedDate(value);
    setDateOption("calendar");
    setIsCalendarOpen(false);
  };

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

  // Default start time when venue is selected - use dynamic start time
  useEffect(() => {
    if (venue && !startTime) {
      setStartTime(dynamicStartTime);
    }
  }, [venue, startTime, dynamicStartTime]);

  // Allow parent to trigger a reset (e.g., after conflict resolution)
  useEffect(() => {
    if (resetTrigger) {
      setVenue("");
      setDateOption("today");
      setSelectedDate(today);
      setStartTime("");
      setDurationMinutes("");
      setEndTime("");
      setSubmitError("");
      setIsCalendarOpen(false);
    }
  }, [resetTrigger, today]);

  useEffect(() => {
    if (
      isCalendarOpen &&
      previousSelectedDate.current !== selectedDate
    ) {
      setIsCalendarOpen(false);
    }
    previousSelectedDate.current = selectedDate;
  }, [selectedDate, isCalendarOpen]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError("");

    if (!venue || !selectedDate || !startTime || !durationMinutes) {
      setSubmitError("Please fill in all fields");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await onSubmit({
        venue,
        date: selectedDate,
        startTime,
        durationMinutes: parseInt(durationMinutes),
      });

      if (result === "success") {
        setVenue("");
        setDateOption("today");
        setSelectedDate(today);
        setStartTime("");
        setDurationMinutes("");
        setEndTime("");
        setIsCalendarOpen(false);
      }
    } catch (error: unknown) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: string }).message)
          : "Unknown error";
      console.error("Error saving check-in:", error);
      setSubmitError(
        message.includes("date")
          ? "Database missing 'date' column. See SUPABASE_SETUP.md to add it."
          : `Failed to save check-in: ${message}`
      );
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
            <Label htmlFor="date">Date</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={dateOption === "today" ? "default" : "outline"}
                size="sm"
                onClick={() => handleDateOptionSelect("today")}
                disabled={isSubmitting}
              >
                Today
              </Button>
              <Button
                type="button"
                variant={dateOption === "tomorrow" ? "default" : "outline"}
                size="sm"
                onClick={() => handleDateOptionSelect("tomorrow")}
                disabled={isSubmitting}
              >
                Tomorrow
              </Button>
              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant={dateOption === "calendar" ? "default" : "outline"}
                    size="sm"
                    className="flex items-center gap-2"
                    onClick={() => handleDateOptionSelect("calendar")}
                    disabled={isSubmitting}
                  >
                    <CalendarIcon className="h-4 w-4" /> Calendar
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDate ? new Date(`${selectedDate}T00:00:00`) : undefined}
                    onSelect={handleCalendarSelect}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <p className="text-sm text-muted-foreground">
              Selected: {formatDateDisplay(selectedDate)}
            </p>
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
