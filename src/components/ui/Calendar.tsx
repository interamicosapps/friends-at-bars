import { forwardRef, type ComponentProps } from "react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";

export type CalendarProps = ComponentProps<typeof DayPicker>;

const Calendar = forwardRef<HTMLDivElement, CalendarProps>(
  ({ className, classNames, showOutsideDays = true, ...props }, ref) => {
    return (
      <DayPicker
        ref={ref}
        showOutsideDays={showOutsideDays}
        className={cn("p-3", className)}
        classNames={{
          months: "flex flex-col space-y-4 sm:flex-row sm:space-x-4 sm:space-y-0",
          month: "space-y-4",
          caption: "flex justify-center pt-1 relative items-center",
          caption_label: "text-sm font-medium",
          nav: "space-x-1 flex items-center",
          nav_button:
            "h-8 w-8 bg-transparent p-0 opacity-50 hover:opacity-100 text-muted-foreground",
          nav_button_previous: "absolute left-1",
          nav_button_next: "absolute right-1",
          table: "w-full border-collapse space-y-1",
          head_row: "flex",
          head_cell:
            "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
          row: "flex w-full mt-2",
          cell: cn(
            "relative h-9 w-9 text-center text-sm p-0 font-normal focus-within:relative focus-within:z-20",
            "[&:has([aria-selected].day-outside)]:opacity-50"
          ),
          day: cn(
            "h-9 w-9 p-0 font-normal aria-selected:opacity-100",
            "rounded-md hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          ),
          day_selected:
            "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
          day_today: "bg-secondary text-secondary-foreground",
          day_outside: "day-outside text-muted-foreground aria-selected:bg-secondary aria-selected:text-secondary-foreground",
          day_disabled: "text-muted-foreground opacity-50",
          day_range_middle:
            "aria-selected:bg-secondary aria-selected:text-secondary-foreground",
          day_hidden: "invisible",
          ...classNames,
        }}
        {...props}
      />
    );
  }
);
Calendar.displayName = "Calendar";

export { Calendar };

