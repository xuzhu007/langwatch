import type React from "react";

import type { TraceListItem } from "../../../../../../../behavior/explorer/types/trace.ts";
import { formatISOTimestamp } from "../../../../../../../model/display-formatters.ts";
import { MonoCell } from "../../../../../../elements/explorer/trace-table/mono-cell.tsx";
import type { CellDef } from "../../types.ts";
import { TimeHoverCard } from "./time-hover-card.tsx";

/** Local trace timestamps retain the saved relative or ISO format. */
const TimestampText: React.FC<{ timestamp: number }> = ({ timestamp }) => (
  <TimeHoverCard timestamp={timestamp}>
    <MonoCell color="fg.subtle" cursor="help">
      {formatISOTimestamp(timestamp)}
    </MonoCell>
  </TimeHoverCard>
);

export const TimestampCell = {
  id: "timestamp",
  label: "Timestamp",
  render: ({ row }) => <TimestampText timestamp={row.timestamp} />,
  renderComfortable: ({ row }) => <TimestampText timestamp={row.timestamp} />,
} as const satisfies CellDef<TraceListItem>;
