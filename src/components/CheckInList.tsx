import { CheckIn } from "@/types/checkin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { formatTimeDisplay } from "@/lib/timeUtils";
import { Button } from "@/components/ui/Button";

interface CheckInListProps {
  checkIns: CheckIn[];
  onDelete?: (id: string) => void;
}

export default function CheckInList({ checkIns, onDelete }: CheckInListProps) {
  const formatDuration = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours > 0) {
      if (remainingMinutes === 0) {
        return `${hours} hour${hours > 1 ? "s" : ""}`;
      } else if (remainingMinutes === 30) {
        return `${hours}.5 hours`;
      } else {
        return `${hours}h ${remainingMinutes}m`;
      }
    } else {
      return `${minutes} min`;
    }
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  if (checkIns.length === 0) {
    return (
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <CardTitle>My Check-ins</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-muted-foreground">
            No check-ins yet. Select a venue to get started!
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle>My Check-ins</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {checkIns.map((checkIn) => (
            <div
              key={checkIn.id}
              className="flex items-center justify-between rounded-lg border bg-muted/50 p-4"
            >
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">
                  {checkIn.venue}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {formatTimeDisplay(checkIn.startTime)} -{" "}
                  {formatTimeDisplay(checkIn.endTime)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Duration: {formatDuration(checkIn.durationMinutes)}
                </p>
                {checkIn.venueArea && (
                  <p className="text-xs text-muted-foreground">
                    Area: {checkIn.venueArea}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <p className="text-xs text-muted-foreground">
                  {formatDate(checkIn.timestamp)}
                </p>
                {onDelete && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => onDelete(checkIn.id)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
