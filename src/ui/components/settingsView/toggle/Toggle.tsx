import "./Toggle.css";
import type { ReactNode } from "react";
import { SettingsField } from "../form/SettingsForm";

type ToggleProps = {
  id: string;
  label?: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  disabled?: boolean;
  description?: ReactNode;
  tooltip?: string;
};

function Toggle({ id, label, checked, onToggle, disabled = false, description, tooltip }: ToggleProps) {
  return (
    <SettingsField className="toggleSwitch" label={label} htmlFor={id} layout="toggle" description={description} tooltip={tooltip}>
      <input type="checkbox" id={id} checked={checked} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />
    </SettingsField>
  );
}

export default Toggle;
