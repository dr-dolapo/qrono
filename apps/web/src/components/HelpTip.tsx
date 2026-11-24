import { Popover } from "@base-ui/react/popover";
import type { ReactNode } from "react";

/** A small "?" beside a heading that opens a short explanation. */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="help-tip" aria-label={`About ${label}`}>
        ?
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start" className="popover-positioner">
          <Popover.Popup className="popover">
            <Popover.Title className="popover-title">{label}</Popover.Title>
            <div className="popover-body">{children}</div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
