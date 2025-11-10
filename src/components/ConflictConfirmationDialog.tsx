import { CheckIn } from "@/types/checkin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatDateDisplay, formatTimeDisplay } from "@/lib/timeUtils";

interface ConflictConfirmationDialogProps {
  newCheckIn: CheckIn;
  conflictingCheckIns: CheckIn[];
  adjustments: { original: CheckIn; adjusted: CheckIn }[];
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConflictConfirmationDialog({
  newCheckIn,
  conflictingCheckIns,
  adjustments,
  onConfirm,
  onCancel,
}: ConflictConfirmationDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="mx-4 w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-red-600">
            Check-in Conflict Detected
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This check-in will interfere with {conflictingCheckIns.length}{" "}
            previous submission
            {conflictingCheckIns.length > 1 ? "s" : ""}. The conflicting
            check-ins will be adjusted as shown below.
          </p>

          {/* New Check-in */}
          <div className="rounded-lg border bg-muted/50 p-4">
            <h3 className="mb-2 font-semibold text-foreground">
              New Check-in:
            </h3>
            <div className="text-sm">
              <p>
                <strong>Venue:</strong> {newCheckIn.venue}
              </p>
              <p>
                <strong>Date:</strong> {formatDateDisplay(newCheckIn.date)}
              </p>
              <p>
                <strong>Time:</strong> {formatTimeDisplay(newCheckIn.startTime)}{" "}
                - {formatTimeDisplay(newCheckIn.endTime)}
              </p>
            </div>
          </div>

          {/* Conflicting Check-ins */}
          <div className="space-y-3">
            <h3 className="font-semibold text-foreground">
              Conflicting Check-ins:
            </h3>
            {adjustments.map((adjustment) => (
              <div
                key={adjustment.original.id}
                className="rounded-lg border p-4"
              >
                <div className="mb-2">
                  <p className="font-medium">{adjustment.original.venue}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateDisplay(adjustment.original.date)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="mb-1 text-muted-foreground">Current:</p>
                    <p className="text-red-600">
                      {formatTimeDisplay(adjustment.original.startTime)} -{" "}
                      {formatTimeDisplay(adjustment.original.endTime)}
                    </p>
                  </div>

                  <div>
                    <p className="mb-1 text-muted-foreground">Will become:</p>
                    <p className="text-green-600">
                      {formatTimeDisplay(adjustment.adjusted.startTime)} -{" "}
                      {formatTimeDisplay(adjustment.adjusted.endTime)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-4">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={onConfirm} className="bg-red-600 hover:bg-red-700">
              Proceed
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
