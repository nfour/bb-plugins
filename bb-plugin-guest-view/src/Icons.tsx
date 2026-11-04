import { useId, type ReactNode } from "react";
import { MARK } from "./mark";

/** Small line icons in BB's weight (1.5 stroke in a 24-unit box), drawn here so the names cannot go missing. */
function Svg({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

type Props = { className?: string };

/** The name the app registers {@link ShareIcon} under (`app.tsx`), so BB's own surfaces such as the thread menu can draw it. */
export const SHARE_ICON = "guest-view/share";

/** Guest View's mark (see `mark.ts`): two people over a chain link. */
export function ShareIcon({ className }: Props) {
  const cut = `guest-view-share-${useId().replace(/:/g, "")}`;
  const { link, people, head } = MARK;
  const person = (
    <>
      <path d={people[0]} />
      <circle cx={head.cx} cy={head.cy} r={head.r} />
      <path d={people[1]} />
      <path d={people[2]} />
    </>
  );
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="#fff" stroke="none" />
        <g stroke="#000" strokeWidth={MARK.cut} fill="#000">
          <path d={people[0]} fill="none" />
          <circle cx={head.cx} cy={head.cy} r={head.r} />
          <path d={people[1]} fill="none" />
          <path d={people[2]} fill="none" />
        </g>
      </mask>
      <g mask={`url(#${cut})`}>
        <path d={link[0]} />
        <path d={link[1]} />
      </g>
      {person}
    </svg>
  );
}

export const UserIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Svg>
);

/** A clock face: time that has passed. */
export const ClockIcon = ({ className }: Props) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </Svg>
);

export const TimerIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M10 2h4" />
    <path d="M12 14l3-3" />
    <circle cx="12" cy="14" r="8" />
  </Svg>
);

/** Two chain links: copy the link. */
export const LinkIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Svg>
);

export const CheckIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);

export const SlidersIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />
  </Svg>
);

export const StopIcon = ({ className }: Props) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="m15 9-6 6M9 9l6 6" />
  </Svg>
);

/** An arrow pointing down: "put this into the composer below". */
export const ArrowDownIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </Svg>
);

export const CopyIcon = ({ className }: Props) => (
  <Svg className={className}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Svg>
);

export const MessageIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Svg>
);

export const ChevronDownIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const CloseIcon = ({ className }: Props) => (
  <Svg className={className}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);
