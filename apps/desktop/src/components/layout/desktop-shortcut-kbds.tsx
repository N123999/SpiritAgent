import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  isMacDesktopPlatform,
  modAltLetterShortcutKbdKeys,
  modCommaShortcutKbdKeys,
  modLetterShortcutKbdKeys,
} from "@/lib/desktop-shell";

export function SessionSidebarShortcutKbd() {
  const keys = modLetterShortcutKbdKeys("B");

  return (
    <KbdGroup>
      {isMacDesktopPlatform() ? (
        keys.map((key) => <Kbd key={key}>{key}</Kbd>)
      ) : (
        <>
          <Kbd>Ctrl</Kbd>
          <span>+</span>
          <Kbd>B</Kbd>
        </>
      )}
    </KbdGroup>
  );
}

export function NewSessionShortcutKbd() {
  const keys = modLetterShortcutKbdKeys("N");

  return (
    <KbdGroup>
      {isMacDesktopPlatform() ? (
        keys.map((key) => <Kbd key={key}>{key}</Kbd>)
      ) : (
        <>
          <Kbd>Ctrl</Kbd>
          <span>+</span>
          <Kbd>N</Kbd>
        </>
      )}
    </KbdGroup>
  );
}

export function NewToolTabShortcutKbd() {
  const keys = modLetterShortcutKbdKeys("T");

  return (
    <KbdGroup>
      {isMacDesktopPlatform() ? (
        keys.map((key) => <Kbd key={key}>{key}</Kbd>)
      ) : (
        <>
          <Kbd>Ctrl</Kbd>
          <span>+</span>
          <Kbd>T</Kbd>
        </>
      )}
    </KbdGroup>
  );
}

export function WorkspaceToolsShortcutKbd() {
  const keys = modAltLetterShortcutKbdKeys("B");

  return (
    <KbdGroup>
      {isMacDesktopPlatform() ? (
        keys.map((key) => <Kbd key={key}>{key}</Kbd>)
      ) : (
        <>
          <Kbd>Ctrl</Kbd>
          <span>+</span>
          <Kbd>Alt</Kbd>
          <span>+</span>
          <Kbd>B</Kbd>
        </>
      )}
    </KbdGroup>
  );
}

export function SettingsShortcutKbd() {
  const keys = modCommaShortcutKbdKeys();

  return (
    <KbdGroup>
      {isMacDesktopPlatform() ? (
        keys.map((key) => <Kbd key={key}>{key}</Kbd>)
      ) : (
        <>
          <Kbd>Ctrl</Kbd>
          <span>+</span>
          <Kbd>,</Kbd>
        </>
      )}
    </KbdGroup>
  );
}
