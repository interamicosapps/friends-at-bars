import { format } from "date-fns";
import { Calendar as CalendarIcon, Menu } from "lucide-react";
import { CheckIn } from "@/types/checkin";
import ActiveCheckInsPanel from "./ActiveCheckInsPanel";

interface ActivitiesListOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  checkIns: CheckIn[];
  selectedDate: string;
  selectedTime: string;
  onSelectDate: (date: string) => void;
  onSelectTime: (time: string) => void;
  timeOptions: string[];
  dynamicStartTime: string;
}

export default function ActivitiesListOverlay({
  isOpen,
  onClose,
  checkIns,
  selectedDate,
  selectedTime,
  onSelectDate,
  onSelectTime,
  timeOptions,
  dynamicStartTime,
}: ActivitiesListOverlayProps) {
  if (!isOpen) return null;

  const [hours, minutes] = selectedTime.split(":").map(Number);
  let compactDate = selectedDate;
  let displayHours = hours;
  if (hours >= 24) {
    const date = new Date(selectedDate + "T00:00:00");
    date.setDate(date.getDate() + 1);
    compactDate = format(date, "yyyy-MM-dd");
    displayHours = hours % 24;
  }
  const compactDateTime = format(
    new Date(
      `${compactDate}T${displayHours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:00`
    ),
    "M/d h:mm a"
  );

  return (
    <>
      {/* Backdrop - optional dimming */}
      <div
        className="fixed inset-0 z-30 bg-black/20"
        style={{ padding: "12px" }}
        aria-hidden
      />
      {/* Overlay with rim: below navbar (h-16 = 4rem) + 12px gap */}
      <div
        className="fixed z-40 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-2xl"
        style={{
          top: "calc(4rem + var(--safe-area-inset-top, 0px) + 12px)",
          left: 12,
          right: 12,
          bottom: 12,
        }}
      >
        <div className="flex h-full flex-col overflow-hidden">
          {/* Header with collapse button and date - compact */}
          <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2">
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-[32px] min-w-[32px] flex-shrink-0 items-center justify-center rounded-md border border-gray-200 bg-gray-100 p-1.5 text-gray-600 transition hover:bg-gray-200 hover:border-gray-300"
              aria-label="Close list and show map"
            >
              <Menu className="h-3.5 w-3.5" />
            </button>
            <span className="flex flex-1 items-center justify-center gap-1.5 text-xs font-semibold text-gray-700">
              <CalendarIcon className="h-3.5 w-3.5 text-gray-500" />
              {compactDateTime}
            </span>
            <div className="min-w-[32px]" aria-hidden />
          </div>
          {/* Scrollable panel content */}
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
            <ActiveCheckInsPanel
              checkIns={checkIns}
              selectedDate={selectedDate}
              selectedTime={selectedTime}
              onSelectDate={onSelectDate}
              onSelectTime={onSelectTime}
              timeOptions={timeOptions}
              dynamicStartTime={dynamicStartTime}
            />
          </div>
        </div>
      </div>
    </>
  );
}
