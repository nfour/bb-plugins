// The tree's menus: the Diff toolbar button's (show tree, open depth, recent
// commits) and the "Changes" row's view menu (layout, compact folders, Synced view).
import * as Menu from "@radix-ui/react-dropdown-menu";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { OpenDepth } from "./folders";
import { LIST_ICON, LIST_TREE_ICON, TREE_ICON } from "./icons";
import { RECENT_COUNTS, setOption, useOptions } from "./options";
import { usePortalScopeProps } from "./portal-scope";

interface Choice {
  value: string;
  label: string;
  /** An icon name shown before the label. */
  icon?: string;
}

const DEPTHS: Choice[] = [
  { value: "all", label: "All" },
  { value: "top", label: "Top" },
  { value: "none", label: "None" },
];

const RECENTS: Choice[] = [
  { value: "off", label: "Off" },
  ...RECENT_COUNTS.map((count) => ({
    value: String(count),
    label: String(count),
  })),
];

// Switches keep the menu open: several are often set in one visit.
const keepOpen = (event: Event) => event.preventDefault();

const LAYOUTS: Choice[] = [
  { value: "tree", label: "Tree", icon: LIST_TREE_ICON },
  { value: "list", label: "List", icon: LIST_ICON },
];

/**
 * The "Changes" row's view menu, at every width: layout, compact folders and
 * Synced view. Its trigger lights up while Synced view is on.
 */
export function ViewMenu() {
  const options = useOptions();
  const scope = usePortalScopeProps();
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="diff-plus-fold-all"
          aria-label="Tree view options"
          title="View"
          data-on={options.synced || undefined}
        >
          <Icon name={options.view === "list" ? LIST_ICON : LIST_TREE_ICON} fallback="Folder" className="diff-plus-icon" aria-hidden />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content {...scope} align="start" sideOffset={6} className="diff-plus-menu">
          <Segments label="Layout" hideLabel value={options.view} choices={LAYOUTS} onChange={(view) => setOption("view", view as typeof options.view)} />
          <Menu.CheckboxItem
            disabled={options.view !== "tree"}
            checked={options.compact}
            onCheckedChange={(compact) => setOption("compact", compact)}
            onSelect={keepOpen}
            className="diff-plus-item diff-plus-item--hint"
          >
            <Check />
            <span>Compact folders</span>
            <span className="diff-plus-hint">A folder holding only one folder shares its row</span>
          </Menu.CheckboxItem>
          <Menu.CheckboxItem
            checked={options.synced}
            onCheckedChange={(synced) => setOption("synced", synced)}
            onSelect={keepOpen}
            className="diff-plus-item diff-plus-item--hint"
          >
            <Check />
            <span>Synced view</span>
            <span className="diff-plus-hint">Ordered like the list, with a line beside the files on screen</span>
          </Menu.CheckboxItem>
          <div className="diff-plus-nested">
            <Menu.CheckboxItem
              disabled={!options.synced}
              checked={options.syncScroll}
              onCheckedChange={(syncScroll) => setOption("syncScroll", syncScroll)}
              onSelect={keepOpen}
              className="diff-plus-item diff-plus-item--hint"
            >
              <Check />
              <span>Scroll sync</span>
              <span className="diff-plus-hint">The tree scrolls to keep the files on screen in view</span>
            </Menu.CheckboxItem>
            <Menu.CheckboxItem
              disabled={!options.synced}
              checked={options.syncBars}
              onCheckedChange={(syncBars) => setOption("syncBars", syncBars)}
              onSelect={keepOpen}
              className="diff-plus-item diff-plus-item--hint"
            >
              <Check />
              <span>Visible indicator lines</span>
              <span className="diff-plus-hint">A bar on the tree's edge next to each file the list shows</span>
            </Menu.CheckboxItem>
          </div>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function TreeMenu() {
  const options = useOptions();
  const scope = usePortalScopeProps();
  return (
    // Not modal: a modal menu hides and locks the rest of the page while open.
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="diff-plus-toggle"
          aria-label="Folder tree options"
          title="Folder tree"
          data-on={options.open || undefined}
        >
          <Icon name={TREE_ICON} fallback="Folder" className="diff-plus-icon" aria-hidden />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content {...scope} align="end" sideOffset={6} className="diff-plus-menu">
          <Menu.CheckboxItem
            checked={options.open}
            onCheckedChange={(open) => setOption("open", open)}
            onSelect={keepOpen}
            className="diff-plus-item"
          >
            <Check />
            Show tree
          </Menu.CheckboxItem>
          {/* The tree's own options, under its switch and greyed out while it is off. */}
          <div className="diff-plus-nested">
            <Segments
              label="Open at first"
              value={options.depth}
              choices={DEPTHS}
              disabled={!options.open}
              onChange={(depth) => setOption("depth", depth as OpenDepth)}
            />
          </div>

          <Menu.Separator className="diff-plus-separator" />
          <Segments
            label="Recent commits"
            hint="Listed in the scope picker. Picking one moves the merge base back until you pick another scope"
            value={options.recent ? String(options.recentCount) : "off"}
            choices={RECENTS}
            onChange={(value) => {
              if (value === "off") return setOption("recent", false);
              setOption("recentCount", Number(value));
              setOption("recent", true);
            }}
          />
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * A choice as one row of chips beside its label. The chips are Radix radio
 * items, so the arrow keys step through them like any other item.
 */
function Segments({
  label,
  hideLabel,
  hint,
  value,
  choices,
  disabled,
  onChange,
}: {
  label: string;
  /** Leave the label to the group's aria-label; the chips take the row's width. */
  hideLabel?: boolean;
  hint?: string;
  value: string;
  choices: Choice[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="diff-plus-segment-row" data-disabled={disabled || undefined}>
      <div className="diff-plus-segment-line" data-full={hideLabel || undefined}>
        {!hideLabel && <span>{label}</span>}
        <Menu.RadioGroup value={value} onValueChange={onChange} className="diff-plus-segments" aria-label={label}>
          {choices.map((choice) => (
            <Menu.RadioItem key={choice.value} value={choice.value} disabled={disabled} onSelect={keepOpen} className="diff-plus-segment">
              {choice.icon && <Icon name={choice.icon} className="diff-plus-icon" aria-hidden />}
              {choice.label}
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </div>
      {hint && <span className="diff-plus-hint">{hint}</span>}
    </div>
  );
}

const Check = () => (
  <span className="diff-plus-item-mark">
    <Menu.ItemIndicator>
      <Icon name="Check" className="diff-plus-icon" aria-hidden />
    </Menu.ItemIndicator>
  </span>
);
